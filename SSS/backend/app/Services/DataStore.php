<?php

namespace App\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The business data as a whole: counts, restore points, wiping and putting data back
 * (app_private.data_tables / data_counts / make_restore_point, admin_restore, admin_delete_data).
 * Logins, settings, the activity log and notifications are never part of it.
 */
final class DataStore
{
    /** In the order they can be filled (a row's references come first). */
    public const TABLES = ['zones', 'receipt_series', 'import_batches', 'legacy_accounts', 'legacy_payments', 'borrowers', 'loans', 'payments', 'seizures',
        'adjustments', 'receipt_books', 'cash_closings', 'collection_assignments', 'pending_payments', 'visit_remarks'];

    /** The newest 5 restore points are kept. */
    public const KEEP = 5;

    /** JSON columns (MariaDB lists them as longtext). data_flags were text[] in Postgres. */
    private const JSON_COLS = ['import_batches' => ['notes'], 'legacy_accounts' => ['data_flags', 'raw'], 'legacy_payments' => ['data_flags', 'raw'],
        'payments' => ['parts'], 'pending_payments' => ['parts']];

    /** Columns naming a login; someone without a login here becomes the admin restoring (app_private.known_user). */
    private const USER_COLS = ['created_by', 'cancelled_by', 'received_by', 'reviewed_by', 'user_id', 'by_user', 'updated_by'];

    private static array $cols = [];

    public static function counts(): array
    {
        $out = [];
        foreach (self::TABLES as $t) {
            $out[$t] = DB::table($t)->count();
        }

        return $out;
    }

    /** name => {type, column_type, nullable} of the columns that take a value (generated ones such as search_text left out). */
    public static function columns(string $table): array
    {
        return self::$cols[$table] ??= collect(DB::select(
            "select column_name as name, data_type as type, column_type, is_nullable from information_schema.columns
              where table_schema = database() and table_name = ? and coalesce(generation_expression, '') = '' order by ordinal_position", [$table]))
            ->mapWithKeys(fn ($c) => [$c->name => ['type' => strtolower($c->type), 'column_type' => strtolower($c->column_type), 'nullable' => $c->is_nullable === 'YES']])
            ->all();
    }

    /** Columns that both the data table and its restore-point copy have. */
    private static function shared(string $table): array
    {
        $rp = array_diff(array_keys(self::columns("rp_$table")), ['rp_id']);

        return array_values(array_intersect(array_keys(self::columns($table)), $rp));
    }

    private static function list(array $cols): string
    {
        return implode(', ', array_map(fn ($c) => "`$c`", $cols));
    }

    /** app_private.make_restore_point: copy every data table, keep the newest 5. */
    public static function makePoint(string $reason): int
    {
        $u = auth()->user();
        $id = DB::table('restore_points')->insertGetId([
            'created_at' => now()->format('Y-m-d H:i:s.u'), 'created_by' => $u?->id, 'by_name' => $u?->full_name,
            'reason' => mb_substr($reason, 0, 200), 'counts' => json_encode(self::counts()),
        ]);
        foreach (self::TABLES as $t) {
            $cols = self::list(self::shared($t));
            DB::insert("insert into `rp_$t` (`rp_id`, $cols) select ?, $cols from `$t`", [$id]);
        }
        $old = DB::table('restore_points')->orderByDesc('id')->offset(self::KEEP)->limit(1000)->pluck('id')->all();
        if ($old) {
            foreach (self::TABLES as $t) {
                DB::table("rp_$t")->whereIn('rp_id', $old)->delete();
            }
            DB::table('restore_points')->whereIn('id', $old)->delete();
        }

        return $id;
    }

    /** Run with foreign keys switched off (whole tables are emptied and refilled). */
    public static function withoutKeys(callable $fn): mixed
    {
        DB::statement('set foreign_key_checks = 0');
        try {
            return $fn();
        } finally {
            DB::statement('set foreign_key_checks = 1');
        }
    }

    /** Empty every data table (inside the caller's transaction: plain deletes, no TRUNCATE, so it can be rolled back). */
    public static function wipe(): void
    {
        foreach (array_reverse(self::TABLES) as $t) {
            DB::table($t)->delete();
        }
    }

    /** admin_restore's body: put restore point $id back (call inside a transaction, after saving a point of the data now). */
    public static function putBack(int $id): void
    {
        self::withoutKeys(function () use ($id) {
            self::wipe();
            foreach (self::TABLES as $t) {
                $cols = self::list(self::shared($t));
                DB::insert("insert into `$t` ($cols) select $cols from `rp_$t` where `rp_id` = ? order by `id`", [$id]);
            }
        });
        self::changed();
    }

    /** Stored totals on old accounts follow their receipts (all accounts, or only these SNOs). */
    public static function refreshLegacyTotals(?array $snos = null): void
    {
        $where = '';
        if ($snos !== null) {
            if (! $snos) {
                return;
            }
            $where = 'where a.sno in ('.implode(',', array_map('intval', $snos)).')';
        }
        DB::update("update legacy_accounts a
            left join (select account_id, ledger, sum(paid_amount) paid, count(*) cnt, max(paid_date) last_paid
                         from legacy_payments group by account_id, ledger) x on x.account_id = a.id and x.ledger = a.ledger
            set a.legacy_paid = coalesce(x.paid, 0), a.legacy_payments_count = coalesce(x.cnt, 0), a.legacy_last_paid = x.last_paid $where");
    }

    /**
     * Insert (or, with $unique, insert-or-update) rows a few at a time: one statement stays under ~400 KB, well below
     * MySQL's max_allowed_packet (1 MB by default) even for old accounts with their long raw record.
     */
    public static function insertChunks(string $table, array $rows, ?array $unique = null): void
    {
        $chunk = [];
        $size = 0;
        $flush = function () use ($table, $unique, &$chunk, &$size) {
            if ($chunk) {
                $unique === null ? DB::table($table)->insert($chunk)
                    : DB::table($table)->upsert($chunk, $unique, array_values(array_diff(array_keys($chunk[0]), $unique)));
            }
            $chunk = [];
            $size = 0;
        };
        foreach ($rows as $r) {
            $len = 50;
            foreach ($r as $v) {
                $len += is_string($v) ? strlen($v) + 4 : 12;
            }
            if ($chunk && ($size + $len > 400_000 || count($chunk) >= 500)) {
                $flush();
            }
            $chunk[] = $r;
            $size += $len;
        }
        $flush();
    }

    /** Anything cached from the data is stale now. */
    public static function changed(): void
    {
        DB::table('dashboard_cache')->delete();
    }

    // ---------------------------------------------------------------- rows from a backup file

    /**
     * One CSV row of a backup (this app's, the old app's download, or the nightly Postgres dump) as values for $table:
     * '' is empty, t/f and true/false are booleans, times with an offset become India time, {a,b} arrays become JSON.
     */
    public static function convert(string $table, array $row, string $admin, array $people): array
    {
        $out = [];
        foreach (self::columns($table) as $c => $info) {
            if (! array_key_exists($c, $row)) {
                continue;
            }
            $v = $row[$c];
            if (is_array($v)) {
                $v = json_encode($v, JSON_UNESCAPED_UNICODE);
            }
            if ($v === null) {
                $out[$c] = null;

                continue;
            }
            $v = (string) $v;
            $t = $info['type'];
            if (in_array($c, self::JSON_COLS[$table] ?? [], true) || $t === 'json') {
                $out[$c] = $v === '' ? null : self::json($v, $c === 'data_flags');
            } elseif (in_array($c, self::USER_COLS, true) && ($t === 'char' || $t === 'uuid')) {
                $out[$c] = $v === '' ? null : (isset($people[$v]) ? $v : $admin);
            } elseif ($info['column_type'] === 'tinyint(1)') {
                $b = strtolower($v);
                $out[$c] = $v === '' ? null : (int) in_array($b, ['t', 'true', '1', 'yes'], true);
            } elseif ($t === 'datetime' || $t === 'timestamp') {
                $out[$c] = $v === '' ? null : Carbon::parse($v, 'Asia/Kolkata')->setTimezone('Asia/Kolkata')->format('Y-m-d H:i:s.u');
            } elseif ($t === 'date') {
                $out[$c] = $v === '' ? null : substr($v, 0, 10);
            } elseif (in_array($t, ['varchar', 'char', 'text', 'mediumtext', 'longtext', 'enum'], true)) {
                $out[$c] = $v === '' && $info['nullable'] ? null : $v;
            } else {
                $out[$c] = $v === '' ? null : $v;
            }
        }

        return $out;
    }

    /** JSON text as it is; a Postgres array literal {a,"b c"} as a JSON array. */
    private static function json(string $v, bool $isArray): string
    {
        $t = trim($v);
        if ($isArray && $t === '{}') {
            return '[]';
        }
        json_decode($t);
        if (json_last_error() === JSON_ERROR_NONE) {
            return $t;
        }
        if (str_starts_with($t, '{') && str_ends_with($t, '}')) {
            preg_match_all('/"((?:[^"\\\\]|\\\\.)*)"|([^,]+)/', substr($t, 1, -1), $m, PREG_SET_ORDER);
            $items = array_map(fn ($x) => isset($x[2]) && $x[2] !== '' ? trim($x[2]) : stripcslashes($x[1]), $m);

            return json_encode(array_values($items), JSON_UNESCAPED_UNICODE);
        }

        return json_encode($v, JSON_UNESCAPED_UNICODE);
    }
}

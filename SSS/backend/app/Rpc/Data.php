<?php

namespace App\Rpc;

use App\Models\User;
use App\Services\DataStore;
use App\Services\LegacyImport;
use App\Services\Receipts;
use App\Support\Audit;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/** Settings -> Data (admin only): restore points, delete, restore, restore from a backup file, import from the old software. */
class Data
{
    private static function admin(User $u): void
    {
        if (! $u->isAdmin()) {
            throw RpcError::notAllowed('only admin');
        }
    }

    /** Anything that replaces data asks for the admin's own password again. */
    private static function password(array $p, User $u): void
    {
        if (! Hash::check((string) ($p['p_password'] ?? ''), $u->password)) {
            throw RpcError::bad('your password is incorrect');
        }
    }

    private static function word(array $p, string $word): void
    {
        if (($p['p_confirm'] ?? null) !== $word) {
            throw RpcError::bad("type $word to confirm");
        }
    }

    private static function audit(string $action, array $details): void
    {
        Audit::log($action, null, null, $details);
    }

    /** public.admin_data_overview() */
    public function overview(array $p, User $u): array
    {
        self::admin($u);

        return [
            'counts' => DataStore::counts(),
            'linked_new_on_old' => [
                'payments' => DB::table('payments')->whereNotNull('legacy_account_id')->count(),
                'seizures' => DB::table('seizures')->whereNotNull('legacy_account_id')->count(),
            ],
            'restore_points' => DB::table('restore_points')->orderByDesc('id')->get()
                ->map(fn ($r) => ['id' => $r->id, 'created_at' => $r->created_at, 'by_name' => $r->by_name, 'reason' => $r->reason,
                    'counts' => json_decode($r->counts, true)])->all(),
            'audit' => DB::table('data_audit')->whereIn('action', ['restore_point', 'delete', 'restore', 'import', 'restore_file'])
                ->orderByDesc('id')->limit(20)->get(['id', 'at', 'by_name', 'action', 'details'])
                ->map(fn ($r) => ['id' => $r->id, 'at' => $r->at, 'by_name' => $r->by_name, 'action' => $r->action,
                    'details' => json_decode($r->details, true) ?? []])->all(),
        ];
    }

    /** public.admin_create_restore_point(p_reason) */
    public function createPoint(array $p, User $u): int
    {
        self::admin($u);
        $id = DataStore::makePoint(trim((string) ($p['p_reason'] ?? '')) ?: 'Manual');
        self::audit('restore_point', ['restore_point' => $id]);

        return $id;
    }

    /** public.admin_delete_data(p_scope, p_confirm) + password */
    public function delete(array $p, User $u): array
    {
        self::admin($u);
        $scope = $p['p_scope'] ?? null;
        if (! in_array($scope, ['old', 'new', 'all'], true)) {
            throw RpcError::bad('bad scope');
        }
        self::word($p, 'DELETE');
        self::password($p, $u);
        set_time_limit(300);

        $rp = DataStore::makePoint("Before delete ($scope)");
        $before = DataStore::counts();
        if ($scope !== 'old') {
            foreach (['adjustments', 'seizures', 'payments'] as $t) {
                DB::table($t)->whereNotNull('loan_id')->delete();
            }
            DB::table('loans')->delete();
            DB::table('borrowers')->delete();
        }
        if ($scope !== 'new') {
            foreach (['adjustments', 'seizures', 'payments'] as $t) {
                DB::table($t)->whereNotNull('legacy_account_id')->delete();
            }
            DB::table('legacy_payments')->delete();
            DB::table('legacy_accounts')->delete();
            DB::table('import_batches')->delete();
        }
        DataStore::changed();
        $after = DataStore::counts();
        self::audit('delete', ['scope' => $scope, 'restore_point' => $rp, 'before' => $before, 'after' => $after]);

        return ['restore_point' => $rp, 'before' => $before, 'after' => $after];
    }

    /** public.admin_restore(p_point, p_confirm) + password */
    public function restore(array $p, User $u): array
    {
        self::admin($u);
        self::word($p, 'RESTORE');
        $id = (int) ($p['p_point'] ?? 0);
        if (! DB::table('restore_points')->where('id', $id)->exists()) {
            throw RpcError::bad('restore point not found');
        }
        self::password($p, $u);
        set_time_limit(300);

        $new = DataStore::makePoint("Before restoring #$id");
        DataStore::putBack($id);
        $counts = DataStore::counts();
        self::audit('restore', ['restored' => $id, 'saved_before_restore' => $new, 'counts' => $counts]);

        return ['restored' => $id, 'saved_before_restore' => $new, 'counts' => $counts];
    }

    // ---------------------------------------------------------------- uploads waiting for confirmation

    /** A new upload of this kind; older ones of the same person, and any older than 3 hours, are dropped. */
    public static function begin(string $kind, User $u, array $values): string
    {
        $old = DB::table('staging_jobs')->where('created_at', '<', now()->subHours(3)->format('Y-m-d H:i:s.u'))
            ->orWhere(fn ($q) => $q->where('created_by', $u->id)->where('kind', $kind))->pluck('id');
        DB::table('staging_rows')->whereIn('job', $old)->delete();
        DB::table('staging_jobs')->whereIn('id', $old)->delete();
        $id = (string) Str::uuid();
        DB::table('staging_jobs')->insert(['id' => $id, 'kind' => $kind, 'created_by' => $u->id, 'created_at' => now()->format('Y-m-d H:i:s.u')] + $values);

        return $id;
    }

    /** app_private.my_backup_job / my_job: the person's own upload that is still waiting. */
    public static function job(array $p, string $kind, User $u): object
    {
        self::admin($u);
        $id = (string) ($p['p_job'] ?? '');
        $j = preg_match('/^[0-9a-f-]{36}$/', $id) ? DB::table('staging_jobs')->where('id', $id)->where('kind', $kind)->where('created_by', $u->id)->first() : null;
        if (! $j) {
            throw RpcError::bad($kind === 'backup' ? 'this upload has expired; choose the file again' : 'this upload has expired; choose the files again');
        }
        if ($j->status !== 'staged') {
            throw RpcError::bad($kind === 'backup' ? 'this backup was already restored' : 'this upload was already imported');
        }

        return $j;
    }

    /** Add rows to an upload (numbered on from the ones already there). */
    public static function stage(string $job, string $tbl, mixed $rows): int
    {
        if (! is_array($rows) || ! array_is_list($rows) || count($rows) > 5000) {
            throw RpcError::bad('send the rows as a list of at most 5,000');
        }
        $from = (int) DB::table('staging_rows')->where('job', $job)->where('tbl', $tbl)->max('n');
        DataStore::insertChunks('staging_rows', array_map(fn ($r, $k) => ['job' => $job, 'tbl' => $tbl, 'n' => $from + $k + 1,
            'row' => json_encode($r, JSON_UNESCAPED_UNICODE)], $rows, array_keys($rows)));

        return $from + count($rows);
    }

    /** Every staged row of a table, in order, a chunk at a time (they can be ~25,000). */
    public static function rows(string $job, string $tbl, callable $fn): void
    {
        DB::table('staging_rows')->where('job', $job)->where('tbl', $tbl)->select(['id', 'row'])
            ->chunkById(2000, function ($chunk) use ($fn) {
                $fn($chunk->map(fn ($r) => json_decode($r->row, true))->all());
            });
    }

    private static function done(string $job): void
    {
        DB::table('staging_jobs')->where('id', $job)->update(['status' => 'done']);
        DB::table('staging_rows')->where('job', $job)->delete();
    }

    // ---------------------------------------------------------------- restore from a backup file

    /** public.admin_backup_begin(p_file, p_taken) */
    public function backupBegin(array $p, User $u): string
    {
        self::admin($u);

        return self::begin('backup', $u, ['file_name' => mb_substr((string) ($p['p_file'] ?? ''), 0, 200), 'taken' => mb_substr((string) ($p['p_taken'] ?? ''), 0, 300)]);
    }

    /** public.admin_backup_stage(p_job, p_tbl, p_rows) */
    public function backupStage(array $p, User $u): int
    {
        $j = self::job($p, 'backup', $u);
        $t = (string) ($p['p_tbl'] ?? '');
        if (! in_array($t, DataStore::TABLES, true)) {
            throw RpcError::bad("unknown table $t");
        }

        return self::stage($j->id, $t, $p['p_rows'] ?? null);
    }

    /** public.admin_backup_preview(p_job) */
    public function backupPreview(array $p, User $u): array
    {
        $j = self::job($p, 'backup', $u);
        $people = DB::table('users')->pluck('id')->flip();
        $unknown = [];
        $tables = [];
        foreach (DataStore::TABLES as $t) {
            $n = DB::table('staging_rows')->where('job', $j->id)->where('tbl', $t)->count();
            $first = DB::table('staging_rows')->where('job', $j->id)->where('tbl', $t)->where('n', 1)->value('row');
            $all = array_keys(collect(DB::select('select column_name as c from information_schema.columns where table_schema = database() and table_name = ?', [$t]))
                ->keyBy('c')->all());
            $tables[] = ['table' => $t, 'in_backup' => $n, 'now' => DB::table($t)->count(), 'present' => $n > 0,
                'ignored_columns' => $first ? array_values(array_diff(array_keys(json_decode($first, true)), $all)) : []];
            if ($n) {
                self::rows($j->id, $t, function ($rows) use (&$unknown, $people) {
                    foreach ($rows as $r) {
                        foreach (['created_by', 'cancelled_by', 'received_by', 'reviewed_by', 'user_id'] as $k) {
                            if (($r[$k] ?? '') !== '' && ! isset($people[$r[$k]])) {
                                $unknown[$r[$k]] = true;
                            }
                        }
                    }
                });
            }
        }
        $has = DB::table('staging_rows')->where('job', $j->id)->whereIn('tbl', ['legacy_accounts', 'loans'])->exists();

        return ['file' => $j->file_name, 'taken' => $j->taken, 'tables' => $tables, 'unknown_people' => count($unknown), 'has_accounts' => $has];
    }

    /** public.admin_backup_commit(p_job, p_confirm) + password */
    public function backupCommit(array $p, User $u): array
    {
        $j = self::job($p, 'backup', $u);
        self::word($p, 'RESTORE');
        if (! DB::table('staging_rows')->where('job', $j->id)->whereIn('tbl', ['legacy_accounts', 'loans'])->exists()) {
            throw RpcError::bad('this backup has no accounts or loans; it does not look like a full backup');
        }
        self::password($p, $u);
        set_time_limit(300);

        $rp = DataStore::makePoint('Before restoring a backup file');
        $people = DB::table('users')->pluck('id')->flip()->all();
        DataStore::withoutKeys(function () use ($j, $u, $people) {
            DataStore::wipe();
            $problems = [];
            foreach (DataStore::TABLES as $t) {
                $want = 0;
                self::rows($j->id, $t, function ($rows) use ($t, $u, $people, &$want) {
                    $want += count($rows);
                    $vals = array_map(fn ($r) => DataStore::convert($t, $r, $u->id, $people), $rows);
                    if ($t === 'legacy_payments') {
                        $vals = array_map([self::class, 'withSeries'], $vals);
                    }
                    try {
                        DataStore::insertChunks($t, $vals);
                    } catch (QueryException $e) {
                        throw RpcError::bad("could not restore table $t (".Str::limit($e->getPrevious()?->getMessage() ?? $e->getMessage(), 200).'); nothing was changed');
                    }
                });
                $got = DB::table($t)->count();
                if ($want !== $got) {
                    $problems[] = "$t: $want in the file, $got restored";
                }
            }
            if ($problems) {
                throw RpcError::bad('check failed, nothing was changed: '.implode('; ', $problems));
            }
        });
        DataStore::refreshLegacyTotals();
        DataStore::changed();
        self::done($j->id);
        $counts = DataStore::counts();
        self::audit('restore_file', ['file' => $j->file_name, 'taken' => $j->taken, 'saved_before_restore' => $rp, 'counts' => $counts]);

        return ['saved_before_restore' => $rp, 'counts' => $counts];
    }

    /** Receipts from a backup made before receipt books existed: the zone's first book (app_private.legacy_series). */
    private static function withSeries(array $r): array
    {
        static $zones = null, $books = [];
        if (empty($r['series_id'])) {
            $zones ??= DB::table('legacy_accounts')->pluck('zone', 'id')->all();
            $zone = trim((string) ($zones[$r['account_id'] ?? 0] ?? ''));
            [$r['series_id'], $r['receipt_book']] = $books[$zone] ??= [$h = Receipts::historySeries($zone), Receipts::code($h)];
        }

        return $r;
    }

    // ---------------------------------------------------------------- import from the old software

    /** public.admin_import_begin(p_batches, p_checks) */
    public function importBegin(array $p, User $u): string
    {
        self::admin($u);

        return self::begin('import', $u, ['batches' => json_encode($p['p_batches'] ?? [], JSON_UNESCAPED_UNICODE),
            'checks' => json_encode($p['p_checks'] ?? [])]);
    }

    /** public.admin_import_stage(p_job, p_kind, p_rows) */
    public function importStage(array $p, User $u): int
    {
        $j = self::job($p, 'import', $u);
        $kind = $p['p_kind'] ?? '';
        if (! in_array($kind, ['acc', 'pay'], true)) {
            throw RpcError::bad('bad kind');
        }

        return self::stage($j->id, $kind, $p['p_rows'] ?? null);
    }

    /** public.admin_import_preview(p_job) */
    public function importPreview(array $p, User $u): array
    {
        set_time_limit(300);

        return LegacyImport::preview(self::job($p, 'import', $u));
    }

    /** public.admin_import_commit(p_job, p_confirm) + password */
    public function importCommit(array $p, User $u): array
    {
        $j = self::job($p, 'import', $u);
        self::word($p, 'IMPORT');
        if (json_decode((string) $j->preview, true)['duplicate_snos'] ?? []) {
            throw RpcError::bad('the files contain the same SNO twice; fix the files first');
        }
        self::password($p, $u);
        set_time_limit(300);

        $rp = DataStore::makePoint('Before import');
        $r = LegacyImport::commit($j, $u);
        self::done($j->id);
        DataStore::changed();
        $preview = json_decode((string) $j->preview, true) ?? [];
        unset($preview['files']);
        $kept = ['kept_accounts' => $r['kept_accounts'], 'kept_receipts' => $r['kept_receipts']];
        self::audit('import', ['restore_point' => $rp, 'batches' => $r['batches'], 'accounts' => $r['accounts'], 'receipts' => $r['receipts']] + $kept + ['preview' => $preview]);

        return ['restore_point' => $rp, 'accounts' => $r['accounts'], 'receipts' => $r['receipts']] + $kept;
    }
}

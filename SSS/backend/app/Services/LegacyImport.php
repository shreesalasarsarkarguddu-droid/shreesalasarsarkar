<?php

namespace App\Services;

use App\Models\User;
use App\Rpc\Data;
use App\Rpc\RpcError;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * Import from the old software (admin_import_preview / admin_import_commit). The page reads the 4 FoxPro files in the browser
 * (src/lib/legacy/parse.ts) and stages the rows: accounts ("acc") and receipts ("pay"), each with _file = which file.
 * Accounts are updated in place by SNO, new ones added, ones missing from the files kept; receipts are replaced for the SNOs in the files.
 */
final class LegacyImport
{
    public const FILES = ['F_ACC', 'P_ACCOUNT', 'F_INSMENT', 'P_INSMENT'];

    /** Fields of an account that are not its business details (app_private.acc_business leaves them out). */
    private const NOT_BUSINESS = ['_file', 'id', 'import_batch_id', 'raw', 'search_text', 'legacy_paid', 'legacy_payments_count', 'legacy_last_paid', 'recovery'];

    /** A value as compared: numbers (and booleans as 1 / 0) at 2 decimals, lists as JSON. */
    private static function norm(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }
        if (is_bool($v)) {
            $v = (int) $v; // MySQL gives booleans back as 1 / 0
        }
        if (is_array($v)) {
            return json_encode($v, JSON_UNESCAPED_UNICODE);
        }
        if (is_numeric($v) && ! preg_match('/^0\d/', (string) $v)) {
            return number_format((float) $v, 2, '.', '');
        }

        return (string) $v;
    }

    private static function receiptKey(array $r): string
    {
        return implode('|', [$r['ledger'], (int) $r['sno'], (int) $r['installment_no'], $r['paid_date'] ?? '', self::norm($r['paid_amount'] ?? null)]);
    }

    /** public.admin_import_preview: what would change. */
    public static function preview(object $j): array
    {
        $existing = [];
        foreach (DB::table('legacy_accounts')->orderBy('sno')->cursor() as $e) {
            $existing[(int) $e->sno] = (array) $e;
        }
        $seen = [];
        $dups = [];
        $cmp = [];
        Data::rows($j->id, 'acc', function ($rows) use (&$seen, &$dups, &$cmp, $existing) {
            foreach ($rows as $a) {
                $sno = (int) $a['sno'];
                if (isset($seen[$sno])) {
                    $dups[$sno] = $sno;
                }
                $seen[$sno] = true;
                $e = $existing[$sno] ?? null;
                $kind = 'new';
                if ($e) {
                    $kind = 'same';
                    foreach ($a as $k => $v) {
                        if (in_array($k, self::NOT_BUSINESS, true) || ! array_key_exists($k, $e)) {
                            continue;
                        }
                        $old = $k === 'data_flags' ? json_decode((string) $e[$k], true) : $e[$k];
                        if (self::norm($v) !== self::norm($old)) {
                            $kind = 'changed';
                            break;
                        }
                    }
                }
                $cmp[] = ['sno' => $sno, 'name' => $a['borrower_name'], 'kind' => $kind, 'from' => $e['ledger'] ?? null, 'to' => $a['ledger']];
            }
        });
        usort($cmp, fn ($x, $y) => $x['sno'] <=> $y['sno']);
        $pick = fn ($fn, $map) => array_map($map, array_slice(array_values(array_filter($cmp, $fn)), 0, 10));
        $moved = fn ($c) => $c['kind'] !== 'new' && $c['from'] !== $c['to'];
        $notIn = array_values(array_filter($existing, fn ($e) => ! isset($seen[(int) $e['sno']])));

        // receipts: the files' ones, the ones now for those SNOs, and the ones that look entered in both programs
        $newR = [];
        $snos = $seen;
        $fileRows = [];
        Data::rows($j->id, 'pay', function ($rows) use (&$newR, &$snos, &$fileRows) {
            foreach ($rows as $r) {
                $k = self::receiptKey($r);
                $newR[$k] = ($newR[$k] ?? 0) + 1;
                $snos[(int) $r['sno']] = true;
                $fileRows[(int) $r['sno']][] = ['receipt_no' => $r['receipt_no'], 'paid_date' => $r['paid_date'], 'paid_amount' => self::norm($r['paid_amount'])];
            }
        });
        $oldR = [];
        $nowCount = 0;
        foreach (array_chunk(array_keys($snos), 1000) as $chunk) {
            foreach (DB::table('legacy_payments')->whereIn('sno', $chunk)->get(['ledger', 'sno', 'installment_no', 'paid_date', 'paid_amount']) as $r) {
                $k = self::receiptKey((array) $r);
                $oldR[$k] = ($oldR[$k] ?? 0) + 1;
                $nowCount++;
            }
        }
        $minus = function ($a, $b) {
            $n = 0;
            foreach ($a as $k => $c) {
                $n += max(0, $c - ($b[$k] ?? 0));
            }

            return $n;
        };

        $risk = [];
        $likely = [];
        $app = DB::table('payments as p')->join('legacy_accounts as e', 'e.id', '=', 'p.legacy_account_id')
            ->orderBy('e.sno')->orderBy('p.paid_date')->get(['e.sno', 'e.borrower_name', 'p.receipt_no', 'p.paid_date', 'p.paid_amount']);
        foreach ($app->groupBy('sno') as $sno => $pays) {
            $file = $fileRows[$sno] ?? [];
            if (! $file) {
                continue;
            }
            $first = $pays->min('paid_date');
            $after = [];
            foreach ($file as $f) {
                if ($f['paid_date'] !== null && $f['paid_date'] >= $first) {
                    $after[] = $f;
                }
            }
            if ($after) {
                $risk[] = ['sno' => (int) $sno, 'name' => $pays[0]->borrower_name, 'app_first' => $first, 'file_receipts_after' => count($after)];
            }
            foreach ($pays as $ap) {
                foreach ($file as $f) {
                    $sameNo = $f['receipt_no'] !== null && (int) $f['receipt_no'] === (int) $ap->receipt_no;
                    if ($sameNo || ($f['paid_date'] === $ap->paid_date && $f['paid_amount'] === self::norm($ap->paid_amount))) {
                        $likely[] = ['sno' => (int) $sno, 'borrower_name' => $ap->borrower_name, 'why' => $sameNo ? 'same receipt no.' : 'same date and amount',
                            'app_receipt' => (int) $ap->receipt_no, 'app_date' => $ap->paid_date, 'app_amount' => (float) $ap->paid_amount,
                            'file_receipt' => $f['receipt_no'], 'file_date' => $f['paid_date'], 'file_amount' => (float) $f['paid_amount']];
                    }
                }
            }
        }

        $v = [
            'files' => json_decode((string) $j->batches, true),
            'checks' => json_decode((string) $j->checks, true),
            'duplicate_snos' => array_values($dups),
            'accounts' => [
                'in_files' => count($cmp),
                'new' => count(array_filter($cmp, fn ($c) => $c['kind'] === 'new')),
                'changed' => count(array_filter($cmp, fn ($c) => $c['kind'] === 'changed')),
                'same' => count(array_filter($cmp, fn ($c) => $c['kind'] === 'same')),
                'moved' => count(array_filter($cmp, $moved)),
                'not_in_files' => count($notIn),
                'examples_new' => $pick(fn ($c) => $c['kind'] === 'new', fn ($c) => ['sno' => $c['sno'], 'name' => $c['name']]),
                'examples_changed' => $pick(fn ($c) => $c['kind'] === 'changed', fn ($c) => ['sno' => $c['sno'], 'name' => $c['name']]),
                'examples_moved' => $pick($moved, fn ($c) => ['sno' => $c['sno'], 'name' => $c['name'], 'from' => $c['from'], 'to' => $c['to']]),
                'examples_not_in_files' => array_map(fn ($e) => ['sno' => (int) $e['sno'], 'name' => $e['borrower_name'], 'ledger' => $e['ledger']], array_slice($notIn, 0, 10)),
            ],
            'receipts' => ['in_files' => array_sum($newR), 'now_for_these_accounts' => $nowCount, 'added' => $minus($newR, $oldR), 'removed' => $minus($oldR, $newR)],
            'double_entry_risk' => $risk,
            'double_entry_likely' => $likely,
        ];
        DB::table('staging_jobs')->where('id', $j->id)->update(['preview' => json_encode($v, JSON_UNESCAPED_UNICODE)]);

        return $v;
    }

    /** public.admin_import_commit's body (inside the caller's transaction; a restore point is already saved). */
    public static function commit(object $j, User $u): array
    {
        $batches = json_decode((string) $j->batches, true);
        $checks = json_decode((string) $j->checks, true);
        $ids = [];
        foreach (self::FILES as $k) {
            $b = $batches[$k] ?? null;
            if (! $b) {
                throw RpcError::bad("the upload has no $k file");
            }
            $ids[$k] = DB::table('import_batches')->insertGetId([
                'source_file' => mb_substr((string) $b['source_file'], 0, 200), 'imported_at' => now()->format('Y-m-d H:i:s.u'),
                'imported_by' => 'website: '.($u->full_name ?: 'admin'), 'total_records' => (int) $b['total'], 'imported_records' => (int) $b['imported'],
                'skipped_records' => (int) $b['skipped'], 'flagged_records' => (int) $b['flagged'], 'status' => 'completed',
                'notes' => json_encode($b['notes'] ?? (object) [], JSON_UNESCAPED_UNICODE),
            ]);
        }

        // accounts: update in place by SNO (a zone chosen in the app stays), add new ones
        $accCols = array_keys(DataStore::columns('legacy_accounts'));
        $kept = DB::table('legacy_accounts')->where('zone_set_in_app', 1)->pluck('zone', 'sno')->all();
        $snos = [];
        $nAcc = 0;
        Data::rows($j->id, 'acc', function ($rows) use ($accCols, $kept, $ids, &$snos, &$nAcc) {
            $vals = [];
            foreach ($rows as $a) {
                $row = ['import_batch_id' => $ids[$a['_file']]];
                foreach ($a as $k => $v) {
                    if ($k !== '_file' && in_array($k, $accCols, true) && ! in_array($k, ['id', 'legacy_paid', 'legacy_payments_count', 'legacy_last_paid', 'zone_set_in_app'], true)) {
                        $row[$k] = is_array($v) ? json_encode($v, JSON_UNESCAPED_UNICODE) : (is_bool($v) ? (int) $v : $v);
                    }
                }
                if (array_key_exists((int) $a['sno'], $kept)) {
                    $row['zone'] = $kept[(int) $a['sno']];
                }
                $vals[] = $row;
                $snos[(int) $a['sno']] = true;
            }
            DataStore::insertChunks('legacy_accounts', $vals, ['sno']);
            $nAcc += count($vals);
        });

        // receipts: replace for the SNOs in the files only
        Data::rows($j->id, 'pay', function ($rows) use (&$snos) {
            foreach ($rows as $r) {
                $snos[(int) $r['sno']] = true;
            }
        });
        $snoList = array_keys($snos);
        foreach (array_chunk($snoList, 1000) as $chunk) {
            DB::table('legacy_payments')->whereIn('sno', $chunk)->delete();
        }
        $acct = DB::table('legacy_accounts')->get(['id', 'sno', 'zone'])->keyBy('sno');
        $series = [];
        $payCols = array_keys(DataStore::columns('legacy_payments'));
        $nPay = 0;
        Data::rows($j->id, 'pay', function ($rows) use ($acct, $ids, $payCols, &$series, &$nPay) {
            $vals = [];
            foreach ($rows as $p) {
                $a = $acct[(int) $p['sno']] ?? null;
                $zone = $a ? trim((string) $a->zone) : '';
                [$sid, $book] = $series[$zone] ??= [$h = Receipts::historySeries($zone), Receipts::code($h)]; // once per zone
                $row = ['account_id' => $a?->id, 'import_batch_id' => $ids[$p['_file']], 'series_id' => $sid, 'receipt_book' => $book];
                foreach ($p as $k => $v) {
                    if ($k !== '_file' && in_array($k, $payCols, true) && ! array_key_exists($k, $row) && $k !== 'id') {
                        $row[$k] = is_array($v) ? json_encode($v, JSON_UNESCAPED_UNICODE) : $v;
                    }
                }
                $vals[] = $row;
            }
            DataStore::insertChunks('legacy_payments', $vals);
            $nPay += count($vals);
        });
        DataStore::refreshLegacyTotals($snoList);

        // the totals must match the files, or nothing is imported
        $problems = [];
        foreach (['F_ACC' => ['legacy_accounts', 'closed', 'total_amount'], 'P_ACCOUNT' => ['legacy_accounts', 'pending', 'total_amount'],
            'F_INSMENT' => ['legacy_payments', 'closed', 'paid_amount'], 'P_INSMENT' => ['legacy_payments', 'pending', 'paid_amount']] as $k => [$t, $ledger, $col]) {
            $got = DB::table($t)->where('import_batch_id', $ids[$k])->where('ledger', $ledger)->selectRaw("count(*) n, coalesce(sum($col), 0) total")->first();
            if ((int) $got->n !== (int) ($checks[$k]['rows'] ?? -1) || Money::paise((string) $got->total) !== Money::paise((string) ($checks[$k]['total'] ?? 'x'))) {
                $problems[] = $t === 'legacy_accounts' ? "$k: accounts or total payable do not match the file" : "$k: receipts or total paid do not match the file";
            }
        }
        if ($problems) {
            throw RpcError::bad('check failed, nothing was imported: '.implode('; ', $problems));
        }

        return ['batches' => $ids, 'accounts' => $nAcc, 'receipts' => $nPay];
    }
}

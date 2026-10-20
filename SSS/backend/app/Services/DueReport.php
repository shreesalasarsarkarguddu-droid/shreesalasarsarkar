<?php

namespace App\Services;

use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * Every open account with its EMI, balance, arrears, due EMIs and next due date as of a day — public.due_report of the
 * old app, computed here in a few queries + PHP (the same steps, see SSS/reference/pg-functions.sql).
 * Used by Due Installments, Finance Details, the Dashboard and Assign.
 */
final class DueReport
{
    /** @return list<array<string, mixed>> one row per open account (money as "1234.50" strings) */
    public static function run(string $asOf): array
    {
        $accts = self::accounts();
        if (! $accts) {
            return [];
        }
        $byAcct = [];
        $byLoan = [];
        foreach ($accts as $k => $a) {
            if ($a['acct_id']) {
                $byAcct[$a['acct_id']] = $k;
            } else {
                $byLoan[$a['loan_id']] = $k;
            }
        }

        // late fees / discounts and the reschedule in force
        foreach (DB::table('adjustments')->whereNull('cancelled_at')
            ->selectRaw('legacy_account_id, loan_id, sum(amount) as adj')->groupBy('legacy_account_id', 'loan_id')->get() as $r) {
            $k = $r->legacy_account_id ? ($byAcct[$r->legacy_account_id] ?? null) : ($byLoan[$r->loan_id] ?? null);
            if ($k !== null) {
                $accts[$k]['adj'] += Money::paise($r->adj);
            }
        }
        foreach (DB::table('adjustments')->where('kind', 'reschedule')->whereNull('cancelled_at')
            ->orderBy('created_at')->orderBy('id')->get(['legacy_account_id', 'loan_id', 'created_at', 'entry_date', 'new_emi', 'next_due']) as $r) {
            $k = $r->legacy_account_id ? ($byAcct[$r->legacy_account_id] ?? null) : ($byLoan[$r->loan_id] ?? null);
            if ($k !== null) { // ordered oldest first: the last one wins
                $accts[$k]['rs'] = ['at' => $r->created_at, 'date' => $r->entry_date, 'emi' => Money::paise($r->new_emi), 'due' => $r->next_due];
            }
        }

        // receipts: old software (pending file) + app payments
        $rc = [];
        foreach (DB::table('legacy_payments')->where('ledger', 'pending')->whereNotNull('account_id')
            ->get(['account_id', 'installment_no', 'paid_date', 'due_date', 'paid_amount', 'delay_days']) as $r) {
            if (($k = $byAcct[$r->account_id] ?? null) !== null) {
                $rc[$k][] = ['n' => (int) $r->installment_no, 'pd' => $r->paid_date, 'd' => $r->due_date, 'amt' => Money::paise($r->paid_amount),
                    'stored' => null, 'dd' => $r->delay_days, 'ca' => null];
            }
        }
        foreach (DB::table('payments')->get(['legacy_account_id', 'loan_id', 'installment_no', 'paid_date', 'due_date', 'paid_amount',
            'installments_covered', 'delay_days', 'created_at']) as $r) {
            $k = $r->legacy_account_id ? ($byAcct[$r->legacy_account_id] ?? null) : ($byLoan[$r->loan_id] ?? null);
            if ($k !== null) {
                $rc[$k][] = ['n' => (int) $r->installment_no, 'pd' => $r->paid_date, 'd' => $r->due_date, 'amt' => Money::paise($r->paid_amount),
                    'stored' => (int) $r->installments_covered, 'dd' => $r->delay_days, 'ca' => $r->created_at];
            }
        }

        $out = [];
        foreach ($accts as $k => $a) {
            $out[] = self::one($a, $rc[$k] ?? [], $asOf);
        }

        return $out;
    }

    /** acct0: open old accounts (pending, not closed in the app) and active / seized new loans. */
    private static function accounts(): array
    {
        $rows = [];
        $settled = DB::table('adjustments')->where('kind', 'settle')->whereNull('cancelled_at')->whereNotNull('legacy_account_id')
            ->pluck('legacy_account_id')->flip();
        $seizedEvent = [];
        foreach (DB::table('seizures')->whereNotNull('legacy_account_id')->orderBy('created_at')->orderBy('id')->get(['legacy_account_id', 'action']) as $s) {
            $seizedEvent[$s->legacy_account_id] = $s->action === 'seize'; // latest wins
        }
        foreach (DB::table('legacy_accounts')->where('ledger', 'pending')->get() as $a) {
            if (isset($settled[$a->id])) {
                continue;
            }
            $folio = ($a->fcode ?? '') !== '' ? "{$a->fcode}-{$a->fno}" : (string) $a->fno;
            $rows[] = [
                'src' => 'old', 'ref' => (int) $a->sno, 'acct_id' => (int) $a->id, 'loan_id' => null, 'folio' => $folio,
                'nm' => $a->borrower_name, 'model' => $a->vehicle_model,
                'mob' => self::nullIfEmpty(self::concatWs(', ', [$a->borrower_mobile, $a->borrower_mobile2])),
                'vno' => $a->registration_no,
                'sz' => $seizedEvent[$a->id] ?? ($a->seized === null ? false : (bool) $a->seized),
                'st' => mb_strtolower(self::concatWs(' ', [$a->search_text, $a->chassis_no, $a->engine_no, ($a->fcode ?? '') !== '' ? "{$a->fcode}-{$a->fno}" : null])),
                'emi' => Money::paise($a->emi_amount), 'total' => Money::paise($a->total_amount), 'tenure' => $a->tenure_months === null ? null : (int) $a->tenure_months,
                'iv' => max((int) ($a->interval_months ?? 1), 1), 'start' => $a->agreement_date,
                'fin' => Money::paise($a->finance_amount), 'intr' => Money::paise($a->interest_amount),
                'other' => Money::paise($a->agreement_amount) + Money::paise($a->hp_amount), 'adj' => 0, 'rs' => null,
            ];
        }
        foreach (DB::table('loans as l')->join('borrowers as b', 'b.id', '=', 'l.borrower_id')->whereIn('l.status', ['active', 'seized'])
            ->get(['l.*', 'b.full_name', 'b.father_name', 'b.mobile']) as $l) {
            $rows[] = [
                'src' => 'new', 'ref' => (int) $l->id, 'acct_id' => null, 'loan_id' => (int) $l->id, 'folio' => $l->folio_no,
                'nm' => $l->full_name, 'model' => $l->vehicle_model, 'mob' => $l->mobile, 'vno' => $l->vehicle_no, 'sz' => $l->status === 'seized',
                'st' => mb_strtolower(self::concatWs(' ', [$l->folio_no, $l->full_name, $l->father_name, $l->mobile, $l->vehicle_no, $l->chassis_no, $l->engine_no])),
                'emi' => Money::paise($l->emi_amount), 'total' => Money::paise($l->total_amount), 'tenure' => (int) $l->installments,
                'iv' => max((int) $l->interval_months, 1), 'start' => $l->agreement_date,
                'fin' => Money::paise($l->finance_amount), 'intr' => Money::paise($l->interest_amount),
                'other' => Money::paise($l->agreement_amount) + Money::paise($l->hp_amount), 'adj' => 0, 'rs' => null,
            ];
        }

        return $rows;
    }

    /** One account's row (the calc / slots / rs* / fin steps of due_report). */
    private static function one(array $a, array $rc, string $asOf): array
    {
        $iv = $a['iv'];
        // window order: installment no., then paid date (no date first)
        usort($rc, fn ($x, $y) => [$x['n'], $x['pd'] === null ? 0 : 1, $x['pd'] ?? ''] <=> [$y['n'], $y['pd'] === null ? 0 : 1, $y['pd'] ?? '']);
        $cnt = count($rc);
        for ($i = 0; $i < $cnt; $i++) {
            $r = &$rc[$i];
            $next = $rc[$i + 1]['d'] ?? null;
            $gap = ($r['d'] !== null && $next !== null) ? self::monthIndex($next) - self::monthIndex($r['d']) : null;
            if ($r['stored'] !== null && $r['stored'] > 0) {
                $r['im'] = $r['stored'];
            } elseif ($gap !== null && $gap > 0 && $gap % $iv === 0 && intdiv($gap, $iv) >= 1 && intdiv($gap, $iv) <= 60) {
                $r['im'] = intdiv($gap, $iv);
            } elseif ($a['emi'] > 0) {
                $r['im'] = AccountMath::imOf($r['amt'], $a['emi']);
            } else {
                $r['im'] = 1;
            }
            unset($r);
        }

        $paid = 0;
        $used = 0;
        $lastPaid = null;
        $late = 0;
        $rdue = 0;
        $lastDue = null;
        $lastIm = null;
        $lastKey = null;
        foreach ($rc as $r) {
            $paid += $r['amt'];
            $used += $r['im'];
            if ($r['pd'] !== null && ($lastPaid === null || $r['pd'] > $lastPaid)) {
                $lastPaid = $r['pd'];
            }
            $late += (int) ($r['dd'] ?? 0);
            if ($r['d'] !== null) {
                // lastr: highest installment no., then latest paid date (no date last)
                $key = [$r['n'], $r['pd'] === null ? 0 : 1, $r['pd'] ?? ''];
                if ($lastKey === null || $key > $lastKey) {
                    $lastKey = $key;
                    $lastDue = $r['d'];
                    $lastIm = $r['im'];
                }
                // EMI slots this receipt covers that fall on or before the day
                for ($j = 0; $j < $r['im']; $j++) {
                    if (self::addMonths($r['d'], $j * $iv) <= $asOf) {
                        $rdue++;
                    }
                }
            }
        }

        $bal = $a['total'] + $a['adj'] - $paid;
        $remaining = $bal <= 0 ? 0 : max(0, max((int) ($a['tenure'] ?? 0), $used) - $used);
        $rs = $a['rs'];
        $emiNow = $rs ? $rs['emi'] : $a['emi'];

        if ($rs) {
            $before = 0;
            foreach ($rc as $r) {
                if (($r['ca'] !== null && $r['ca'] < $rs['at']) || ($r['ca'] === null && ($r['pd'] === null || $r['pd'] < $rs['date']))) {
                    $before += $r['amt'];
                }
            }
            $owed = $a['total'] + $a['adj'];
            $after = $paid - $before;
            $n = max(0, self::ceilDiv($owed - $before, $rs['emi']));
            $cov = min($n, max(0, self::floorDiv($after, $rs['emi'])));
            $dle = 0;
            $dlt = 0;
            for ($k = 1; $k <= $n; $k++) {
                $due = self::addMonths($rs['due'], ($k - 1) * $iv);
                $dle += $due <= $asOf ? 1 : 0;
                $dlt += $due < $asOf ? 1 : 0;
            }
            $nd = ($bal > 0 && $cov < $n) ? self::addMonths($rs['due'], $cov * $iv) : null;
            $overdue = max(0, $dlt - $cov);
            $arr = $bal <= 0 ? 0 : max(0, min($bal, $rs['emi'] * $dle - $after));
        } else {
            $nd = null;
            $dueLe = 0;
            $overdue = 0;
            for ($k = 1; $k <= $remaining; $k++) {
                $due = $lastDue !== null ? self::addMonths($lastDue, ($lastIm + $k - 1) * $iv)
                    : ($a['start'] !== null ? self::addMonths($a['start'], ($used + $k) * $iv) : null);
                if ($k === 1) {
                    $nd = $due;
                }
                if ($due !== null) {
                    $dueLe += $due <= $asOf ? 1 : 0;
                    $overdue += $due < $asOf ? 1 : 0;
                }
            }
            $arr = $bal <= 0 ? 0 : max(0, min($bal, $a['emi'] * ($rdue + $dueLe) - $paid));
        }
        // due EMIs with one decimal, rounded half up: floor((arr*10 + emi/2) / emi) / 10 (in paise)
        $dueEmis = $emiNow > 0 ? intdiv($arr * 10 + intdiv($emiNow, 2), $emiNow) / 10 : 0;

        return [
            'source' => $a['src'], 'ref_id' => $a['ref'], 'folio' => $a['folio'], 'borrower_name' => $a['nm'], 'vehicle_model' => $a['model'],
            'mobile' => $a['mob'], 'vehicle_no' => $a['vno'], 'seized' => $a['sz'], 'search_text' => $a['st'],
            'emi' => Money::str($emiNow), 'balance' => Money::str($bal), 'arrears' => Money::str($arr), 'overdue_emis' => $overdue,
            'due_emis' => $dueEmis, 'next_due' => $nd, 'agreement_date' => $a['start'], 'tenure' => $a['tenure'],
            'finance_amount' => Money::str($a['fin']), 'interest_amount' => Money::str($a['intr']), 'other_charges' => Money::str($a['other'] + $a['adj']),
            'total_amount' => Money::str($a['total'] + $a['adj']), 'total_paid' => Money::str($paid), 'last_paid' => $lastPaid, 'late_days' => $late,
        ];
    }

    private static function monthIndex(string $d): int
    {
        return (int) substr($d, 0, 4) * 12 + (int) substr($d, 5, 2);
    }

    /** date + n months, the day clamped to the month's last day (Postgres date + interval). */
    public static function addMonths(string $d, int $n): string
    {
        $t = (int) substr($d, 0, 4) * 12 + (int) substr($d, 5, 2) - 1 + $n;
        $y = intdiv($t, 12);
        $m = $t % 12 + 1;

        return sprintf('%04d-%02d-%02d', $y, $m, min((int) substr($d, 8, 2), cal_days_in_month(CAL_GREGORIAN, $m, $y)));
    }

    private static function ceilDiv(int $a, int $b): int
    {
        return intdiv($a, $b) + (($a % $b !== 0 && (($a > 0) === ($b > 0))) ? 1 : 0);
    }

    private static function floorDiv(int $a, int $b): int
    {
        return intdiv($a, $b) - (($a % $b !== 0 && (($a < 0) !== ($b < 0))) ? 1 : 0);
    }

    private static function concatWs(string $sep, array $parts): string
    {
        return implode($sep, array_filter($parts, fn ($p) => $p !== null));
    }

    private static function nullIfEmpty(string $s): ?string
    {
        return $s === '' ? null : $s;
    }
}

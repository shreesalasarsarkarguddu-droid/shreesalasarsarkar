<?php

namespace App\Services;

use App\Support\Money;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Balances and due dates of one account, the same maths as the old database functions
 * (adj_total, owed, active_reschedule, paid_since_reschedule, next_due_date, reflow_payments).
 * $acct = legacy_accounts.id (old software account) or $loan = loans.id (new loan); exactly one is set.
 */
final class AccountMath
{
    /** Sum of late fees (+), discounts / settlement (-) not cancelled, in paise. */
    public static function adjTotal(?int $acct, ?int $loan): int
    {
        $v = DB::table('adjustments')->whereNull('cancelled_at')
            ->where(fn ($q) => $acct ? $q->where('legacy_account_id', $acct) : $q->where('loan_id', $loan))
            ->sum('amount');

        return Money::paise((string) $v);
    }

    public static function legacySettled(int $acct): bool
    {
        return DB::table('adjustments')->where('legacy_account_id', $acct)->where('kind', 'settle')->whereNull('cancelled_at')->exists();
    }

    /** The reschedule in force (latest, not cancelled), or null. */
    public static function activeReschedule(?int $acct, ?int $loan): ?object
    {
        return DB::table('adjustments')->where('kind', 'reschedule')->whereNull('cancelled_at')
            ->where(fn ($q) => $acct ? $q->where('legacy_account_id', $acct) : $q->where('loan_id', $loan))
            ->orderByDesc('created_at')->orderByDesc('id')->first();
    }

    /** Paid since the reschedule (old receipts on/after its date + app payments made after it), in paise. */
    public static function paidSinceReschedule(?int $acct, ?int $loan, ?object $rs = null): int
    {
        $rs ??= self::activeReschedule($acct, $loan);
        if (! $rs) {
            return 0;
        }
        $v = 0;
        if ($acct) {
            $v = Money::paise((string) DB::table('legacy_payments as lp')
                ->join('legacy_accounts as a', fn ($j) => $j->on('a.id', '=', 'lp.account_id')->on('a.ledger', '=', 'lp.ledger'))
                ->where('lp.account_id', $acct)->where('lp.paid_date', '>=', $rs->entry_date)->sum('lp.paid_amount'));
        }

        return $v + Money::paise((string) DB::table('payments')
            ->where(fn ($q) => $acct ? $q->where('legacy_account_id', $acct) : $q->where('loan_id', $loan))
            ->where('created_at', '>', $rs->created_at)->sum('paid_amount'));
    }

    /** Balance still owed, in paise (total + adjustments - everything paid). */
    public static function owed(?int $acct, ?int $loan): int
    {
        if ($acct) {
            $a = DB::table('legacy_accounts')->where('id', $acct)->first(['total_amount', 'legacy_paid']);

            return Money::paise($a->total_amount) + self::adjTotal($acct, null) - Money::paise($a->legacy_paid)
                - Money::paise((string) DB::table('payments')->where('legacy_account_id', $acct)->sum('paid_amount'));
        }
        $l = DB::table('loans')->where('id', $loan)->first(['total_amount']);

        return Money::paise($l->total_amount) + self::adjTotal(null, $loan)
            - Money::paise((string) DB::table('payments')->where('loan_id', $loan)->sum('paid_amount'));
    }

    /** EMIs one old receipt counts for: round(paid / emi), at least 1 (1 when the EMI is 0). */
    public static function imOf(int $paidPaise, int $emiPaise): int
    {
        return $emiPaise > 0 ? max(1, intdiv(2 * $paidPaise + $emiPaise, 2 * $emiPaise)) : 1;
    }

    public static function addMonths(string $date, int $months): string
    {
        return CarbonImmutable::parse($date)->addMonthsNoOverflow($months)->toDateString();
    }

    /** Due date of the next payment (app_private.next_due_date). */
    public static function nextDueDate(?object $rs, int $iv, ?string $start, int $used, ?string $lastDue, ?int $lastIm, int $paidAfterPaise): ?string
    {
        if ($rs) {
            $k = max(0, intdiv($paidAfterPaise, Money::paise($rs->new_emi)));

            return self::addMonths($rs->next_due, $k * $iv);
        }
        if ($lastDue !== null) {
            return self::addMonths($lastDue, (int) $lastIm * $iv);
        }
        if ($start !== null) {
            return self::addMonths($start, ($used + 1) * $iv);
        }

        return null;
    }

    public static function days(string $from, string $to): int
    {
        return (int) CarbonImmutable::parse($from)->diffInDays(CarbonImmutable::parse($to), false);
    }

    /**
     * Number, due date, EMI and balance for the next payment on this account (app_private.post_payment before its insert).
     * Returns null when the account is not open.
     */
    public static function nextPayment(string $source, int $ref, int $amountPaise, string $paidDate, int $im): ?array
    {
        $acct = $loan = null;
        if ($source === 'old') {
            $a = DB::table('legacy_accounts')->where('sno', $ref)->where('ledger', 'pending')->first();
            if (! $a || self::legacySettled($a->id)) {
                return null;
            }
            $acct = $a->id;
            $total = Money::paise($a->total_amount);
            $emi = Money::paise($a->emi_amount);
            $iv = max((int) ($a->interval_months ?? 1), 1);
            $start = $a->agreement_date;
            $rows = [];
            foreach (DB::table('legacy_payments')->where('account_id', $acct)->where('ledger', 'pending')
                ->get(['installment_no', 'paid_amount', 'due_date']) as $r) {
                $p = Money::paise($r->paid_amount);
                $rows[] = ['n' => $r->installment_no, 'amt' => $p, 'im' => self::imOf($p, $emi), 'due' => $r->due_date];
            }
            foreach (DB::table('payments')->where('legacy_account_id', $acct)->get(['installment_no', 'paid_amount', 'installments_covered', 'due_date']) as $r) {
                $rows[] = ['n' => $r->installment_no, 'amt' => Money::paise($r->paid_amount), 'im' => (int) $r->installments_covered, 'due' => $r->due_date];
            }
        } else {
            $l = DB::table('loans')->where('id', $ref)->whereIn('status', ['active', 'seized'])->first();
            if (! $l) {
                return null;
            }
            $loan = $l->id;
            $total = Money::paise($l->total_amount);
            $emi = Money::paise($l->emi_amount);
            $iv = (int) $l->interval_months;
            $start = $l->agreement_date;
            $rows = [];
            foreach (DB::table('payments')->where('loan_id', $loan)->get(['installment_no', 'paid_amount', 'installments_covered', 'due_date']) as $r) {
                $rows[] = ['n' => $r->installment_no, 'amt' => Money::paise($r->paid_amount), 'im' => (int) $r->installments_covered, 'due' => $r->due_date];
            }
        }

        $paid = array_sum(array_column($rows, 'amt'));
        $next = ($rows ? max(array_column($rows, 'n')) : 0) + 1;
        $used = array_sum(array_column($rows, 'im'));
        $withDue = array_values(array_filter($rows, fn ($r) => $r['due'] !== null));
        usort($withDue, fn ($x, $y) => $y['n'] <=> $x['n']);
        $lastDue = $withDue[0]['due'] ?? null;
        $lastIm = $withDue[0]['im'] ?? null;

        $total += self::adjTotal($acct, $loan);
        $rs = self::activeReschedule($acct, $loan);
        $due = self::nextDueDate($rs, $iv, $start, $used, $lastDue, $lastIm, self::paidSinceReschedule($acct, $loan, $rs));
        if ($rs) {
            $emi = Money::paise($rs->new_emi);
        }

        return [
            'legacy_account_id' => $acct,
            'loan_id' => $loan,
            'installment_no' => $next,
            'due_date' => $due,
            'due_amount' => Money::str($emi),
            'balance_after' => Money::str($total - $paid - $amountPaise),
            'delay_days' => $due === null ? null : self::days($due, $paidDate),
        ];
    }

    /**
     * Recalculate number, due date, EMI, balance and delay of every app payment on an account
     * after one was edited or cancelled (app_private.reflow_payments).
     */
    public static function reflow(?int $acct, ?int $loan): void
    {
        $rs = self::activeReschedule($acct, $loan);
        $after = 0;
        $paid = 0;
        $n = 0;
        $used = 0;
        $lastDue = null;
        $lastIm = null;
        if ($acct) {
            $a = DB::table('legacy_accounts')->where('id', $acct)->first();
            $total = Money::paise($a->total_amount);
            $emi = Money::paise($a->emi_amount);
            $iv = max((int) ($a->interval_months ?? 1), 1);
            $start = $a->agreement_date;
            $lps = DB::table('legacy_payments')->where('account_id', $acct)->where('ledger', $a->ledger)->orderBy('installment_no')->get();
            foreach ($lps as $r) {
                $p = Money::paise($r->paid_amount);
                $paid += $p;
                $n = max($n, (int) $r->installment_no);
                $used += self::imOf($p, $emi);
                if ($rs && $r->paid_date !== null && $r->paid_date >= $rs->entry_date) {
                    $after += $p;
                }
            }
            $last = $lps->filter(fn ($r) => $r->due_date !== null)->sortByDesc('installment_no')->first();
            if ($last) {
                $lastDue = $last->due_date;
                $lastIm = self::imOf(Money::paise($last->paid_amount), $emi);
            }
        } else {
            $l = DB::table('loans')->where('id', $loan)->first();
            $total = Money::paise($l->total_amount);
            $emi = Money::paise($l->emi_amount);
            $iv = max((int) $l->interval_months, 1);
            $start = $l->agreement_date;
        }
        $total += self::adjTotal($acct, $loan);

        $col = $acct ? 'legacy_account_id' : 'loan_id';
        $id = $acct ?: $loan;
        // move numbers out of the way first (unique account + installment no.)
        DB::table('payments')->where($col, $id)->update(['installment_no' => DB::raw('installment_no + 100000')]);
        foreach (DB::table('payments')->where($col, $id)->orderBy('installment_no')->orderBy('id')->get() as $r) {
            $n++;
            $afterRs = $rs && $r->created_at > $rs->created_at;
            if ($afterRs) {
                $due = self::addMonths($rs->next_due, max(0, intdiv($after, Money::paise($rs->new_emi))) * $iv);
                $after += Money::paise($r->paid_amount);
            } elseif ($lastDue !== null) {
                $due = self::addMonths($lastDue, (int) $lastIm * $iv);
            } elseif ($start !== null) {
                $due = self::addMonths($start, ($used + 1) * $iv);
            } else {
                $due = null;
            }
            $paid += Money::paise($r->paid_amount);
            DB::table('payments')->where('id', $r->id)->update([
                'installment_no' => $n,
                'due_date' => $due,
                'due_amount' => $afterRs ? $rs->new_emi : Money::str($emi),
                'balance_after' => Money::str($total - $paid),
                'delay_days' => $due === null ? null : self::days($due, $r->paid_date),
            ]);
            $used += (int) $r->installments_covered;
            if ($due !== null) {
                $lastDue = $due;
                $lastIm = (int) $r->installments_covered;
            }
        }
    }
}

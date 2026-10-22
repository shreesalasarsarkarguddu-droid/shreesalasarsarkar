<?php

namespace App\Services;

use App\Support\Money;
use Illuminate\Support\Facades\DB;

/** Day Book, Seized Vehicles, Dashboard and staff performance (the old views / functions, see SSS/reference). */
final class Reports
{
    // ---------------------------------------------------------------- Day Book (view day_book_entries)

    /** CASH or no mode (old software) is cash; everything else (BOB, SBI, SSS, BANK, UPI, ...) is bank. */
    private static function isCash(?string $mode): bool
    {
        return strtoupper(trim($mode ?? 'CASH')) === 'CASH';
    }

    /** cash / bank parts of an amount paid or given in one mode. */
    private static function parts(?string $mode, string $amount): array
    {
        return self::isCash($mode) ? ['cash' => Money::dec($amount), 'bank' => '0.00'] : ['cash' => '0.00', 'bank' => Money::dec($amount)];
    }

    /**
     * Receipts (old software + app) and loans given, between two days, sorted like the old report:
     * day, receipts before loans, particulars, account. Each entry has its cash and bank part;
     * with $mode 'cash' or 'bank' only the entries that have such a part are given.
     */
    public static function dayBook(string $from, string $to, string $mode = 'all'): array
    {
        $rows = array_merge(
            self::legacyReceipts(fn ($q) => $q->whereBetween('lp.paid_date', [$from, $to])),
            self::appReceipts(fn ($q) => $q->whereBetween('p.paid_date', [$from, $to])),
            self::loansGiven($from, $to),
        );
        usort($rows, fn ($a, $b) => [$a['entry_date'], $a['kind_order'], mb_strtolower($a['particulars']), $a['ref_id']]
            <=> [$b['entry_date'], $b['kind_order'], mb_strtolower($b['particulars']), $b['ref_id']]);

        if ($mode === 'cash' || $mode === 'bank') {
            $rows = array_filter($rows, fn ($r) => Money::paise($r[$mode]) > 0);
        }

        return array_values(array_map(function ($r) {
            unset($r['kind_order']);

            return $r;
        }, $rows));
    }

    /**
     * Totals of every entry before the first day, for one mode ('all', 'cash' or 'bank'), with the cash part of each side
     * (public.day_book_opening).
     */
    public static function dayBookOpening(string $from, string $mode = 'all'): array
    {
        $cashSql = fn (string $amount, string $modeCol) => "coalesce(sum($amount), 0) as total, "
            ."coalesce(sum(case when upper(trim(coalesce($modeCol, 'CASH'))) = 'CASH' then $amount else 0 end), 0) as cash";
        $old = DB::table('legacy_payments as lp')->leftJoin('legacy_accounts as a', 'a.id', '=', 'lp.account_id')
            ->whereNotNull('lp.paid_date')->where('lp.paid_date', '<', $from)
            ->where(fn ($q) => $q->whereNull('a.id')->orWhereColumn('lp.ledger', 'a.ledger'))
            ->selectRaw($cashSql('lp.paid_amount', 'lp.payment_mode'))->first();
        $dr = Money::paise((string) $old->total);
        $cashDr = Money::paise((string) $old->cash);
        foreach (DB::table('payments')->where('paid_date', '<', $from)->get(['payment_mode', 'paid_amount', 'charges', 'parts']) as $p) {
            $got = self::received($p);
            $dr += Money::paise($got);
            $cashDr += self::cashPart($p->payment_mode, $got, $p->parts);
        }
        $cr = $cashCr = 0;
        foreach ([DB::table('legacy_accounts')->whereNotNull('agreement_date')->where('agreement_date', '<', $from)->where('finance_amount', '>', 0)
            ->selectRaw($cashSql('finance_amount', 'finance_mode'))->first(),
            DB::table('loans')->where('agreement_date', '<', $from)->selectRaw($cashSql('finance_amount', 'loan_type'))->first()] as $x) {
            $cr += Money::paise((string) $x->total);
            $cashCr += Money::paise((string) $x->cash);
        }
        [$dr, $cr, $cashDr, $cashCr] = match ($mode) {
            'cash' => [$cashDr, $cashCr, $cashDr, $cashCr],
            'bank' => [$dr - $cashDr, $cr - $cashCr, 0, 0],
            default => [$dr, $cr, $cashDr, $cashCr],
        };

        return ['debit' => Money::str($dr), 'credit' => Money::str($cr), 'cash_debit' => Money::str($cashDr), 'cash_credit' => Money::str($cashCr)];
    }

    /** Money received on an app payment: the EMI part + the charges on the same receipt. */
    public static function received(object $p): string
    {
        return Money::str(Money::paise($p->paid_amount) + Money::paise($p->charges ?? '0'));
    }

    private static function legacyReceipts(callable $where): array
    {
        $q = DB::table('legacy_payments as lp')->leftJoin('legacy_accounts as a', 'a.id', '=', 'lp.account_id')
            ->whereNotNull('lp.paid_date')->where(fn ($q) => $q->whereNull('a.id')->orWhereColumn('lp.ledger', 'a.ledger'));
        $where($q);
        $out = [];
        foreach ($q->get(['lp.paid_date', 'lp.paid_amount', 'lp.due_amount', 'lp.due_date', 'lp.delay_days', 'lp.payment_mode', 'lp.receipt_no',
            'lp.sno', 'lp.receipt_book', 'a.borrower_name', 'a.registration_no', 'a.fno', 'a.emi_amount']) as $r) {
            $emi = Money::paise($r->emi_amount);
            $out[] = [
                'entry_date' => $r->paid_date, 'kind_order' => 1, 'kind' => 'receipt',
                'particulars' => ($r->borrower_name ?? 'UNKNOWN ACCOUNT').($r->registration_no !== null ? ' '.$r->registration_no : ''),
                'folio' => $r->fno === null ? null : (string) $r->fno, 'due_amount' => $r->due_amount, 'due_date' => $r->due_date,
                'delay_days' => $r->delay_days, 'im' => $emi > 0 ? AccountMath::imOf(Money::paise($r->paid_amount), $emi) : null,
                'mode' => $r->payment_mode ?? 'CASH', 'receipt_no' => $r->receipt_no, 'debit' => Money::dec($r->paid_amount), 'credit' => '0.00',
                'source' => 'old', 'ref_id' => (int) $r->sno, 'receipt_book' => $r->receipt_book,
                'emi' => Money::dec($r->paid_amount), 'od' => '0.00', 'seize' => '0.00', 'other' => '0.00', 'other_note' => null,
            ] + self::parts($r->payment_mode, $r->paid_amount);
        }

        return $out;
    }

    private static function appReceipts(callable $where): array
    {
        $q = DB::table('payments as p')->leftJoin('legacy_accounts as a', 'a.id', '=', 'p.legacy_account_id')
            ->leftJoin('loans as l', 'l.id', '=', 'p.loan_id')->leftJoin('borrowers as b', 'b.id', '=', 'l.borrower_id');
        $where($q);
        $out = [];
        foreach ($q->get(['p.paid_date', 'p.paid_amount', 'p.charges', 'p.od_amount', 'p.seize_amount', 'p.other_amount', 'p.other_note',
            'p.due_amount', 'p.due_date', 'p.delay_days', 'p.payment_mode', 'p.parts', 'p.receipt_no',
            'p.receipt_book', 'p.loan_id', 'a.sno', 'a.borrower_name', 'a.registration_no', 'a.fno', 'a.emi_amount', 'b.full_name', 'l.vehicle_no',
            'l.folio_no', 'l.emi_amount as loan_emi', 'l.id as lid']) as $r) {
            $emi = Money::paise($r->emi_amount ?? $r->loan_emi);
            $veh = $r->registration_no ?? $r->vehicle_no;
            $mode = $r->payment_mode === 'SPLIT'
                ? implode('+', array_column(json_decode((string) $r->parts, true) ?? [], 'mode'))
                : $r->payment_mode;
            $out[] = [
                'entry_date' => $r->paid_date, 'kind_order' => 1, 'kind' => 'receipt',
                'particulars' => ($r->borrower_name ?? $r->full_name).($veh !== null ? ' '.$veh : ''),
                'folio' => $r->fno !== null ? (string) $r->fno : $r->folio_no, 'due_amount' => $r->due_amount, 'due_date' => $r->due_date,
                'delay_days' => $r->delay_days, 'im' => $emi > 0 ? AccountMath::imOf(Money::paise($r->paid_amount), $emi) : null,
                'mode' => $mode, 'receipt_no' => (int) $r->receipt_no, 'debit' => Money::dec($got = self::received($r)), 'credit' => '0.00',
                'source' => $r->loan_id === null ? 'old' : 'new', 'ref_id' => (int) ($r->sno ?? $r->lid), 'receipt_book' => $r->receipt_book,
                'cash' => Money::str($cash = self::cashPart($r->payment_mode, $got, $r->parts)),
                'bank' => Money::str(Money::paise($got) - $cash),
                // the EMI part and the charges on the same receipt
                'emi' => Money::dec($r->paid_amount), 'od' => Money::dec($r->od_amount), 'seize' => Money::dec($r->seize_amount),
                'other' => Money::dec($r->other_amount), 'other_note' => $r->other_note,
            ];
        }

        return $out;
    }

    private static function loansGiven(string $from, string $to): array
    {
        $out = [];
        foreach (DB::table('legacy_accounts')->whereBetween('agreement_date', [$from, $to])->where('finance_amount', '>', 0)
            ->get(['agreement_date', 'borrower_name', 'registration_no', 'fno', 'finance_mode', 'finance_amount', 'sno']) as $a) {
            $out[] = ['entry_date' => $a->agreement_date, 'kind_order' => 2, 'kind' => 'loan',
                'particulars' => $a->borrower_name.($a->registration_no !== null ? ' '.$a->registration_no : ''), 'folio' => (string) $a->fno,
                'due_amount' => null, 'due_date' => null, 'delay_days' => null, 'im' => null, 'mode' => $a->finance_mode ?? 'CASH', 'receipt_no' => null,
                'debit' => '0.00', 'credit' => Money::dec($a->finance_amount), 'source' => 'old', 'ref_id' => (int) $a->sno, 'receipt_book' => null]
                + self::parts($a->finance_mode, $a->finance_amount);
        }
        foreach (DB::table('loans as l')->join('borrowers as b', 'b.id', '=', 'l.borrower_id')->whereBetween('l.agreement_date', [$from, $to])
            ->get(['l.agreement_date', 'b.full_name', 'l.vehicle_no', 'l.folio_no', 'l.loan_type', 'l.finance_amount', 'l.id']) as $l) {
            $out[] = ['entry_date' => $l->agreement_date, 'kind_order' => 2, 'kind' => 'loan',
                'particulars' => $l->full_name.($l->vehicle_no !== null ? ' '.$l->vehicle_no : ''), 'folio' => $l->folio_no,
                'due_amount' => null, 'due_date' => null, 'delay_days' => null, 'im' => null, 'mode' => $l->loan_type, 'receipt_no' => null,
                'debit' => '0.00', 'credit' => Money::dec($l->finance_amount), 'source' => 'new', 'ref_id' => (int) $l->id, 'receipt_book' => null]
                + self::parts($l->loan_type, $l->finance_amount);
        }

        return $out;
    }

    // ---------------------------------------------------------------- Seized Vehicles (view seized_accounts)

    public static function seized(): array
    {
        $rows = [];
        $lastSeize = [];
        $latest = [];
        foreach (DB::table('seizures')->orderBy('created_at')->orderBy('id')->get() as $e) {
            $key = $e->legacy_account_id ? "a{$e->legacy_account_id}" : "l{$e->loan_id}";
            if ($e->action === 'seize') {
                $lastSeize[$key] = $e;
            }
            $latest[$key] = $e->action === 'seize';
        }
        $all = AccountQueries::all();
        foreach (DB::table('legacy_accounts')->get() as $a) {
            $seized = $latest["a{$a->id}"] ?? ($a->seized === null ? false : (bool) $a->seized);
            if (! $seized) {
                continue;
            }
            $rows["old:{$a->sno}"] = $a;
        }
        if (! $rows && ! DB::table('loans')->where('status', 'seized')->exists()) {
            return [];
        }
        $totals = [];
        foreach ((clone $all)->get(['source', 'ref_id', 'ledger', 'total_amount', 'total_paid', 'balance']) as $t) {
            $totals["{$t->source}:{$t->ref_id}"] = $t;
        }
        $out = [];
        foreach ($rows as $k => $a) {
            $t = $totals[$k];
            $ev = $lastSeize["a{$a->id}"] ?? null;
            $out[] = [
                'source' => 'old', 'ref_id' => (int) $a->sno, 'folio' => ($a->fcode ?? '') !== '' ? "{$a->fcode}-{$a->fno}" : (string) $a->fno,
                'ledger' => $t->ledger, 'borrower_name' => $a->borrower_name,
                'mobile' => ($m = implode(', ', array_filter([$a->borrower_mobile, $a->borrower_mobile2], fn ($x) => $x !== null))) === '' ? null : $m,
                'vehicle_model' => $a->vehicle_model, 'vehicle_no' => $a->registration_no, 'total_amount' => $a->total_amount,
                'total_paid' => $t->total_paid, 'balance' => $t->balance, 'seized_on' => $ev?->action_date, 'remarks' => $ev?->remarks,
                'from_old_software' => $ev === null,
                'search_text' => mb_strtolower(implode(' ', array_filter([$a->search_text, $a->chassis_no, $a->engine_no], fn ($x) => $x !== null))),
            ];
        }
        foreach (DB::table('loans as l')->join('borrowers as b', 'b.id', '=', 'l.borrower_id')->where('l.status', 'seized')
            ->get(['l.*', 'b.full_name', 'b.father_name', 'b.mobile']) as $l) {
            $t = $totals["new:{$l->id}"];
            $ev = $lastSeize["l{$l->id}"] ?? null;
            $out[] = [
                'source' => 'new', 'ref_id' => (int) $l->id, 'folio' => $l->folio_no, 'ledger' => 'pending', 'borrower_name' => $l->full_name,
                'mobile' => $l->mobile, 'vehicle_model' => $l->vehicle_model, 'vehicle_no' => $l->vehicle_no, 'total_amount' => $l->total_amount,
                'total_paid' => $t->total_paid, 'balance' => $t->balance, 'seized_on' => $ev?->action_date, 'remarks' => $ev?->remarks,
                'from_old_software' => false,
                'search_text' => mb_strtolower(implode(' ', array_filter([$l->folio_no, $l->full_name, $l->father_name, $l->mobile, $l->vehicle_no,
                    $l->chassis_no, $l->engine_no], fn ($x) => $x !== null))),
            ];
        }
        usort($out, fn ($a, $b) => [$b['seized_on'] !== null, $b['seized_on'] ?? '', $b['ref_id']] <=> [$a['seized_on'] !== null, $a['seized_on'] ?? '', $a['ref_id']]);

        return $out;
    }

    // ---------------------------------------------------------------- Dashboard (public.dashboard, kept for 60 seconds)

    public static function dashboard(string $day): array
    {
        $c = DB::table('dashboard_cache')->where('day', $day)->where('computed_at', '>', now()->subSeconds(60)->format('Y-m-d H:i:s.u'))->value('data');
        if ($c !== null) {
            return json_decode($c, true);
        }
        $v = self::computeDashboard($day);
        DB::table('dashboard_cache')->upsert([['day' => $day, 'data' => json_encode($v), 'computed_at' => now()->format('Y-m-d H:i:s.u')]], ['day'], ['data', 'computed_at']);
        DB::table('dashboard_cache')->where('day', '<', date('Y-m-d', strtotime("$day -7 days")))->delete();

        return $v;
    }

    private static function computeDashboard(string $day): array
    {
        $m0 = substr($day, 0, 7).'-01';
        $y0 = DueReport::addMonths($m0, -11);
        $pmTo = DueReport::addMonths($day, -1);
        $num = fn (int $p) => $p / 100;

        $from = date('Y-m-d', strtotime("$y0 -31 days"));
        $rec = array_merge(self::legacyReceipts(fn ($q) => $q->whereBetween('lp.paid_date', [$from, $day])),
            self::appReceipts(fn ($q) => $q->whereBetween('p.paid_date', [$from, $day])));
        $lent = self::loansGiven($y0, $day);

        $sum = function (array $rows, string $col, callable $keep) {
            $t = 0;
            $n = 0;
            foreach ($rows as $r) {
                if ($keep($r)) {
                    $t += Money::paise($r[$col]);
                    $n++;
                }
            }

            return [$t, $n];
        };
        [$todayAmt, $todayN] = $sum($rec, 'debit', fn ($r) => $r['entry_date'] === $day);
        $modes = [];
        foreach ($rec as $r) {
            if ($r['entry_date'] === $day) {
                $modes[$r['mode']] = ($modes[$r['mode']] ?? 0) + Money::paise($r['debit']);
            }
        }
        $yesterday = date('Y-m-d', strtotime("$day -1 day"));
        [$yAmt] = $sum($rec, 'debit', fn ($r) => $r['entry_date'] === $yesterday);
        [$mAmt, $mN] = $sum($rec, 'debit', fn ($r) => $r['entry_date'] >= $m0 && $r['entry_date'] <= $day);
        $lmFrom = DueReport::addMonths($m0, -1);
        [$lmAmt] = $sum($rec, 'debit', fn ($r) => $r['entry_date'] >= $lmFrom && $r['entry_date'] <= $pmTo);
        $months = [];
        for ($mm = $y0; $mm <= $m0; $mm = DueReport::addMonths($mm, 1)) {
            $ym = substr($mm, 0, 7);
            [$col] = $sum($rec, 'debit', fn ($r) => substr($r['entry_date'], 0, 7) === $ym);
            [$len] = $sum($lent, 'credit', fn ($r) => substr($r['entry_date'], 0, 7) === $ym);
            $months[] = ['month' => $ym, 'collected' => $num($col), 'lent' => $num($len)];
        }
        [$nlAmt, $nlN] = $sum($lent, 'credit', fn ($r) => $r['entry_date'] >= $m0 && $r['entry_date'] <= $day);

        $due = DueReport::run($day);
        $out = ['balance' => 0, 'accounts' => 0, 'arrears' => 0, 'overdue_accounts' => 0, 'overdue_3' => 0];
        $dueToday = ['count' => 0, 'amount' => 0];
        $dueWeek = ['count' => 0, 'amount' => 0];
        $week = date('Y-m-d', strtotime("$day +6 days"));
        $top = [];
        foreach ($due as $d) {
            $bal = Money::paise($d['balance']);
            $arr = Money::paise($d['arrears']);
            $out['balance'] += max($bal, 0);
            $out['accounts'] += $bal > 0 ? 1 : 0;
            $out['arrears'] += $arr;
            $out['overdue_accounts'] += $arr > 0 ? 1 : 0;
            $out['overdue_3'] += $d['overdue_emis'] >= 3 ? 1 : 0;
            if (! $d['seized'] && $d['next_due'] === $day) {
                $dueToday['count']++;
                $dueToday['amount'] += Money::paise($d['emi']);
            }
            if (! $d['seized'] && $d['next_due'] !== null && $d['next_due'] >= $day && $d['next_due'] <= $week) {
                $dueWeek['count']++;
                $dueWeek['amount'] += Money::paise($d['emi']);
            }
            if ($arr > 0 && ! $d['seized']) {
                $top[] = $d;
            }
        }
        usort($top, fn ($a, $b) => Money::paise($b['arrears']) <=> Money::paise($a['arrears']));
        $top = array_map(fn ($d) => ['source' => $d['source'], 'ref_id' => $d['ref_id'], 'folio' => $d['folio'], 'borrower_name' => $d['borrower_name'],
            'mobile' => $d['mobile'], 'arrears' => (float) $d['arrears'], 'overdue_emis' => $d['overdue_emis'], 'balance' => (float) $d['balance']],
            array_slice($top, 0, 10));

        $seized = self::seized();
        $cashOpen = DB::table('payments as p')->whereRaw('date(p.created_at) between ? and ?', [date('Y-m-d', strtotime("$day -6 days")), $day])
            ->whereRaw("(p.payment_mode = 'CASH' or (p.payment_mode = 'SPLIT' and p.parts like '%\"CASH\"%'))")
            ->whereNotExists(fn ($q) => $q->from('cash_closings as c')->whereColumn('c.user_id', 'p.created_by')->whereRaw('c.day = date(p.created_at)'))
            ->distinct()->count('p.created_by');

        return [
            'day' => $day,
            'today' => ['amount' => $num($todayAmt), 'count' => $todayN],
            'today_modes' => array_map($num, $modes) ?: (object) [],
            'yesterday' => $num($yAmt),
            'month' => ['amount' => $num($mAmt), 'count' => $mN],
            'last_month_same_days' => $num($lmAmt),
            'months' => $months,
            'new_loans_month' => ['count' => $nlN, 'amount' => $num($nlAmt)],
            'outstanding' => ['balance' => $num($out['balance']), 'accounts' => $out['accounts'], 'arrears' => $num($out['arrears']),
                'overdue_accounts' => $out['overdue_accounts'], 'overdue_3' => $out['overdue_3']],
            'due_today' => ['count' => $dueToday['count'], 'amount' => $num($dueToday['amount'])],
            'due_week' => ['count' => $dueWeek['count'], 'amount' => $num($dueWeek['amount'])],
            'seized' => ['count' => count($seized), 'balance' => array_sum(array_map(fn ($s) => (float) $s['balance'], $seized))],
            'top_overdue' => $top,
            'pending_approvals' => DB::table('pending_payments')->count(),
            'cash_open' => $cashOpen,
        ];
    }

    /** Each person's work between two days (public.staff_performance). */
    public static function staffPerformance(string $from, string $to): array
    {
        $by = fn ($rows) => collect($rows)->keyBy('uid');
        $p = $by(DB::table('payments')->whereRaw('date(created_at) between ? and ?', [$from, $to])->groupBy('created_by')
            ->selectRaw('created_by as uid, count(*) as n, sum(paid_amount + charges) as amt, max(created_at) as last')->get());
        $cash = [];
        foreach (DB::table('payments')->whereRaw('date(created_at) between ? and ?', [$from, $to])->get(['created_by', 'payment_mode', 'paid_amount', 'charges', 'parts']) as $x) {
            $cash[$x->created_by] = ($cash[$x->created_by] ?? 0) + self::cashPart($x->payment_mode, self::received($x), $x->parts);
        }
        $l = $by(DB::table('loans')->whereRaw('date(created_at) between ? and ?', [$from, $to])->groupBy('created_by')
            ->selectRaw('created_by as uid, count(*) as n, sum(finance_amount) as amt')->get());
        $s = $by(DB::table('seizures')->whereRaw('date(created_at) between ? and ?', [$from, $to])->groupBy('created_by')
            ->selectRaw("created_by as uid, sum(action = 'seize') as sz, sum(action = 'release') as rl")->get());
        $c = $by(DB::table('cash_closings')->whereBetween('day', [$from, $to])->groupBy('user_id')
            ->selectRaw('user_id as uid, sum(expected_cash) as exp, sum(received_amount) as rec')->get());
        $open = [];
        foreach (DB::table('payments as x')->whereRaw('date(x.created_at) between ? and ?', [$from, $to])
            ->whereNotExists(fn ($q) => $q->from('cash_closings as cc')->whereColumn('cc.user_id', 'x.created_by')->whereRaw('cc.day = date(x.created_at)'))
            ->get(['x.created_by', 'x.created_at', 'x.payment_mode', 'x.paid_amount', 'x.charges', 'x.parts']) as $x) {
            if (self::cashPart($x->payment_mode, self::received($x), $x->parts) > 0) {
                $open[$x->created_by][substr($x->created_at, 0, 10)] = true;
            }
        }
        $f = $by(DB::table('adjustments')->where('kind', 'penalty')->whereNull('cancelled_at')->whereRaw('date(created_at) between ? and ?', [$from, $to])
            ->groupBy('created_by')->selectRaw('created_by as uid, sum(amount) as amt')->get());
        $x = $by(DB::table('data_audit')->whereIn('action', ['payment_edited', 'payment_cancelled', 'loan_edited', 'loan_deleted', 'payment_rejected'])
            ->whereRaw('date(at) between ? and ?', [$from, $to])->groupBy('by_user')->selectRaw('by_user as uid, count(*) as n')->get());

        $rows = [];
        foreach (DB::table('users')->get(['id', 'full_name', 'active']) as $u) {
            $pp = $p[$u->id] ?? null;
            $ll = $l[$u->id] ?? null;
            if (! $u->active && ! $pp && ! $ll) {
                continue;
            }
            $cc = $c[$u->id] ?? null;
            $rows[] = [
                'user_id' => $u->id, 'full_name' => $u->full_name, 'active' => (bool) $u->active,
                'receipts' => (int) ($pp->n ?? 0), 'collected' => (float) ($pp->amt ?? 0), 'cash' => ($cash[$u->id] ?? 0) / 100,
                'loans' => (int) ($ll->n ?? 0), 'lent' => (float) ($ll->amt ?? 0),
                'seized' => (int) ($s[$u->id]->sz ?? 0), 'released' => (int) ($s[$u->id]->rl ?? 0),
                'cash_expected' => (float) ($cc->exp ?? 0), 'cash_received' => (float) ($cc->rec ?? 0),
                'cash_short' => (float) ($cc->exp ?? 0) - (float) ($cc->rec ?? 0),
                'days_open' => count($open[$u->id] ?? []), 'late_fees' => (float) ($f[$u->id]->amt ?? 0), 'fixes' => (int) ($x[$u->id]->n ?? 0),
                'last_receipt' => $pp->last ?? null,
            ];
        }
        usort($rows, fn ($a, $b) => [$b['collected'], $a['full_name']] <=> [$a['collected'], $b['full_name']]);

        return $rows;
    }

    /** Cash in a payment, in paise (all of it for CASH, the cash part of a split, 0 otherwise). public.mode_part(..., 'CASH') */
    public static function cashPart(string $mode, string $amount, ?string $parts): int
    {
        if ($mode === 'SPLIT') {
            $t = 0;
            foreach (json_decode((string) $parts, true) ?? [] as $x) {
                if (($x['mode'] ?? '') === 'CASH') {
                    $t += Money::paise((string) $x['amount']);
                }
            }

            return $t;
        }

        return $mode === 'CASH' ? Money::paise($amount) : 0;
    }
}

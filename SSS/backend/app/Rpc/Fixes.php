<?php

namespace App\Rpc;

use App\Models\User;
use App\Services\AccountMath;
use App\Services\DataStore;
use App\Services\LoanRules;
use App\Services\Notify;
use App\Services\PaymentError;
use App\Services\PaymentFixes;
use App\Services\Payments;
use App\Support\Audit;
use App\Support\Money;
use App\Support\Perm;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/** Admin fixes: payments, late fees / discounts / close / reschedule, loans, seize / release. */
class Fixes
{
    /** { key: {from, to} } for the keys that changed (app_private.diff). Money compared by value. */
    public static function diff(array $a, array $b, array $keys, array $money = []): array
    {
        $d = [];
        foreach ($keys as $k) {
            $x = $a[$k] ?? null;
            $y = $b[$k] ?? null;
            if (in_array($k, $money, true)) {
                $same = ($x === null && $y === null) || ($x !== null && $y !== null && Money::paise((string) $x) === Money::paise((string) $y));
                $x = $x === null ? null : (float) $x;
                $y = $y === null ? null : (float) $y;
            } else {
                if (is_string($x) && ($x[0] ?? '') === '[') {
                    $x = json_decode($x, true);
                }
                if (is_string($y) && ($y[0] ?? '') === '[') {
                    $y = json_decode($y, true);
                }
                $same = $x == $y && ($x === null) === ($y === null);
            }
            if (! $same) {
                $d[$k] = ['from' => $x, 'to' => $y];
            }
        }

        return $d;
    }

    private static function by(User $u): string
    {
        return "By {$u->full_name}";
    }

    // ---------------------------------------------------------------- payments

    /** public.admin_edit_payment(p_id, p, p_reason) */
    public function editPayment(array $in, User $u): array
    {
        if (! Perm::can($u, 'fix_entries')) {
            throw RpcError::notAllowed();
        }
        $reason = PaymentFixes::needReason($in['p_reason'] ?? null);
        $p = $in['p'] ?? [];
        $id = (int) ($in['p_id'] ?? 0);
        $o = DB::table('payments')->where('id', $id)->first();
        if (! $o) {
            throw RpcError::notFound('payment not found');
        }
        PaymentFixes::lockAccount($o->legacy_account_id, $o->loan_id);
        $o = DB::table('payments')->where('id', $id)->lockForUpdate()->first();

        $amount = Money::paise($p['paid_amount'] ?? null);
        $date = (string) ($p['paid_date'] ?? '');
        $mode = $p['payment_mode'] ?? null;
        $rno = (int) ($p['receipt_no'] ?? 0);
        $im = (int) ($p['installments_covered'] ?? 1);
        if ($amount <= 0) {
            throw RpcError::bad('amount must be more than 0');
        }
        if (! LoanRules::realDate($date) || $date > now()->toDateString()) {
            throw RpcError::bad('paid date cannot be in the future');
        }
        $parts = null;
        if ($mode === 'SPLIT') {
            try {
                $parts = Payments::checkParts($p['parts'] ?? null);
            } catch (PaymentError $e) {
                throw RpcError::bad(lcfirst(rtrim($e->getMessage(), '.')));
            }
            // the charges on this receipt stay: the parts cover the EMI amount and the charges
            if (array_sum(array_map(fn ($x) => Money::paise((string) $x['amount']), $parts)) !== $amount + Money::paise($o->charges)) {
                throw RpcError::bad('the parts must add up to the EMI amount and the charges');
            }
        }
        if (! in_array($mode, ['CASH', 'CHEQUE', 'SBI', 'BANK', 'SPLIT'], true)) {
            throw RpcError::bad('choose the payment mode');
        }
        $bank = trim((string) ($p['bank_name'] ?? ''));
        if ($mode === 'BANK' && $bank === '') {
            throw RpcError::bad('enter the bank name');
        }
        if ($rno <= 0) {
            throw RpcError::bad('enter the receipt number');
        }
        if ($im < 1 || $im > 360) {
            throw RpcError::bad('EMIs covered must be 1 or more');
        }
        if ($rno !== (int) $o->receipt_no) {
            if (DB::table('pending_payments')->where('series_id', $o->series_id)->where('receipt_no', $rno)->exists()) {
                throw RpcError::bad("receipt no. $rno is already used by a payment waiting for approval");
            }
            if (DB::table('legacy_payments')->where('series_id', $o->series_id)->where('receipt_no', $rno)->exists()) {
                throw RpcError::bad("receipt no. $rno was already used in the old software");
            }
            if (DB::table('payments')->where('series_id', $o->series_id)->where('receipt_no', $rno)->where('id', '<>', $id)->exists()) {
                throw new RpcError('23505', 'receipt no. already used');
            }
        }
        DB::table('payments')->where('id', $id)->update([
            'paid_amount' => Money::str($amount), 'paid_date' => $date, 'payment_mode' => $mode,
            'reference_no' => $mode === 'SPLIT' ? null : (trim((string) ($p['reference_no'] ?? '')) ?: null),
            'bank_name' => $mode === 'BANK' ? $bank : null, 'receipt_no' => $rno, 'installments_covered' => $im,
            'parts' => $parts === null ? null : json_encode($parts),
        ]);
        AccountMath::reflow($o->legacy_account_id, $o->loan_id);
        $n = DB::table('payments')->where('id', $id)->first();
        $d = self::diff((array) $o, (array) $n, ['paid_amount', 'paid_date', 'payment_mode', 'reference_no', 'bank_name', 'receipt_no', 'installments_covered', 'parts'],
            ['paid_amount']);
        if (! $d) {
            throw RpcError::bad('nothing was changed');
        }
        $r = Audit::acctRef($o->legacy_account_id, $o->loan_id);
        Audit::log('payment_edited', $r['subject'], ['source' => $r['source'], 'ref_id' => $r['ref_id']],
            ['reason' => $reason, 'receipt_no' => (int) $o->receipt_no, 'changes' => $d]);
        Notify::text('payment', "✏️ Payment edited\n".($r['subject'] ?? '?')."\n"
            .'Rcpt '.$o->receipt_no.': '.Money::inr(Money::paise($o->paid_amount)).' on '.date('d/m/Y', strtotime($o->paid_date))
            .' → Rcpt '.$n->receipt_no.': '.Money::inr(Money::paise($n->paid_amount)).' on '.date('d/m/Y', strtotime($n->paid_date))."\n"
            ."Reason: $reason\n".self::by($u), 'payment_edited');

        return ['id' => $id, 'receipt_no' => (int) $n->receipt_no, 'balance_after' => (float) $n->balance_after];
    }

    /** public.admin_cancel_payment(p_id, p_reason) */
    public function cancelPayment(array $in, User $u): array
    {
        $reason = PaymentFixes::needReason($in['p_reason'] ?? null);
        if (! Perm::can($u, 'fix_entries')) {
            throw RpcError::notAllowed();
        }
        PaymentFixes::cancelCore((int) ($in['p_id'] ?? 0), $reason, 'payment_cancelled');

        return ['cancelled' => (int) $in['p_id']];
    }

    // ---------------------------------------------------------------- late fee / discount / close / reschedule

    /** public.admin_adjust(p): { source, ref_id, kind: penalty | discount | settle | reschedule, amount, reason, new_emi, next_due } */
    public function adjust(array $in, User $u): array
    {
        $p = $in['p'] ?? $in;
        $kind = $p['kind'] ?? '';
        $reason = PaymentFixes::needReason($p['reason'] ?? null);
        if (! Perm::can($u, 'money')) {
            throw RpcError::notAllowed();
        }
        $acct = $loan = null;
        if (($p['source'] ?? '') === 'old') {
            $a = DB::table('legacy_accounts')->where('sno', (int) ($p['ref_id'] ?? 0))->lockForUpdate()->first(['id', 'ledger']);
            if (! $a) {
                throw RpcError::notFound('account not found');
            }
            $acct = (int) $a->id;
            if ($a->ledger === 'closed') {
                throw RpcError::bad('this account is already fully paid in the old software');
            }
            if (AccountMath::legacySettled($acct)) {
                throw RpcError::bad('this account is closed; reopen it first');
            }
        } elseif (($p['source'] ?? '') === 'new') {
            $l = DB::table('loans')->where('id', (int) ($p['ref_id'] ?? 0))->lockForUpdate()->first(['id', 'status']);
            if (! $l) {
                throw RpcError::notFound('loan not found');
            }
            $loan = (int) $l->id;
            if ($l->status === 'closed') {
                throw RpcError::bad('this loan is closed; reopen it first');
            }
        } else {
            throw RpcError::bad('bad source');
        }
        $owed = AccountMath::owed($acct, $loan);
        $r = Audit::acctRef($acct, $loan);
        $amount = Money::paise($p['amount'] ?? null);
        $row = ['legacy_account_id' => $acct, 'loan_id' => $loan, 'kind' => $kind, 'reason' => $reason, 'entry_date' => now()->toDateString(), 'created_by' => $u->id];
        if ($kind === 'penalty') {
            if ($amount <= 0) {
                throw RpcError::bad('enter the charge amount');
            }
            $id = DB::table('adjustments')->insertGetId($row + ['amount' => Money::str($amount)]);
            $msg = '➕ Late fee / charge '.Money::inr($amount);
        } elseif ($kind === 'discount') {
            if ($amount <= 0) {
                throw RpcError::bad('enter the discount amount');
            }
            if ($amount > $owed) {
                throw RpcError::bad('discount is more than the balance ('.Money::inr($owed).')');
            }
            $id = DB::table('adjustments')->insertGetId($row + ['amount' => Money::str(-$amount)]);
            $msg = '➖ Discount '.Money::inr($amount);
        } elseif ($kind === 'settle') {
            $id = DB::table('adjustments')->insertGetId($row + ['amount' => Money::str(-max($owed, 0))]);
            if ($loan) {
                DB::table('loans')->where('id', $loan)->update(['status' => 'closed']);
            }
            $msg = '✅ Account closed'.($owed > 0 ? ' · written off '.Money::inr($owed) : '');
        } elseif ($kind === 'reschedule') {
            $emi = Money::paise($p['new_emi'] ?? null);
            $due = (string) ($p['next_due'] ?? '');
            if ($emi <= 0) {
                throw RpcError::bad('enter the new EMI amount');
            }
            if (! LoanRules::realDate($due)) {
                throw RpcError::bad('enter the next due date');
            }
            if ($owed <= 0) {
                throw RpcError::bad('nothing is left to pay');
            }
            $id = DB::table('adjustments')->insertGetId($row + ['amount' => '0.00', 'new_emi' => Money::str($emi), 'next_due' => $due]);
            $msg = '📅 Rescheduled: EMI '.Money::inr($emi).' from '.date('d/m/Y', strtotime($due)).' · '.intdiv($owed + $emi - 1, $emi).' EMIs';
        } else {
            throw RpcError::bad('bad kind');
        }
        AccountMath::reflow($acct, $loan);
        $after = AccountMath::owed($acct, $loan);
        Audit::log("adjust_$kind", $r['subject'], ['source' => $r['source'], 'ref_id' => $r['ref_id']], [
            'reason' => $reason, 'amount' => (float) DB::table('adjustments')->where('id', $id)->value('amount'),
            'new_emi' => $p['new_emi'] ?? null, 'next_due' => $p['next_due'] ?? null, 'owed_before' => $owed / 100, 'owed_after' => $after / 100,
        ]);
        Notify::text('payment', "$msg\n".($r['subject'] ?? '?')."\nBalance now ".Money::inr($after)."\nReason: $reason\n".self::by($u), "adjust_$kind");

        return ['id' => $id, 'owed' => $after / 100];
    }

    /** public.admin_cancel_adjustment(p_id, p_reason) */
    public function cancelAdjustment(array $in, User $u): array
    {
        $reason = PaymentFixes::needReason($in['p_reason'] ?? null);
        if (! Perm::can($u, 'money')) {
            throw RpcError::notAllowed();
        }
        $x = DB::table('adjustments')->where('id', (int) ($in['p_id'] ?? 0))->first();
        if (! $x) {
            throw RpcError::notFound('not found');
        }
        PaymentFixes::lockAccount($x->legacy_account_id, $x->loan_id);
        $x = DB::table('adjustments')->where('id', $x->id)->lockForUpdate()->first();
        if ($x->cancelled_at !== null) {
            throw RpcError::bad('already cancelled');
        }
        $col = $x->legacy_account_id ? 'legacy_account_id' : 'loan_id';
        $ref = $x->legacy_account_id ?: $x->loan_id;
        if ($x->kind !== 'settle' && DB::table('adjustments')->where('kind', 'settle')->whereNull('cancelled_at')->where($col, $ref)->exists()) {
            throw RpcError::bad('the account is closed; reopen it first');
        }
        DB::table('adjustments')->where('id', $x->id)->update(['cancelled_at' => now()->format('Y-m-d H:i:s.u'), 'cancelled_by' => $u->id, 'cancel_reason' => $reason]);
        if ($x->kind === 'settle' && $x->loan_id) {
            $last = DB::table('seizures')->where('loan_id', $x->loan_id)->orderByDesc('created_at')->orderByDesc('id')->value('action');
            DB::table('loans')->where('id', $x->loan_id)->update(['status' => $last === 'seize' ? 'seized' : 'active']);
        }
        AccountMath::reflow($x->legacy_account_id, $x->loan_id);
        $r = Audit::acctRef($x->legacy_account_id, $x->loan_id);
        $after = AccountMath::owed($x->legacy_account_id, $x->loan_id);
        Audit::log($x->kind === 'settle' ? 'reopened' : 'adjust_cancelled', $r['subject'], ['source' => $r['source'], 'ref_id' => $r['ref_id']], [
            'reason' => $reason, 'kind' => $x->kind, 'amount' => (float) $x->amount, 'original_reason' => $x->reason, 'owed_after' => $after / 100,
        ]);
        Notify::text('payment', ($x->kind === 'settle' ? '↩️ Account reopened' : "↩️ Cancelled {$x->kind}")."\n".($r['subject'] ?? '?')
            ."\nBalance now ".Money::inr($after)."\nReason: $reason\n".self::by($u), 'adjust_cancelled');

        return ['cancelled' => (int) $x->id];
    }

    // ---------------------------------------------------------------- loans

    /** public.admin_edit_loan(p_loan, p, p_reason): every field; amounts and later payments recalculated. */
    public function editLoan(array $in, User $u): array
    {
        $reason = PaymentFixes::needReason($in['p_reason'] ?? null);
        if (! Perm::can($u, 'fix_entries')) {
            throw RpcError::notAllowed();
        }
        $id = (int) ($in['p_loan'] ?? 0);
        $ol = DB::table('loans')->where('id', $id)->lockForUpdate()->first();
        if (! $ol) {
            throw RpcError::notFound('loan not found');
        }
        $ob = DB::table('borrowers')->where('id', $ol->borrower_id)->lockForUpdate()->first();
        $raw = array_map(fn ($v) => $v === null ? '' : (string) $v, (array) ($in['p'] ?? []));
        [$v, $errors] = LoanRules::validate($raw);
        if ($errors) {
            throw RpcError::bad(lcfirst(reset($errors)));
        }
        if (DB::table('loans')->where('folio_no', $v['folio_no'])->where('id', '<>', $id)->exists()) {
            throw new RpcError('23505', 'duplicate folio');
        }
        $amt = LoanRules::amounts($v['finance_amount'], $v['interest_rate'], $v['installments'], $v['interval_months'], $v['agreement_amount'], $v['hp_amount']);
        DB::table('borrowers')->where('id', $ob->id)->update(['full_name' => $v['borrower_name'], 'father_name' => $v['borrower_father'],
            'mobile' => $v['borrower_mobile'], 'date_of_birth' => $v['borrower_dob'], 'address' => $v['borrower_address']]);
        DB::table('loans')->where('id', $id)->update([
            'folio_no' => $v['folio_no'], 'zone' => $v['zone'], 'dealer' => $v['dealer'], 'loan_type' => $v['loan_type'],
            'guarantor_name' => $v['guarantor_name'], 'guarantor_father' => $v['guarantor_father'], 'guarantor_mobile' => $v['guarantor_mobile'],
            'guarantor_address' => $v['guarantor_address'], 'vehicle_condition' => $v['vehicle_condition'], 'sold_by' => $v['sold_by'],
            'vehicle_model' => $v['vehicle_model'], 'vehicle_color' => $v['vehicle_color'], 'chassis_no' => $v['chassis_no'], 'engine_no' => $v['engine_no'],
            'make_year' => $v['make_year'], 'vehicle_no' => $v['vehicle_no'], 'insurance_expiry' => $v['insurance_expiry'], 'agreement_date' => $v['agreement_date'],
            'installments' => $v['installments'], 'interval_months' => $v['interval_months'], 'finance_amount' => Money::dec($v['finance_amount']),
            'interest_rate' => $v['interest_rate'], 'agreement_amount' => Money::dec($v['agreement_amount']), 'hp_amount' => Money::dec($v['hp_amount']),
            'interest_amount' => Money::str($amt['interest']), 'total_amount' => Money::str($amt['total']), 'emi_amount' => Money::str($amt['emi']),
        ]);
        AccountMath::reflow(null, $id);
        $nl = DB::table('loans')->where('id', $id)->first();
        $nb = DB::table('borrowers')->where('id', $ob->id)->first();
        $money = ['finance_amount', 'interest_rate', 'agreement_amount', 'hp_amount', 'interest_amount', 'total_amount', 'emi_amount'];
        $d = self::diff((array) $ob, (array) $nb, ['full_name', 'father_name', 'mobile', 'date_of_birth', 'address'])
            + self::diff((array) $ol, (array) $nl, ['folio_no', 'zone', 'dealer', 'loan_type', 'guarantor_name', 'guarantor_father', 'guarantor_mobile',
                'guarantor_address', 'vehicle_condition', 'sold_by', 'vehicle_model', 'vehicle_color', 'chassis_no', 'engine_no', 'make_year', 'vehicle_no',
                'insurance_expiry', 'agreement_date', 'installments', 'interval_months', ...$money], $money);
        if (! $d) {
            throw RpcError::bad('nothing was changed');
        }
        $r = Audit::acctRef(null, $id);
        Audit::log('loan_edited', $r['subject'], ['source' => 'new', 'ref_id' => $id], ['reason' => $reason, 'changes' => $d]);
        Notify::text('new_loan', "✏️ Loan edited\n".($r['subject'] ?? '?')."\nChanged: ".implode(', ', array_map(fn ($k) => str_replace('_', ' ', $k), array_keys($d)))."\n"
            .(Money::paise($ol->total_amount) !== Money::paise($nl->total_amount) || Money::paise($ol->emi_amount) !== Money::paise($nl->emi_amount)
                ? 'Total '.Money::inr(Money::paise($nl->total_amount)).' · EMI '.Money::inr(Money::paise($nl->emi_amount))."\n" : '')
            ."Reason: $reason\n".self::by($u), 'loan_edited');

        return ['id' => $id, 'total_amount' => (float) $nl->total_amount, 'emi_amount' => (float) $nl->emi_amount];
    }

    /** public.admin_delete_loan(p_loan, p_reason, p_confirm): only without payments; a full copy goes to the activity log. */
    public function deleteLoan(array $in, User $u): array
    {
        $reason = PaymentFixes::needReason($in['p_reason'] ?? null);
        if (! Perm::can($u, 'fix_entries')) {
            throw RpcError::notAllowed();
        }
        if (($in['p_confirm'] ?? null) !== 'DELETE') {
            throw RpcError::bad('type DELETE to confirm');
        }
        $id = (int) ($in['p_loan'] ?? 0);
        $l = DB::table('loans')->where('id', $id)->lockForUpdate()->first();
        if (! $l) {
            throw RpcError::notFound('loan not found');
        }
        if (DB::table('payments')->where('loan_id', $id)->exists()) {
            throw RpcError::bad('this loan has payments; cancel them first');
        }
        $b = DB::table('borrowers')->where('id', $l->borrower_id)->first();
        $r = Audit::acctRef(null, $id);
        $seizures = DB::table('seizures')->where('loan_id', $id)->get()->map(fn ($x) => (array) $x)->all();
        $adjustments = DB::table('adjustments')->where('loan_id', $id)->get()->map(fn ($x) => (array) $x)->all();
        DB::table('adjustments')->where('loan_id', $id)->delete();
        DB::table('seizures')->where('loan_id', $id)->delete();
        DB::table('loans')->where('id', $id)->delete();
        if (! DB::table('loans')->where('borrower_id', $b->id)->exists()) {
            DB::table('borrowers')->where('id', $b->id)->delete();
        }
        Audit::log('loan_deleted', $r['subject'], null, ['reason' => $reason, 'loan' => (array) $l, 'borrower' => (array) $b,
            'seizures' => $seizures, 'adjustments' => $adjustments]);
        Notify::text('new_loan', "🗑 Loan deleted\n".($r['subject'] ?? '?')."\nTotal ".Money::inr(Money::paise($l->total_amount))."\nReason: $reason\n".self::by($u), 'loan_deleted');

        return ['deleted' => $id];
    }

    /**
     * public.admin_purge_loan(p_loan, p_reason, p_folio, p_pin): admin only, a loan with everything on it (payments, waiting
     * payments, late fees, seize history, remarks, collection lists). A restore point first, a full copy in the activity log.
     */
    public function purgeLoan(array $in, User $u): array
    {
        if (! $u->isAdmin()) {
            throw RpcError::notAllowed('only admin');
        }
        $reason = PaymentFixes::needReason($in['p_reason'] ?? null);
        $id = (int) ($in['p_loan'] ?? 0);
        $l = DB::table('loans')->where('id', $id)->lockForUpdate()->first();
        if (! $l) {
            throw RpcError::notFound('loan not found');
        }
        if (strtoupper(trim((string) ($in['p_folio'] ?? ''))) !== strtoupper(trim($l->folio_no))) {
            throw RpcError::bad("type the folio number {$l->folio_no} to confirm");
        }
        $hash = DB::table('app_secrets')->where('key', 'delete_pin')->value('value');
        if (! $hash || ! Hash::check((string) ($in['p_pin'] ?? ''), $hash)) {
            throw RpcError::bad('wrong PIN');
        }

        $b = DB::table('borrowers')->where('id', $l->borrower_id)->first();
        $r = Audit::acctRef(null, $id);
        $rows = fn ($q) => $q->get()->map(fn ($x) => (array) $x)->all();
        $copy = [
            'payments' => $rows(DB::table('payments')->where('loan_id', $id)->orderBy('installment_no')),
            'waiting' => $rows(DB::table('pending_payments')->where('source', 'new')->where('ref_id', $id)),
            'adjustments' => $rows(DB::table('adjustments')->where('loan_id', $id)),
            'seizures' => $rows(DB::table('seizures')->where('loan_id', $id)),
            'remarks' => $rows(DB::table('visit_remarks')->where('source', 'new')->where('ref_id', $id)),
            'assignments' => $rows(DB::table('collection_assignments')->where('source', 'new')->where('ref_id', $id)),
        ];
        $paid = array_sum(array_map(fn ($p) => Money::paise($p['paid_amount']), $copy['payments']));
        $rp = DataStore::makePoint("Before deleting loan folio {$l->folio_no}");

        DB::table('payments')->where('loan_id', $id)->delete();
        DB::table('pending_payments')->where('source', 'new')->where('ref_id', $id)->delete();
        DB::table('adjustments')->where('loan_id', $id)->delete();
        DB::table('seizures')->where('loan_id', $id)->delete();
        DB::table('visit_remarks')->where('source', 'new')->where('ref_id', $id)->delete();
        DB::table('collection_assignments')->where('source', 'new')->where('ref_id', $id)->delete();
        DB::table('loans')->where('id', $id)->delete();
        if (! DB::table('loans')->where('borrower_id', $b->id)->exists()) {
            DB::table('borrowers')->where('id', $b->id)->delete();
        }
        DataStore::changed();

        Audit::log('loan_purged', $r['subject'], null, ['reason' => $reason, 'restore_point' => $rp, 'paid' => $paid / 100,
            'counts' => array_map('count', $copy), 'loan' => (array) $l, 'borrower' => (array) $b] + $copy);
        Notify::text('new_loan', "🗑 Loan deleted completely\n".($r['subject'] ?? '?')."\nTotal ".Money::inr(Money::paise($l->total_amount))
            .' · '.count($copy['payments']).' payment(s) '.Money::inr($paid)."\nReason: $reason\n".self::by($u), 'loan_purged');

        return ['deleted' => $id, 'payments' => count($copy['payments']), 'paid' => $paid / 100, 'restore_point' => $rp];
    }

    // ---------------------------------------------------------------- seize / release

    /** public.set_seized(p): { source, ref_id, seize, action_date, remarks, idempotency_key } */
    public function seize(array $in, User $u): array
    {
        $p = $in['p'] ?? $in;
        if (! Perm::can($u, 'seize')) {
            throw RpcError::notAllowed();
        }
        $key = (string) ($p['idempotency_key'] ?? Str::uuid());
        if ($id = DB::table('seizures')->where('idempotency_key', $key)->value('id')) {
            return ['id' => $id, 'replayed' => true];
        }
        $seize = $p['seize'] ?? null;
        $date = (string) ($p['action_date'] ?? '');
        $remarks = trim((string) ($p['remarks'] ?? '')) ?: null;
        if ($seize === null || ! LoanRules::realDate($date)) {
            throw RpcError::bad('missing details');
        }
        if ($date > now()->toDateString()) {
            throw RpcError::bad('date cannot be in the future');
        }
        if (! $seize && $remarks === null) {
            throw RpcError::bad('enter the reason for releasing');
        }
        if ($remarks !== null && mb_strlen($remarks) > 300) {
            throw RpcError::bad('remarks too long');
        }
        $acct = $loan = null;
        if (($p['source'] ?? '') === 'old') {
            $a = DB::table('legacy_accounts')->where('sno', (int) ($p['ref_id'] ?? 0))->lockForUpdate()->first(['id', 'seized']);
            if (! $a) {
                throw RpcError::notFound('account not found');
            }
            $acct = (int) $a->id;
            $last = DB::table('seizures')->where('legacy_account_id', $acct)->orderByDesc('created_at')->orderByDesc('id')->value('action');
            $now = $last !== null ? $last === 'seize' : (bool) $a->seized;
        } elseif (($p['source'] ?? '') === 'new') {
            $l = DB::table('loans')->where('id', (int) ($p['ref_id'] ?? 0))->lockForUpdate()->first(['id', 'status']);
            if (! $l) {
                throw RpcError::notFound('loan not found');
            }
            if ($l->status === 'closed') {
                throw RpcError::bad('loan is closed');
            }
            $loan = (int) $l->id;
            $now = $l->status === 'seized';
        } else {
            throw RpcError::bad('bad source');
        }
        if ($now === (bool) $seize) {
            throw RpcError::bad($seize ? 'already seized' : 'not seized');
        }
        $action = $seize ? 'seize' : 'release';
        $id = DB::table('seizures')->insertGetId(['legacy_account_id' => $acct, 'loan_id' => $loan, 'action' => $action, 'action_date' => $date,
            'remarks' => $remarks, 'idempotency_key' => $key, 'created_by' => $u->id]);
        if ($loan) {
            DB::table('loans')->where('id', $loan)->update(['status' => $seize ? 'seized' : 'active']);
        }
        $r = Audit::acctRef($acct, $loan);
        Audit::log($action, $r['subject'], ['source' => $r['source'], 'ref_id' => $r['ref_id']], ['date' => $date, 'remarks' => $remarks]);
        Notify::seizure($id);

        return ['id' => $id, 'replayed' => false];
    }
}

<?php

namespace App\Rpc;

use App\Models\User;
use App\Services\AccountMath;
use App\Services\DataStore;
use App\Services\LoanRules;
use App\Services\PaymentFixes;
use App\Support\Audit;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * Admin only: edit an account or a receipt that came from the old software, or cancel such a receipt
 * (public.admin_edit_legacy_account / admin_edit_legacy_payment / admin_cancel_legacy_payment).
 * What is changed here is kept if the old-software files are imported again.
 */
class OldData
{
    private const TEXT = ['borrower_father', 'borrower_address', 'borrower_mobile', 'borrower_mobile2', 'guarantor_name', 'guarantor_father',
        'guarantor_address', 'guarantor_mobile', 'guarantor_mobile2', 'vehicle_condition', 'vehicle_model', 'vehicle_variant', 'chassis_no', 'engine_no'];

    private const MONEY = ['finance_amount', 'interest_amount', 'agreement_amount', 'hp_amount', 'total_amount', 'emi_amount'];

    private static function admin(User $u): void
    {
        if (! $u->isAdmin()) {
            throw RpcError::notAllowed('only admin');
        }
    }

    private static function blank(mixed $v): ?string
    {
        $v = trim((string) $v);

        return $v === '' ? null : $v;
    }

    /**
     * After an old account or one of its receipts changed: the running balance on its receipts (total payable minus
     * everything paid so far, like the old software), its stored totals and the payments taken in this app.
     */
    public static function refresh(int $acct): void
    {
        $a = DB::table('legacy_accounts')->where('id', $acct)->first(['sno', 'ledger', 'total_amount']);
        $left = Money::paise($a->total_amount);
        foreach (DB::table('legacy_payments')->where('account_id', $acct)->where('ledger', $a->ledger)->orderBy('installment_no')->orderBy('id')
            ->get(['id', 'paid_amount']) as $r) {
            $left -= Money::paise($r->paid_amount);
            DB::table('legacy_payments')->where('id', $r->id)->update(['balance_after' => Money::str($left)]);
        }
        DataStore::refreshLegacyTotals([(int) $a->sno]);
        AccountMath::reflow($acct, null);
    }

    /** public.admin_edit_legacy_account(p_sno, p, p_reason) */
    public function editAccount(array $in, User $u): array
    {
        self::admin($u);
        $reason = PaymentFixes::needReason($in['p_reason'] ?? null);
        $p = (array) ($in['p'] ?? []);
        $sno = (int) ($in['p_sno'] ?? 0);
        $o = DB::table('legacy_accounts')->where('sno', $sno)->lockForUpdate()->first();
        if (! $o) {
            throw RpcError::notFound('account not found');
        }

        if (self::blank($p['borrower_name'] ?? null) === null) {
            throw RpcError::bad("enter the customer's name");
        }
        foreach (['borrower_mobile', 'borrower_mobile2', 'guarantor_mobile', 'guarantor_mobile2'] as $k) {
            if (! preg_match('/^(\d{10})?$/', trim((string) ($p[$k] ?? '')))) {
                throw RpcError::bad('a mobile number must be 10 digits');
            }
        }
        if (! preg_match('/^\d{1,9}$/', (string) ($p['fno'] ?? ''))) {
            throw RpcError::bad('enter the folio number');
        }
        if (! preg_match('/^\d{1,3}$/', (string) ($p['tenure_months'] ?? '')) || $p['tenure_months'] < 1 || $p['tenure_months'] > 360) {
            throw RpcError::bad('EMIs must be between 1 and 360');
        }
        if (! preg_match('/^\d{1,2}$/', (string) ($p['interval_months'] ?? '')) || $p['interval_months'] < 1 || $p['interval_months'] > 12) {
            throw RpcError::bad('months between EMIs must be 1 to 12');
        }
        foreach (self::MONEY as $k) {
            if (! preg_match('/^\d{1,9}(\.\d{1,2})?$/', (string) ($p[$k] ?? ''))) {
                throw RpcError::bad('enter '.str_replace('_', ' ', $k).' (0 or more)');
            }
        }
        if (Money::paise((string) $p['total_amount']) <= 0) {
            throw RpcError::bad('total payable must be more than 0');
        }
        if (! preg_match('/^(\d{4})?$/', (string) ($p['model_year'] ?? ''))) {
            throw RpcError::bad('model year must be 4 digits');
        }
        $date = self::blank($p['agreement_date'] ?? null);
        if ($date !== null && ! LoanRules::realDate($date)) {
            throw RpcError::bad('enter the agreement date');
        }

        $new = ['fno' => (int) $p['fno'], 'borrower_name' => trim((string) $p['borrower_name']),
            'finance_mode' => ($m = self::blank($p['finance_mode'] ?? null)) === null ? null : strtoupper($m),
            'model_year' => self::blank($p['model_year'] ?? null) === null ? null : (int) $p['model_year'],
            'registration_no' => ($r = self::blank($p['registration_no'] ?? null)) === null ? null : strtoupper($r),
            'agreement_date' => $date, 'tenure_months' => (int) $p['tenure_months'], 'interval_months' => (int) $p['interval_months']];
        foreach (self::TEXT as $k) {
            $new[$k] = self::blank($p[$k] ?? null);
        }
        foreach (self::MONEY as $k) {
            $new[$k] = Money::dec((string) $p[$k]);
        }
        $d = Fixes::diff((array) $o, $new, array_keys($new), self::MONEY);
        if (! $d) {
            throw RpcError::bad('nothing was changed');
        }
        DB::table('legacy_accounts')->where('id', $o->id)->update($new + ['edited_in_app' => true]);
        self::refresh((int) $o->id);

        $ref = Audit::acctRef((int) $o->id, null);
        Audit::log('old_account_edited', $ref['subject'], ['source' => 'old', 'ref_id' => $sno], ['reason' => $reason, 'changes' => $d]);

        return ['sno' => $sno, 'owed' => AccountMath::owed((int) $o->id, null) / 100];
    }

    /** public.admin_edit_legacy_payment(p_id, p, p_reason) */
    public function editReceipt(array $in, User $u): array
    {
        self::admin($u);
        $reason = PaymentFixes::needReason($in['p_reason'] ?? null);
        $p = (array) ($in['p'] ?? []);
        $id = (int) ($in['p_id'] ?? 0);
        $o = DB::table('legacy_payments')->where('id', $id)->first();
        if (! $o) {
            throw RpcError::notFound('receipt not found');
        }
        DB::table('legacy_accounts')->where('sno', $o->sno)->lockForUpdate()->first(['id']);
        $o = DB::table('legacy_payments')->where('id', $id)->lockForUpdate()->first();

        $amount = (string) ($p['paid_amount'] ?? '');
        if (! preg_match('/^\d{1,9}(\.\d{1,2})?$/', $amount) || Money::paise($amount) <= 0) {
            throw RpcError::bad('amount must be more than 0');
        }
        $date = (string) ($p['paid_date'] ?? '');
        if (! LoanRules::realDate($date)) {
            throw RpcError::bad('enter the paid date');
        }
        if ($date > now()->toDateString()) {
            throw RpcError::bad('paid date cannot be in the future');
        }
        $mode = strtoupper(trim((string) ($p['payment_mode'] ?? '')));
        if ($mode === '' || mb_strlen($mode) > 20) {
            throw RpcError::bad('choose the payment mode');
        }
        $rnoText = trim((string) ($p['receipt_no'] ?? ''));
        if (! preg_match('/^\d{0,12}$/', $rnoText)) {
            throw RpcError::bad('receipt number must be digits');
        }
        $rno = $rnoText === '' ? null : (int) $rnoText;
        if ($rno !== null && $rno !== ($o->receipt_no === null ? null : (int) $o->receipt_no)
            && (DB::table('legacy_payments')->where('series_id', $o->series_id)->where('receipt_no', $rno)->where('id', '<>', $id)->exists()
                || DB::table('payments')->where('series_id', $o->series_id)->where('receipt_no', $rno)->exists()
                || DB::table('pending_payments')->where('series_id', $o->series_id)->where('receipt_no', $rno)->exists())) {
            throw RpcError::bad("receipt no. $rno is already used in this book");
        }

        $new = ['paid_amount' => Money::dec($amount), 'paid_date' => $date, 'payment_mode' => $mode, 'receipt_no' => $rno,
            'cheque_no' => self::blank($p['cheque_no'] ?? null)];
        $d = Fixes::diff((array) $o, $new, array_keys($new), ['paid_amount']);
        if (! $d) {
            throw RpcError::bad('nothing was changed');
        }
        DB::table('legacy_payments')->where('id', $id)->update($new + [
            'delay_days' => $o->due_date !== null ? AccountMath::days($o->due_date, $date) : $o->delay_days,
            'edited_in_app' => true,
        ]);
        if ($o->account_id !== null) {
            self::refresh((int) $o->account_id);
        }

        $ref = Audit::acctRef($o->account_id === null ? null : (int) $o->account_id, null);
        Audit::log('old_receipt_edited', $ref['subject'], ['source' => 'old', 'ref_id' => (int) $o->sno],
            ['reason' => $reason, 'installment_no' => (int) $o->installment_no, 'receipt_no' => $o->receipt_no === null ? null : (int) $o->receipt_no, 'changes' => $d]);

        return ['id' => $id, 'owed' => $o->account_id === null ? null : AccountMath::owed((int) $o->account_id, null) / 100];
    }

    /** public.admin_cancel_legacy_payment(p_id, p_reason) */
    public function cancelReceipt(array $in, User $u): array
    {
        self::admin($u);
        $reason = PaymentFixes::needReason($in['p_reason'] ?? null);
        $id = (int) ($in['p_id'] ?? 0);
        $o = DB::table('legacy_payments')->where('id', $id)->first();
        if (! $o) {
            throw RpcError::notFound('receipt not found');
        }
        DB::table('legacy_accounts')->where('sno', $o->sno)->lockForUpdate()->first(['id']);
        $o = DB::table('legacy_payments')->where('id', $id)->lockForUpdate()->first();

        DB::table('legacy_payments')->where('id', $id)->delete();
        DB::table('legacy_receipts_removed')->insertOrIgnore(['ledger' => $o->ledger, 'sno' => $o->sno, 'installment_no' => $o->installment_no,
            'removed_at' => now()->format('Y-m-d H:i:s.u'), 'removed_by' => $u->id]);
        if ($o->account_id !== null) {
            self::refresh((int) $o->account_id);
        }

        $row = (array) $o;
        unset($row['raw']);
        $row['data_flags'] = json_decode((string) $row['data_flags'], true);
        foreach (['paid_amount', 'due_amount', 'balance_after'] as $k) {
            $row[$k] = $row[$k] === null ? null : (float) $row[$k];
        }
        $ref = Audit::acctRef($o->account_id === null ? null : (int) $o->account_id, null);
        Audit::log('old_receipt_cancelled', $ref['subject'], ['source' => 'old', 'ref_id' => (int) $o->sno], [
            'reason' => $reason, 'installment_no' => (int) $o->installment_no, 'receipt_no' => $o->receipt_no === null ? null : (int) $o->receipt_no,
            'amount' => (float) $o->paid_amount, 'paid_date' => $o->paid_date, 'receipt' => $row,
        ]);

        return ['cancelled' => $id, 'owed' => $o->account_id === null ? null : AccountMath::owed((int) $o->account_id, null) / 100];
    }
}

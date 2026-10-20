<?php

namespace App\Services;

use App\Rpc\RpcError;
use App\Support\Audit;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/** Taking back / changing payments already counted (app_private.cancel_payment_core, payment_lock, need_reason). */
final class PaymentFixes
{
    /** A reason is required, at most 300 letters (app_private.need_reason). */
    public static function needReason(?string $r): string
    {
        $v = trim((string) $r);
        if ($v === '') {
            throw RpcError::bad('enter the reason');
        }
        if (mb_strlen($v) > 300) {
            throw RpcError::bad('reason is too long (300 characters at most)');
        }

        return $v;
    }

    /** Same lock as taking a payment: one change at a time per account. */
    public static function lockAccount(?int $acct, ?int $loan): void
    {
        $acct ? DB::table('legacy_accounts')->where('id', $acct)->lockForUpdate()->first(['id'])
            : DB::table('loans')->where('id', $loan)->lockForUpdate()->first(['id']);
    }

    /** Delete a payment (kept whole in the activity log) and recalculate the later ones on the account. */
    public static function cancelCore(int $id, string $reason, string $action): void
    {
        $o = DB::table('payments')->where('id', $id)->first();
        if (! $o) {
            throw RpcError::notFound('payment not found');
        }
        self::lockAccount($o->legacy_account_id, $o->loan_id);
        $o = DB::table('payments')->where('id', $id)->lockForUpdate()->first();
        $r = Audit::acctRef($o->legacy_account_id, $o->loan_id);
        DB::table('payments')->where('id', $id)->delete();
        AccountMath::reflow($o->legacy_account_id, $o->loan_id);
        $row = (array) $o;
        $row['parts'] = $row['parts'] === null ? null : json_decode($row['parts'], true);
        foreach (['paid_amount', 'due_amount', 'balance_after'] as $k) {
            $row[$k] = $row[$k] === null ? null : (float) $row[$k];
        }
        Audit::log($action, $r['subject'], ['source' => $r['source'], 'ref_id' => $r['ref_id']], [
            'reason' => $reason, 'receipt_no' => (int) $o->receipt_no, 'amount' => (float) $o->paid_amount, 'paid_date' => $o->paid_date, 'payment' => $row,
        ]);
        Notify::text('payment', ($action === 'payment_rejected' ? '⛔ Payment rejected' : '❌ Payment cancelled')."\n".($r['subject'] ?? '?')."\n"
            .'Rcpt '.$o->receipt_no.' · '.Money::inr(Money::paise($o->paid_amount)).' on '.date('d/m/Y', strtotime($o->paid_date))."\n"
            .'Reason: '.$reason."\nBy ".(auth()->user()?->full_name ?? '—'), $action);
    }
}

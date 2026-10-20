<?php

namespace App\Rpc;

use App\Models\User;
use App\Services\PaymentFixes;
use App\Services\Payments;
use App\Services\Reports;
use App\Support\Audit;
use App\Support\Money;
use App\Support\Perm;
use Illuminate\Support\Facades\DB;
use Throwable;

/** Payments waiting for the night cash count / approval. */
class Approvals
{
    /** "CASH ₹3,000 + BANK SBI ₹1,747" for a split payment, "BANK SBI" / "CASH" otherwise (public.payment_mode_text). */
    public static function modeText(string $mode, ?string $bank, ?string $parts): string
    {
        if ($mode === 'SPLIT') {
            return implode(' + ', array_map(fn ($x) => $x['mode'].(($x['bank_name'] ?? '') !== '' ? ' '.$x['bank_name'] : '').' '
                .Money::inr(Money::paise((string) $x['amount'])), json_decode((string) $parts, true) ?? []));
        }

        return $mode.(($bank ?? '') !== '' ? " $bank" : '');
    }

    /** "SNO 12 · NAME" / "Folio F1 · NAME" for a waiting payment's account. */
    public static function subject(string $source, int $ref): ?string
    {
        if ($source === 'old') {
            $n = DB::table('legacy_accounts')->where('sno', $ref)->value('borrower_name');

            return $n === null ? null : "SNO $ref · $n";
        }
        $l = DB::table('loans as l')->join('borrowers as b', 'b.id', '=', 'l.borrower_id')->where('l.id', $ref)->first(['l.folio_no', 'b.full_name']);

        return $l ? "Folio {$l->folio_no} · {$l->full_name}" : null;
    }

    /** public.pending_approvals() */
    public function list(array $p, User $u): array
    {
        if (! Perm::can($u, 'approve')) {
            return [];
        }

        return DB::table('pending_payments as p')->leftJoin('users as s', 's.id', '=', 'p.created_by')
            ->orderBy('p.created_by')->orderBy('p.created_at')->get(['p.*', 's.full_name'])
            ->map(fn ($r) => [
                'id' => $r->id, 'user_id' => $r->created_by, 'subject' => self::subject($r->source, (int) $r->ref_id), 'source' => $r->source,
                'ref_id' => (int) $r->ref_id, 'paid_amount' => (float) $r->paid_amount, 'paid_date' => $r->paid_date, 'receipt_no' => (int) $r->receipt_no,
                'payment_mode' => self::modeText($r->payment_mode, $r->bank_name, $r->parts), 'reason' => $r->note, 'by_name' => $r->full_name ?? '—',
                'created_at' => $r->created_at, 'cash_part' => Reports::cashPart($r->payment_mode, $r->paid_amount, $r->parts) / 100,
                'receipt_book' => $r->receipt_book,
            ])->all();
    }

    /** public.review_pending(p_ids, p_approve, p_note): approve = post each one as a normal payment; reject = drop it. */
    public function review(array $p, User $u): array
    {
        if (! Perm::can($u, 'approve')) {
            throw RpcError::notAllowed();
        }
        $approve = (bool) ($p['p_approve'] ?? false);
        $note = (string) ($p['p_note'] ?? '');
        $reason = $approve ? null : PaymentFixes::needReason($note);
        $ids = array_values(array_filter(array_map('intval', (array) ($p['p_ids'] ?? [])), fn ($i) => $i > 0));
        $done = 0;
        $amt = 0;
        $failed = [];
        $who = [];
        foreach (DB::table('pending_payments')->whereIn('id', $ids)->orderBy('created_at')->orderBy('id')->lockForUpdate()->get() as $r) {
            if ($approve) {
                try {
                    DB::transaction(function () use ($r) {
                        Payments::post($r->source, (int) $r->ref_id, [
                            'paid_amount' => $r->paid_amount, 'paid_date' => $r->paid_date, 'payment_mode' => $r->payment_mode,
                            'reference_no' => $r->reference_no, 'bank_name' => $r->bank_name, 'receipt_no' => (int) $r->receipt_no,
                            'installments_covered' => (int) $r->installments_covered, 'idempotency_key' => $r->idempotency_key, 'parts' => $r->parts,
                            'series_id' => (int) $r->series_id, 'receipt_book' => $r->receipt_book,
                        ], $r->created_by, $r->created_at);
                        DB::table('pending_payments')->where('id', $r->id)->delete();
                    });
                    $done++;
                    $amt += Money::paise($r->paid_amount);
                    $who[Audit::staffName($r->created_by) ?? '—'] = true;
                } catch (Throwable $e) {
                    $failed[] = ['id' => $r->id, 'receipt_no' => (int) $r->receipt_no, 'reason' => $e->getMessage()];
                }
            } else {
                DB::table('pending_payments')->where('id', $r->id)->delete();
                Audit::log('payment_rejected', null, ['source' => $r->source, 'ref_id' => (int) $r->ref_id], [
                    'reason' => $reason, 'receipt_no' => (int) $r->receipt_no, 'amount' => (float) $r->paid_amount, 'paid_date' => $r->paid_date,
                    'collected_by' => Audit::staffName($r->created_by),
                ]);
                $done++;
                $amt += Money::paise($r->paid_amount);
            }
        }
        if ($approve && $done > 0) {
            Audit::log('payments_approved', implode(', ', array_keys($who)), null, [
                'count' => $done, 'amount' => (float) Money::str($amt), 'note' => trim($note) ?: null, 'failed' => count($failed),
            ]);
        }

        return ['done' => $done, 'amount' => (float) Money::str($amt), 'failed' => $failed];
    }

    /** public.review_payment(p_id, p_approve, p_note): a counted back-dated / big payment flagged for review. */
    public function reviewOne(array $p, User $u): array
    {
        if (! Perm::can($u, 'approve')) {
            throw RpcError::notAllowed();
        }
        $id = (int) ($p['p_id'] ?? 0);
        $o = DB::table('payments')->where('id', $id)->lockForUpdate()->first();
        if (! $o) {
            throw RpcError::notFound('payment not found');
        }
        if ($o->review_reason === null || $o->reviewed_at !== null) {
            throw RpcError::bad('this payment is not waiting for approval');
        }
        if ($p['p_approve'] ?? false) {
            DB::table('payments')->where('id', $id)->update(['reviewed_by' => $u->id, 'reviewed_at' => now()->format('Y-m-d H:i:s.u')]);
            $r = Audit::acctRef($o->legacy_account_id, $o->loan_id);
            Audit::log('payment_approved', $r['subject'], ['source' => $r['source'], 'ref_id' => $r['ref_id']], [
                'receipt_no' => (int) $o->receipt_no, 'amount' => (float) $o->paid_amount, 'why' => $o->review_reason, 'note' => trim((string) ($p['p_note'] ?? '')) ?: null,
            ]);
        } else {
            PaymentFixes::cancelCore($id, PaymentFixes::needReason($p['p_note'] ?? ''), 'payment_rejected');
        }

        return ['id' => $id, 'approved' => (bool) ($p['p_approve'] ?? false)];
    }
}

<?php

namespace App\Http\Controllers;

use App\Services\AccountData;
use App\Services\AccountMath;
use App\Services\AccountQueries;
use App\Services\PaymentError;
use App\Services\Payments;
use App\Services\Receipts;
use App\Support\Perm;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** The Collect screens: accounts that can pay, one account's ledger data, and saving a payment. */
class PaymentsController extends Controller
{
    /** GET /api/payments/pending?q&page — accounts that can take a payment, 30 per page. */
    public function pending(Request $request)
    {
        Perm::need('collect');
        $page = max(1, (int) $request->query('page', 1));
        $query = AccountQueries::search(AccountQueries::pending(), mb_substr((string) $request->query('q', ''), 0, 60));
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('sort_key')->offset(($page - 1) * 30)->limit(30)
            ->get(['source', 'ref_id', 'folio', 'borrower_name', 'borrower_mobile'])->map(fn ($r) => (array) $r)->all();

        return response()->json(['rows' => $rows, 'total' => $total]);
    }

    /**
     * GET /api/ledger/{source}/{ref} — what the Collect window needs; the browser builds the installment rows.
     * 404 when the account can no longer take payments.
     */
    public function ledger(Request $request, string $source, $ref)
    {
        $u = Perm::need('collect');
        abort_unless(in_array($source, ['old', 'new'], true), 404);
        $ref = $this->id($ref);
        if ($source === 'old') {
            $a = AccountData::legacy($ref);
            if (! $a || $a['ledger'] !== 'pending' || AccountMath::legacySettled($a['id'])) {
                return $this->fail('This account is no longer pending.', [], 404);
            }
            $raw = $a;
        } else {
            $l = AccountData::loan($ref);
            if (! $l || ! in_array($l['status'], ['active', 'seized'], true)) {
                return $this->fail('This account is no longer pending.', [], 404);
            }
            $raw = $l;
        }

        return response()->json([
            'ok' => true,
            'source' => $source,
            'refId' => $ref,
            'raw' => $raw,
            'waiting' => AccountData::waiting($source, $ref),
            'receiptHint' => Receipts::hint($source, $ref, $u->id),
            'remarks' => AccountData::remarks($source, $ref, $u),
            'zoneInfo' => AccountData::zoneInfo($source, $ref, $u),
            'canFix' => $u->isAdmin(),
        ]);
    }

    /** GET /api/receipt-hint — the main book hint (My list page). */
    public function hint(Request $request)
    {
        $u = Perm::need('collect');

        return response()->json(Receipts::hint(null, null, $u->id));
    }

    /** POST /api/payments — same input and result as the old recordPayment() server action. */
    public function store(Request $request)
    {
        $u = Perm::need('collect');
        $in = $request->all();
        $v = Validator::make($in, [
            'source' => ['required', 'in:old,new'],
            'refId' => ['required', 'integer', 'min:1'],
            'idempotencyKey' => ['required', 'uuid'],
            'paid_amount' => ['required', 'regex:/^\d{1,9}(\.\d{1,2})?$/'],
            'paid_date' => ['required', 'date_format:Y-m-d'],
            'payment_mode' => ['required', 'in:CASH,CHEQUE,SBI,BANK,SPLIT'],
            'receipt_no' => ['required', 'regex:/^\d{1,12}$/'],
            'reference_no' => ['nullable', 'string', 'max:30'],
            'bank_name' => ['nullable', 'string', 'max:60'],
            'installments_covered' => ['required', 'integer', 'min:1', 'max:360'],
            'parts' => ['nullable', 'array', 'max:4'],
        ], [
            'paid_amount.*' => 'Enter the amount (numbers only, up to 2 decimals)',
            'paid_date.*' => 'Enter the paid date',
            'payment_mode.*' => 'Choose payment mode',
            'receipt_no.*' => 'Enter the receipt number',
            'installments_covered.*' => 'At least 1 EMI',
        ]);
        if ($v->fails()) {
            return $this->fail('Please fix the highlighted fields.', collect($v->errors()->messages())->map(fn ($m) => $m[0])->all());
        }
        $mode = $in['payment_mode'];
        if ($mode === 'CHEQUE' && trim((string) ($in['reference_no'] ?? '')) === '') {
            return $this->fail('Please fix the highlighted fields.', ['reference_no' => 'Enter the cheque number']);
        }
        if ($mode === 'BANK' && trim((string) ($in['bank_name'] ?? '')) === '') {
            return $this->fail('Please fix the highlighted fields.', ['bank_name' => 'Enter the bank name']);
        }

        try {
            $r = Payments::record($u, [
                'source' => $in['source'], 'ref_id' => (int) $in['refId'], 'idempotency_key' => $in['idempotencyKey'],
                'paid_amount' => $in['paid_amount'], 'paid_date' => $in['paid_date'], 'payment_mode' => $mode,
                'receipt_no' => $in['receipt_no'], 'reference_no' => $in['reference_no'] ?? null,
                'bank_name' => $mode === 'BANK' ? ($in['bank_name'] ?? null) : null,
                'installments_covered' => (int) $in['installments_covered'],
                'parts' => $mode === 'SPLIT' ? array_map(fn ($x) => [
                    'mode' => $x['mode'] ?? null, 'amount' => $x['amount'] ?? null,
                    'bank_name' => ($x['mode'] ?? '') === 'BANK' ? ($x['bank_name'] ?? '') : '',
                    'reference_no' => ($x['mode'] ?? '') === 'CASH' ? '' : ($x['reference_no'] ?? ''),
                ], $in['parts'] ?? []) : null,
            ]);
        } catch (PaymentError $e) {
            $field = $e->field ?? (str_contains(strtolower($e->getMessage()), 'part') ? 'parts' : null);

            return $this->fail($e->getMessage(), $field ? [$field => $e->getMessage()] : [], $e->status === 409 ? 422 : $e->status);
        }

        return $this->ok([
            'receiptNo' => $r['receipt_no'],
            'installmentNo' => $r['installment_no'] ?? 0,
            'review' => $r['review'] ?? null,
            'pending' => $r['pending'],
        ]);
    }
}

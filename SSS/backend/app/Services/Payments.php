<?php

namespace App\Services;

use App\Models\User;
use App\Support\Audit;
use App\Support\Money;
use App\Support\Perm;
use Illuminate\Support\Facades\DB;

/** Taking a payment (public.record_payment + app_private.post_payment). */
final class Payments
{
    public const MODES = ['CASH', 'CHEQUE', 'SBI', 'BANK'];

    /**
     * Check and normalise split parts (app_private.check_parts): 2–4 parts, each with a mode and an amount,
     * bank name for BANK, cheque no. for CHEQUE. Throws PaymentError.
     */
    public static function checkParts(mixed $parts): array
    {
        if (! is_array($parts) || count($parts) < 2 || count($parts) > 4) {
            throw new PaymentError('A split payment needs 2 to 4 parts.');
        }
        $out = [];
        foreach ($parts as $x) {
            $mode = $x['mode'] ?? null;
            $amt = Money::paise($x['amount'] ?? null);
            if (! in_array($mode, self::MODES, true)) {
                throw new PaymentError('Choose the mode of each part.');
            }
            if ($amt <= 0) {
                throw new PaymentError('Each part needs an amount more than 0.');
            }
            $bank = trim((string) ($x['bank_name'] ?? '')) ?: null;
            $refNo = trim((string) ($x['reference_no'] ?? '')) ?: null;
            if ($mode === 'BANK' && ! $bank) {
                throw new PaymentError('Enter the bank name for the bank part.');
            }
            if ($mode === 'CHEQUE' && ! $refNo) {
                throw new PaymentError('Enter the cheque number for the cheque part.');
            }
            $out[] = ['mode' => $mode, 'amount' => (float) Money::str($amt), 'bank_name' => $bank, 'reference_no' => $refNo];
        }

        return $out;
    }

    /**
     * The charges on the same receipt (record_payment): OD = days since the oldest unpaid EMI's due date × the rate, only
     * when the screen sends od_amount (another amount: see canChangeOd; $odChange then says what was worked out and taken);
     * seize and other as typed (other needs a note).
     * Returns the payment columns od_amount, od_days, seize_amount, other_amount, other_note, charges. Throws PaymentError.
     */
    public static function charges(User $u, string $source, int $ref, ?string $date, array $p, ?array &$odChange = null): array
    {
        $paise = function (string $k) use ($p): int {
            $v = trim((string) ($p[$k] ?? ''));
            if ($v === '') {
                return 0;
            }
            if (! preg_match('/^\d{1,9}(\.\d{1,2})?$/', $v)) {
                throw new PaymentError('Charges must be amounts of 0 or more.', $k);
            }

            return Money::paise($v);
        };
        $days = 0;
        $od = 0;
        if (trim((string) ($p['od_amount'] ?? '')) !== '') {
            $from = AccountMath::odFrom($source, $ref);
            $days = $from !== null && $date !== null && $date > $from ? AccountMath::days($from, $date) : 0;
            $od = $days * Money::paise(DB::table('app_settings')->where('id', 1)->value('od_per_day') ?? 0);
            $sent = $paise('od_amount');
            if ($sent !== $od) {
                if (! self::canChangeOd($u)) {
                    throw new PaymentError('You are not allowed to change the OD amount.', 'od_amount');
                }
                $odChange = ['suggested' => (float) Money::str($od), 'taken' => (float) Money::str($sent), 'days' => $days,
                    'rate' => (float) DB::table('app_settings')->where('id', 1)->value('od_per_day'), 'paid_date' => $date];
                $od = $sent;
            }
        }
        $seize = $paise('seize_amount');
        $other = $paise('other_amount');
        $note = trim((string) ($p['other_note'] ?? '')) ?: null;
        if ($other > 0 && $note === null) {
            throw new PaymentError('Write what the other charge is for.', 'other_note');
        }
        if ($note !== null && mb_strlen($note) > 100) {
            throw new PaymentError('The other charge note is too long.', 'other_note');
        }

        return [
            'od_amount' => Money::str($od), 'od_days' => $days, 'seize_amount' => Money::str($seize), 'other_amount' => Money::str($other),
            'other_note' => $other > 0 ? $note : null, 'charges' => Money::str($od + $seize + $other),
        ];
    }

    /** Admin, "Late fees & discounts", or anyone while Settings → "Collectors can change the OD" is on. */
    public static function canChangeOd(User $u): bool
    {
        return $u->isAdmin() || Perm::can($u, 'money') || (bool) DB::table('app_settings')->where('id', 1)->value('collectors_change_od');
    }

    /**
     * Save a payment, or put it in the waiting list for the night cash count (people without "approve").
     * $p: source, ref_id, idempotency_key, paid_amount, paid_date, payment_mode, receipt_no, reference_no, bank_name,
     *     installments_covered, parts (split), od_amount, seize_amount, other_amount, other_note (charges).
     * Returns ['id', 'receipt_no', 'installment_no'?, 'balance_after'?, 'pending', 'review'?, 'replayed'].
     */
    public static function record(User $u, array $p): array
    {
        $key = $p['idempotency_key'];
        $source = $p['source'];
        $ref = (int) $p['ref_id'];
        $amount = Money::paise($p['paid_amount'] ?? null);
        $date = $p['paid_date'] ?? null;
        $im = (int) ($p['installments_covered'] ?? 1);
        $rno = (int) ($p['receipt_no'] ?? 0);
        $mode = $p['payment_mode'] ?? null;
        $today = now()->toDateString();

        // the same save sent twice (double tap / retry): return the first one
        if ($r = self::replay($key)) {
            return $r;
        }

        // charges first: a SPLIT's parts cover the EMI amount and the charges
        $odChange = null;
        $charges = self::charges($u, (string) $source, $ref, $date, $p, $odChange);
        $chargePaise = Money::paise($charges['charges']);

        $parts = null;
        if ($mode === 'SPLIT') {
            $parts = self::checkParts($p['parts'] ?? null);
            $sum = array_sum(array_map(fn ($x) => Money::paise((string) $x['amount']), $parts));
            if ($amount && $sum !== $amount + $chargePaise) {
                throw new PaymentError('The parts must add up to the EMI amount and the charges.');
            }
            $amount = $sum - $chargePaise;
            $p['reference_no'] = null;
            $p['bank_name'] = null;
        } elseif (! in_array($mode, self::MODES, true)) {
            throw new PaymentError('Choose payment mode.');
        }
        if ($amount <= 0) {
            throw new PaymentError('Amount must be more than 0.');
        }
        if (! $date || $date > $today) {
            throw new PaymentError('Paid date cannot be in the future.');
        }
        if ($im < 1 || $im > 360) {
            throw new PaymentError('EMIs covered must be 1 or more.');
        }
        if ($rno <= 0) {
            throw new PaymentError('Enter the receipt number.');
        }
        if (! in_array($source, ['old', 'new'], true)) {
            throw new PaymentError('Bad account.');
        }

        return DB::transaction(function () use ($u, $p, $key, $source, $ref, $amount, $date, $im, $rno, $mode, $parts, $today, $charges, $odChange) {
            // one payment at a time per account, and per receipt book (locks held until commit)
            if ($source === 'old') {
                DB::table('legacy_accounts')->where('sno', $ref)->lockForUpdate()->first(['id']);
            } else {
                DB::table('loans')->where('id', $ref)->lockForUpdate()->first(['id']);
            }
            $series = Receipts::openSeries(Receipts::refZone($source, $ref));
            DB::table('receipt_series')->where('id', $series)->lockForUpdate()->first(['id']);
            if ($r = self::replay($key)) {
                return $r;
            }

            // receipt number: never twice inside the book (app payments, waiting payments, old software)
            if (Receipts::used($series, $rno)) {
                $code = DB::table('receipt_series')->where('id', $series)->value('code');
                throw new PaymentError("Receipt no. $rno is already used".($code !== 'MAIN' ? " in book $code" : '').'.', 'receipt_no', 409);
            }

            // people's receipt books inside this zone book
            $s = DB::table('app_settings')->where('id', 1)->first();
            $book = DB::table('receipt_books')->whereNull('closed_at')->where('series_id', $series)
                ->where('from_no', '<=', $rno)->where('to_no', '>=', $rno)->first();
            $mine = DB::table('receipt_books')->where('user_id', $u->id)->whereNull('closed_at')->where('series_id', $series)->orderBy('from_no')->get();
            if ($book && $book->user_id !== $u->id) {
                throw new PaymentError("Receipt no. $rno belongs to ".Audit::staffName($book->user_id)."'s receipt book.", 'receipt_no');
            }
            if (! $book && $mine->isNotEmpty()) {
                $ranges = $mine->map(fn ($b) => "{$b->from_no}–{$b->to_no}")->implode(', ');
                throw new PaymentError("Receipt no. $rno is not in your receipt book ($ranges).", 'receipt_no');
            }
            if (! $book && $s->require_receipt_books && ! $u->isAdmin()) {
                throw new PaymentError('You have no receipt book; ask the admin to give you one.', 'receipt_no');
            }

            // only accounts assigned to you today?
            if ($s->restrict_to_assigned && ! Perm::can($u, 'assign')
                && ! DB::table('collection_assignments')->where(['day' => $today, 'user_id' => $u->id, 'source' => $source, 'ref_id' => $ref])->exists()) {
                throw new PaymentError('This account is not in your collection list for today; ask the admin to assign it.');
            }

            // the account must be open
            if ($source === 'old') {
                $a = DB::table('legacy_accounts')->where('sno', $ref)->where('ledger', 'pending')->first(['id']);
                if (! $a || AccountMath::legacySettled($a->id)) {
                    throw new PaymentError('This account is no longer pending.', null, 404);
                }
            } elseif (! DB::table('loans')->where('id', $ref)->whereIn('status', ['active', 'seized'])->exists()) {
                throw new PaymentError('This loan is no longer open.', null, 404);
            }

            $row = [
                'paid_amount' => Money::str($amount),
                'paid_date' => $date,
                'payment_mode' => $mode,
                'reference_no' => trim((string) ($p['reference_no'] ?? '')) ?: null,
                'bank_name' => $mode === 'BANK' ? (trim((string) ($p['bank_name'] ?? '')) ?: null) : null,
                'receipt_no' => $rno,
                'installments_covered' => $im,
                'idempotency_key' => $key,
                'parts' => $parts === null ? null : json_encode($parts),
                'series_id' => $series,
                'receipt_book' => Receipts::code($series),
            ] + $charges;

            // a changed OD goes to the activity log (to be looked at later)
            if ($odChange !== null) {
                $acct = $source === 'old' ? DB::table('legacy_accounts')->where('sno', $ref)->value('id') : null;
                Audit::log('od_changed', Audit::acctRef($acct, $source === 'new' ? $ref : null)['subject'],
                    ['source' => $source, 'ref_id' => $ref], $odChange + ['receipt_no' => $rno]);
            }

            // people without "approve": wait for the night cash count
            if (! Perm::can($u, 'approve')) {
                $back = now()->subDays((int) $s->review_backdate_days)->toDateString();
                $note = implode(' · ', array_filter([
                    'waiting for cash count',
                    $date < $back ? 'back-dated '.AccountMath::days($date, $today).' days' : null,
                    Money::paise($s->review_above) > 0 && $amount > Money::paise($s->review_above) ? 'more than '.Money::inr(Money::paise($s->review_above)) : null,
                ]));
                $id = DB::table('pending_payments')->insertGetId($row + ['source' => $source, 'ref_id' => $ref, 'note' => $note, 'created_by' => $u->id]);
                $acct = $source === 'old' ? DB::table('legacy_accounts')->where('sno', $ref)->value('id') : null;
                Audit::log('payment_pending', Audit::acctRef($acct, $source === 'new' ? $ref : null)['subject'],
                    ['source' => $source, 'ref_id' => $ref],
                    ['amount' => (float) Money::str($amount), 'receipt_no' => $rno, 'paid_date' => $date, 'mode' => $mode]);

                return ['id' => $id, 'receipt_no' => $rno, 'pending' => true, 'review' => $note, 'replayed' => false];
            }

            $posted = self::post($source, $ref, $row, $u->id, now()->format('Y-m-d H:i:s.u'));

            return ['id' => $posted['id'], 'receipt_no' => $rno, 'installment_no' => $posted['installment_no'],
                'balance_after' => $posted['balance_after'], 'pending' => false, 'replayed' => false];
        });
    }

    /**
     * Insert the payment with its number, due date, EMI, balance and delay (app_private.post_payment).
     * $row holds the payment columns (paid_amount, paid_date, payment_mode, reference_no, bank_name, receipt_no,
     * installments_covered, idempotency_key, parts, series_id, receipt_book).
     */
    public static function post(string $source, int $ref, array $row, string $by, string $at): array
    {
        $calc = AccountMath::nextPayment($source, $ref, Money::paise($row['paid_amount']), $row['paid_date'], (int) $row['installments_covered']);
        if ($calc === null) {
            throw new PaymentError($source === 'old' ? 'This account is no longer pending.' : 'This loan is no longer open.', null, 404);
        }
        $id = DB::table('payments')->insertGetId($row + $calc + ['created_by' => $by, 'created_at' => $at]);
        $r = Audit::acctRef($calc['legacy_account_id'], $calc['loan_id']);
        Audit::log('payment', $r['subject'], ['source' => $r['source'], 'ref_id' => $r['ref_id']], [
            'amount' => (float) $row['paid_amount'], 'receipt_no' => (int) $row['receipt_no'], 'paid_date' => $row['paid_date'],
            'mode' => $row['payment_mode'], 'emis' => (int) $row['installments_covered'],
        ] + ((float) ($row['charges'] ?? 0) > 0 ? ['charges' => (float) $row['charges']] : []), $by);
        Notify::payment($id);

        return ['id' => $id, 'installment_no' => $calc['installment_no'], 'balance_after' => $calc['balance_after']];
    }

    private static function replay(string $key): ?array
    {
        if ($r = DB::table('payments')->where('idempotency_key', $key)->first()) {
            return ['id' => $r->id, 'receipt_no' => (int) $r->receipt_no, 'installment_no' => (int) $r->installment_no,
                'balance_after' => $r->balance_after, 'pending' => false, 'replayed' => true];
        }
        if ($r = DB::table('pending_payments')->where('idempotency_key', $key)->first()) {
            return ['id' => $r->id, 'receipt_no' => (int) $r->receipt_no, 'pending' => true, 'review' => $r->note, 'replayed' => true];
        }

        return null;
    }
}

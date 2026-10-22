<?php

namespace App\Services;

use App\Models\User;
use App\Support\Perm;
use Illuminate\Support\Facades\DB;

/** One account with everything its page / the Collect window shows, in the same shapes as the old app's queries. */
final class AccountData
{
    public const NEW_PAYMENT_COLUMNS = ['id', 'installment_no', 'due_date', 'paid_date', 'delay_days', 'payment_mode', 'reference_no', 'bank_name',
        'receipt_no', 'installments_covered', 'due_amount', 'paid_amount', 'balance_after', 'created_at', 'parts', 'receipt_book',
        'od_amount', 'od_days', 'seize_amount', 'other_amount', 'other_note', 'charges'];

    public const LEGACY_PAYMENT_COLUMNS = ['id', 'ledger', 'installment_no', 'due_date', 'paid_date', 'delay_days', 'payment_mode', 'cheque_no',
        'receipt_no', 'data_flags', 'due_amount', 'paid_amount', 'balance_after', 'receipt_book'];

    public const ADJ_COLUMNS = ['id', 'kind', 'amount', 'entry_date', 'reason', 'new_emi', 'next_due', 'cancelled_at', 'cancel_reason', 'created_at'];

    /** Decode JSON columns and turn 0/1 into booleans. */
    public static function clean(object|array|null $row, array $json = [], array $bool = []): ?array
    {
        if ($row === null) {
            return null;
        }
        $r = (array) $row;
        foreach ($json as $c) {
            if (array_key_exists($c, $r) && is_string($r[$c])) {
                $r[$c] = json_decode($r[$c], true);
            }
        }
        foreach ($bool as $c) {
            if (array_key_exists($c, $r) && $r[$c] !== null) {
                $r[$c] = (bool) $r[$c];
            }
        }

        return $r;
    }

    public static function appPayments(string $col, int $id): array
    {
        return DB::table('payments')->where($col, $id)->orderBy('installment_no')->get(self::NEW_PAYMENT_COLUMNS)
            ->map(fn ($r) => self::clean($r, ['parts']))->all();
    }

    public static function adjustments(string $col, int $id): array
    {
        return DB::table('adjustments')->where($col, $id)->orderBy('created_at')->get(self::ADJ_COLUMNS)->map(fn ($r) => (array) $r)->all();
    }

    public static function seizures(string $col, int $id): array
    {
        return DB::table('seizures as s')->leftJoin('users as u', 'u.id', '=', 's.created_by')->where("s.$col", $id)
            ->orderBy('s.created_at')->get(['s.id', 's.action', 's.action_date', 's.remarks', 's.created_at', 'u.full_name'])
            ->map(fn ($r) => ['id' => $r->id, 'action' => $r->action, 'action_date' => $r->action_date, 'remarks' => $r->remarks,
                'created_at' => $r->created_at, 'staff' => $r->full_name === null ? null : ['full_name' => $r->full_name]])->all();
    }

    /** An old-software account by SNO, with its receipts, app payments, seizures and adjustments. */
    public static function legacy(int $sno): ?array
    {
        $a = DB::table('legacy_accounts')->where('sno', $sno)->first([
            'id', 'ledger', 'sno', 'fno', 'fcode', 'borrower_name', 'borrower_father', 'borrower_address', 'borrower_mobile', 'borrower_mobile2',
            'guarantor_name', 'guarantor_father', 'guarantor_address', 'guarantor_mobile', 'guarantor_mobile2', 'finance_mode', 'zone',
            'vehicle_condition', 'vehicle_model', 'vehicle_variant', 'chassis_no', 'engine_no', 'model_year', 'registration_no',
            'agreement_date', 'tenure_months', 'interval_months', 'seized', 'data_flags', 'finance_amount', 'interest_amount',
            'agreement_amount', 'hp_amount', 'total_amount', 'emi_amount', 'legacy_paid', 'edited_in_app',
        ]);
        if (! $a) {
            return null;
        }
        $r = self::clean($a, ['data_flags'], ['seized', 'edited_in_app']);
        $r['legacy_payments'] = DB::table('legacy_payments')->where('account_id', $a->id)->orderBy('installment_no')
            ->get(self::LEGACY_PAYMENT_COLUMNS)->map(fn ($x) => self::clean($x, ['data_flags']))->all();
        $r['payments'] = self::appPayments('legacy_account_id', $a->id);
        $r['seizures'] = self::seizures('legacy_account_id', $a->id);
        $r['adjustments'] = self::adjustments('legacy_account_id', $a->id);

        return $r;
    }

    /** A new loan with its borrower, payments, seizures and adjustments. */
    public static function loan(int $id): ?array
    {
        $l = DB::table('loans')->where('id', $id)->first();
        if (! $l) {
            return null;
        }
        $r = (array) $l;
        unset($r['idempotency_key'], $r['created_by']);
        $b = DB::table('borrowers')->where('id', $l->borrower_id)->first(['full_name', 'father_name', 'mobile', 'date_of_birth', 'address']);
        $r['borrowers'] = (array) $b;
        $r['payments'] = self::appPayments('loan_id', $id);
        $r['seizures'] = self::seizures('loan_id', $id);
        $r['adjustments'] = self::adjustments('loan_id', $id);

        return $r;
    }

    /** Payments taken by collection men that wait for approval (not counted in the balance yet). */
    public static function waiting(string $source, int $ref): array
    {
        return DB::table('pending_payments')->where('source', $source)->where('ref_id', $ref)->orderBy('created_at')
            ->get(['receipt_no', 'receipt_book', 'paid_amount', 'paid_date', 'payment_mode', 'bank_name', 'parts', 'created_at', 'charges'])
            ->map(fn ($r) => self::clean($r, ['parts']))->all();
    }

    /** For the charges in the payment window: OD rate and its start, seizure, admin or not (public.charge_info). */
    public static function chargeInfo(string $source, int $ref, User $u): array
    {
        if ($source === 'old') {
            $a = DB::table('legacy_accounts')->where('sno', $ref)->first(['id', 'seized']);
            $e = $a ? DB::table('seizures')->where('legacy_account_id', $a->id)->orderByDesc('created_at')->orderByDesc('id')->first(['action', 'action_date']) : null;
            $seized = $a !== null && ($e !== null ? $e->action === 'seize' : (bool) $a->seized); // the latest seize / release wins
            $last = $e?->action_date;
        } else {
            $seized = DB::table('loans')->where('id', $ref)->value('status') === 'seized';
            $last = DB::table('seizures')->where('loan_id', $ref)->orderByDesc('created_at')->orderByDesc('id')->value('action_date');
        }

        return [
            'od_rate' => (float) DB::table('app_settings')->where('id', 1)->value('od_per_day'),
            'od_from' => AccountMath::odFrom($source, $ref),
            'seized' => $seized,
            'seized_on' => $seized ? $last : null,
            'admin' => $u->isAdmin(),
        ];
    }

    /** Any payment (counted or waiting) entered after this moment (app_private.paid_after). */
    public static function paidAfter(string $source, int $ref, string $at): bool
    {
        $q = DB::table('payments')->where('created_at', '>', $at);
        $q = $source === 'old'
            ? $q->where('legacy_account_id', DB::table('legacy_accounts')->where('sno', $ref)->value('id'))
            : $q->where('loan_id', $ref);

        return $q->exists() || DB::table('pending_payments')->where('source', $source)->where('ref_id', $ref)->where('created_at', '>', $at)->exists();
    }

    /** Visit remarks on one account, newest first (public.account_remarks). */
    public static function remarks(string $source, int $ref, User $u): array
    {
        return DB::table('visit_remarks as r')->leftJoin('users as u', 'u.id', '=', 'r.created_by')
            ->where('r.source', $source)->where('r.ref_id', $ref)->orderByDesc('r.created_at')
            ->get(['r.id', 'r.installment_no', 'r.remark', 'r.promise_date', 'r.created_at', 'r.created_by', 'u.full_name'])
            ->map(fn ($r) => ['id' => $r->id, 'installment_no' => $r->installment_no, 'remark' => $r->remark, 'promise_date' => $r->promise_date,
                'created_at' => $r->created_at, 'by_name' => $r->full_name ?? '—', 'mine' => $r->created_by === $u->id,
                'paid_after' => self::paidAfter($source, $ref, $r->created_at)])->all();
    }

    /** The account's zone, the zone list and whether this person may change it (public.account_zone_info). */
    public static function zoneInfo(string $source, int $ref, User $u): array
    {
        $cur = trim((string) Receipts::refZone($source, $ref));
        $known = $cur !== '' ? DB::table('zones')->where('name', $cur)->value('name') : null;

        return [
            'zone' => $known ?? ($cur !== '' ? $cur : null),
            'in_list' => $known !== null,
            'zones' => DB::table('zones')->where('active', 1)->orderBy('name')->pluck('name')->all(),
            'can_change' => $known !== null ? Perm::can($u, 'fix_entries') : Perm::any($u, 'collect', 'fix_entries'),
        ];
    }
}

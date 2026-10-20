<?php

namespace App\Services;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/** The lists of accounts (views all_accounts / legacy_account_summary / pending_borrowers of the old app). */
final class AccountQueries
{
    /** "seized" for an old account: the latest seize / release in the app, else the old software's flag. */
    public const LEGACY_SEIZED = "coalesce((select e.action = 'seize' from seizures e where e.legacy_account_id = a.id order by e.created_at desc, e.id desc limit 1), a.seized, 0)";

    /** App payments and adjustments per old account. */
    private static function legacyTotals(): array
    {
        $n = DB::table('payments')->whereNotNull('legacy_account_id')->groupBy('legacy_account_id')
            ->selectRaw('legacy_account_id, count(*) as cnt, sum(paid_amount) as paid, max(paid_date) as last_paid');
        $j = DB::table('adjustments')->whereNotNull('legacy_account_id')->whereNull('cancelled_at')->groupBy('legacy_account_id')
            ->selectRaw("legacy_account_id, sum(amount) as adj, max(kind = 'settle') as settled");

        return [$n, $j];
    }

    /** Every account, old and new, one row each (all_accounts). */
    public static function all(): Builder
    {
        [$n, $j] = self::legacyTotals();
        $old = DB::table('legacy_accounts as a')
            ->leftJoinSub($n, 'n', 'n.legacy_account_id', '=', 'a.id')
            ->leftJoinSub($j, 'j', 'j.legacy_account_id', '=', 'a.id')
            ->selectRaw("'old' as source, a.sno as ref_id, cast(a.fno as char) as folio,
                case when coalesce(j.settled, 0) = 1 then 'closed' else a.ledger end as ledger,
                a.borrower_name, a.borrower_father, a.borrower_mobile, a.registration_no, a.vehicle_model, a.tenure_months,
                a.legacy_payments_count + coalesce(n.cnt, 0) as payments_count, ".self::LEGACY_SEIZED.' as seized,
                a.total_amount, a.emi_amount, cast(a.legacy_paid + coalesce(n.paid, 0) as decimal(14,2)) as total_paid,
                cast(a.total_amount + coalesce(j.adj, 0) - a.legacy_paid - coalesce(n.paid, 0) as decimal(14,2)) as balance,
                a.search_text, a.sno as sort_key');

        $np = DB::table('payments')->whereNotNull('loan_id')->groupBy('loan_id')->selectRaw('loan_id, count(*) as cnt, sum(paid_amount) as paid');
        $lj = DB::table('adjustments')->whereNotNull('loan_id')->whereNull('cancelled_at')->groupBy('loan_id')->selectRaw('loan_id, sum(amount) as adj');
        $new = DB::table('loans as l')->join('borrowers as b', 'b.id', '=', 'l.borrower_id')
            ->leftJoinSub($np, 'np', 'np.loan_id', '=', 'l.id')
            ->leftJoinSub($lj, 'lj', 'lj.loan_id', '=', 'l.id')
            ->selectRaw("'new', l.id, l.folio_no, case when l.status = 'closed' then 'closed' else 'pending' end,
                b.full_name, b.father_name, b.mobile, l.vehicle_no, l.vehicle_model, l.installments,
                coalesce(np.cnt, 0), l.status = 'seized', l.total_amount, l.emi_amount, cast(coalesce(np.paid, 0) as decimal(14,2)),
                cast(l.total_amount + coalesce(lj.adj, 0) - coalesce(np.paid, 0) as decimal(14,2)),
                lower(concat_ws(' ', l.folio_no, b.full_name, coalesce(b.mobile, ''), coalesce(l.vehicle_no, ''), coalesce(b.father_name, ''))),
                1000000000 + l.id");

        return DB::query()->fromSub($old->unionAll($new), 'x');
    }

    /** Accounts that can take a payment: old pending (not closed in the app) + new active / seized (pending_borrowers). */
    public static function pending(): Builder
    {
        $old = DB::table('legacy_accounts as a')->where('a.ledger', 'pending')
            ->whereNotExists(fn ($q) => $q->from('adjustments as x')->whereColumn('x.legacy_account_id', 'a.id')->where('x.kind', 'settle')->whereNull('x.cancelled_at'))
            ->selectRaw("'old' as source, a.sno as ref_id, cast(a.fno as char) as folio, a.borrower_name, a.borrower_mobile, a.search_text, a.sno as sort_key");
        $new = DB::table('loans as l')->join('borrowers as b', 'b.id', '=', 'l.borrower_id')->whereIn('l.status', ['active', 'seized'])
            ->selectRaw("'new', l.id, l.folio_no, b.full_name, b.mobile,
                lower(concat_ws(' ', l.folio_no, b.full_name, coalesce(b.mobile, ''), coalesce(l.vehicle_no, ''))), 1000000000 + l.id");

        return DB::query()->fromSub($old->unionAll($new), 'x');
    }

    /** "Search text" filter: every word must appear (like the old ilike '%q%'). */
    public static function search(Builder $q, ?string $text, string $col = 'search_text'): Builder
    {
        $text = mb_strtolower(trim((string) $text));
        if ($text !== '') {
            $q->where($col, 'like', '%'.addcslashes($text, '%_\\').'%');
        }

        return $q;
    }
}

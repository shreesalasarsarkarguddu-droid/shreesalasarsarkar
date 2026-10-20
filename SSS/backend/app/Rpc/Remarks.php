<?php

namespace App\Rpc;

use App\Models\User;
use App\Services\AccountData;
use App\Support\Audit;
use App\Support\Perm;
use Illuminate\Support\Facades\DB;

/** Visit remarks ("payment not received") and an account's zone. */
class Remarks
{
    /** public.add_remark(p): { source, ref_id, installment_no, remark, promise_date } */
    public function add(array $p, User $u): array
    {
        $p = $p['p'] ?? $p;
        if (! Perm::can($u, 'collect')) {
            throw RpcError::notAllowed();
        }
        $source = $p['source'] ?? '';
        $ref = (int) ($p['ref_id'] ?? 0);
        if ($source === 'old') {
            if (! DB::table('legacy_accounts')->where('sno', $ref)->exists()) {
                throw RpcError::notFound('account not found');
            }
        } elseif ($source === 'new') {
            if (! DB::table('loans')->where('id', $ref)->exists()) {
                throw RpcError::notFound('loan not found');
            }
        } else {
            throw RpcError::bad('bad source');
        }
        $remark = trim((string) ($p['remark'] ?? ''));
        if (mb_strlen($remark) < 2) {
            throw RpcError::bad('write what the customer said');
        }
        if (mb_strlen($remark) > 300) {
            throw RpcError::bad('the remark is too long (300 letters at most)');
        }
        $promise = ($p['promise_date'] ?? '') ?: null;
        $today = now()->toDateString();
        if ($promise !== null && (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $promise) || $promise < $today || $promise > date('Y-m-d', strtotime("$today +400 days")))) {
            throw RpcError::bad('the pay-on date must be today or later');
        }
        $id = DB::table('visit_remarks')->insertGetId(['source' => $source, 'ref_id' => $ref,
            'installment_no' => ($p['installment_no'] ?? '') === '' || ($p['installment_no'] ?? null) === null ? null : (int) $p['installment_no'],
            'remark' => $remark, 'promise_date' => $promise, 'created_by' => $u->id]);

        return ['id' => $id];
    }

    /** public.delete_remark(p_id): the writer the same day, or "fix mistakes" any time. */
    public function delete(array $p, User $u): ?bool
    {
        $r = DB::table('visit_remarks')->where('id', (int) ($p['p_id'] ?? 0))->lockForUpdate()->first();
        if (! $r) {
            throw RpcError::notFound('remark not found');
        }
        if (! (Perm::can($u, 'fix_entries') || ($r->created_by === $u->id && substr($r->created_at, 0, 10) === now()->toDateString()))) {
            throw RpcError::notAllowed('only admin can delete an older remark');
        }
        DB::table('visit_remarks')->where('id', $r->id)->delete();
        $acct = $r->source === 'old' ? DB::table('legacy_accounts')->where('sno', $r->ref_id)->value('id') : null;
        Audit::log('remark_deleted', Audit::acctRef($acct, $r->source === 'new' ? (int) $r->ref_id : null)['subject'],
            ['source' => $r->source, 'ref_id' => (int) $r->ref_id],
            ['remark' => $r->remark, 'promise_date' => $r->promise_date, 'written_by' => Audit::staffName($r->created_by), 'written_on' => substr($r->created_at, 0, 10)]);

        return null;
    }

    /**
     * public.remarks_list(p_from, p_to, p_user, p_q, p_status, p_promise, p_limit, p_offset).
     * status: null all | open (no payment since) | paid | broken (pay-on date passed, not paid). Others see only their own.
     */
    public function list(array $p, User $u): array
    {
        if (! Perm::any($u, 'view_accounts', 'collect')) {
            return [];
        }
        $q = DB::table('visit_remarks as r')
            ->leftJoin('legacy_accounts as a', fn ($j) => $j->on('a.sno', '=', 'r.ref_id')->where('r.source', '=', 'old'))
            ->leftJoin('loans as l', fn ($j) => $j->on('l.id', '=', 'r.ref_id')->where('r.source', '=', 'new'))
            ->leftJoin('borrowers as b', 'b.id', '=', 'l.borrower_id')
            ->leftJoin('users as s', 's.id', '=', 'r.created_by')
            ->select(['r.*', 's.full_name as by_name'])
            ->selectRaw("case when r.source = 'old' then a.borrower_name else b.full_name end as name")
            ->selectRaw("case when r.source = 'old' then cast(a.fno as char) else l.folio_no end as folio")
            ->selectRaw("case when r.source = 'old' then a.borrower_mobile else b.mobile end as mobile");
        if (! ($u->isAdmin() || Perm::any($u, 'assign', 'approve'))) {
            $q->where('r.created_by', $u->id);
        }
        if ($p['p_from'] ?? null) {
            $q->whereRaw('date(r.created_at) >= ?', [$p['p_from']]);
        }
        if ($p['p_to'] ?? null) {
            $q->whereRaw('date(r.created_at) <= ?', [$p['p_to']]);
        }
        if ($p['p_user'] ?? null) {
            $q->where('r.created_by', $p['p_user']);
        }
        if ($p['p_promise'] ?? null) {
            $q->where('r.promise_date', $p['p_promise']);
        }
        $text = mb_strtolower(trim((string) ($p['p_q'] ?? '')));
        $rows = $q->orderByDesc('r.created_at')->get();
        $today = now()->toDateString();
        $out = [];
        foreach ($rows as $r) {
            if ($text !== '' && ! (str_contains(mb_strtolower((string) $r->name), $text) || str_contains(mb_strtolower((string) $r->mobile), $text)
                || str_starts_with(mb_strtolower((string) $r->folio), $text) || str_contains(mb_strtolower($r->remark), $text))) {
                continue;
            }
            $paid = AccountData::paidAfter($r->source, (int) $r->ref_id, $r->created_at);
            $status = $p['p_status'] ?? null;
            if (($status === 'open' && $paid) || ($status === 'paid' && ! $paid) || ($status === 'broken' && ($paid || $r->promise_date === null || $r->promise_date >= $today))) {
                continue;
            }
            $out[] = ['id' => $r->id, 'source' => $r->source, 'ref_id' => (int) $r->ref_id, 'subject' => $r->name, 'folio' => $r->folio, 'mobile' => $r->mobile,
                'installment_no' => $r->installment_no, 'remark' => $r->remark, 'promise_date' => $r->promise_date, 'created_at' => $r->created_at,
                'by_user' => $r->created_by, 'by_name' => $r->by_name ?? '—', 'paid_after' => $paid];
        }
        $total = count($out);
        $limit = min(max((int) ($p['p_limit'] ?? 100), 1), 500);
        $page = array_slice($out, max((int) ($p['p_offset'] ?? 0), 0), $limit);

        return array_map(fn ($r) => $r + ['total' => $total], $page);
    }

    /** public.set_account_zone(p_source, p_ref, p_zone): no zone yet -> anyone who collects; already in a zone -> fix mistakes only. */
    public function setZone(array $p, User $u): array
    {
        $source = $p['p_source'] ?? '';
        $ref = (int) ($p['p_ref'] ?? 0);
        $new = mb_strtoupper(trim((string) ($p['p_zone'] ?? ''))) ?: null;
        $table = match ($source) {
            'old' => 'legacy_accounts', 'new' => 'loans', default => throw RpcError::bad('bad source'),
        };
        $key = $source === 'old' ? 'sno' : 'id';
        $row = DB::table($table)->where($key, $ref)->lockForUpdate()->first(['id', 'zone']);
        if (! $row) {
            throw RpcError::notFound($source === 'old' ? 'account not found' : 'loan not found');
        }
        $old = trim((string) $row->zone);
        $inList = $old !== '' && DB::table('zones')->where('name', $old)->exists();
        if ($inList && ! Perm::can($u, 'fix_entries')) {
            throw RpcError::notAllowed('only admin can change a zone that is already set');
        }
        if (! $inList && ! Perm::any($u, 'collect', 'fix_entries')) {
            throw RpcError::notAllowed();
        }
        if ($new !== null && ! DB::table('zones')->where('name', $new)->where('active', 1)->exists()) {
            throw RpcError::bad('choose a zone from the list');
        }
        if (mb_strtoupper($old) === (string) $new) {
            return ['zone' => $new, 'changed' => false];
        }
        DB::table($table)->where('id', $row->id)->update(['zone' => $new] + ($source === 'old' ? ['zone_set_in_app' => true] : []));
        $r = Audit::acctRef($source === 'old' ? (int) $row->id : null, $source === 'new' ? $ref : null);
        Audit::log('zone_changed', $r['subject'], ['source' => $r['source'], 'ref_id' => $r['ref_id']], ['from' => $old !== '' ? $old : 'DHAMTARI', 'to' => $new ?? 'DHAMTARI']);

        return ['zone' => $new, 'changed' => true];
    }
}

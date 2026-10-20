<?php

namespace App\Rpc;

use App\Models\User;
use App\Services\DueReport;
use App\Support\Audit;
use App\Support\Money;
use App\Support\Perm;
use Illuminate\Support\Facades\DB;

/** Collection lists: which collection man visits which accounts on a day. */
class Collections
{
    /** public.assign_collections(p_day, p_user, p_items, p_note) */
    public function assign(array $p, User $u): array
    {
        if (! Perm::can($u, 'assign')) {
            throw RpcError::notAllowed();
        }
        $day = (string) ($p['p_day'] ?? '');
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $day) || $day < now()->subDay()->toDateString()) {
            throw RpcError::bad('choose today or a later day');
        }
        $who = DB::table('users')->where('id', $p['p_user'] ?? '')->where('active', 1)->first();
        if (! $who || ! ($who->role === 'admin' || in_array('collect', json_decode($who->permissions, true) ?? [], true))) {
            throw RpcError::bad('this person cannot collect payments (give them "Collect payments" first)');
        }
        $items = $p['p_items'] ?? null;
        if (! is_array($items) || count($items) === 0) {
            throw RpcError::bad('choose at least one account');
        }
        if (count($items) > 500) {
            throw RpcError::bad('at most 500 accounts at once');
        }
        $note = trim((string) ($p['p_note'] ?? '')) ?: null;
        $moved = 0;
        $n = 0;
        foreach ($items as $i) {
            $src = $i['source'] ?? null;
            $ref = (int) ($i['ref_id'] ?? 0);
            if (! in_array($src, ['old', 'new'], true) || $ref <= 0) {
                continue;
            }
            $cur = DB::table('collection_assignments')->where(['day' => $day, 'source' => $src, 'ref_id' => $ref])->lockForUpdate()->first();
            if ($cur) {
                $moved += $cur->user_id !== $who->id ? 1 : 0;
                DB::table('collection_assignments')->where('id', $cur->id)->update([
                    'user_id' => $who->id, 'note' => $note ?? $cur->note, 'created_by' => $u->id, 'created_at' => now()->format('Y-m-d H:i:s.u'),
                ]);
            } else {
                DB::table('collection_assignments')->insert(['day' => $day, 'user_id' => $who->id, 'source' => $src, 'ref_id' => $ref, 'note' => $note,
                    'created_by' => $u->id]);
            }
            $n++;
        }
        Audit::log('assigned', $who->full_name, null, ['day' => $day, 'accounts' => $n, 'moved_from_others' => $moved]);

        return ['assigned' => $n, 'moved' => $moved];
    }

    /** Address of each account: "old:SNO" / "new:ID" => address. */
    private static function addresses(): array
    {
        $out = [];
        foreach (DB::table('legacy_accounts')->get(['sno', 'borrower_address']) as $a) {
            $out["old:{$a->sno}"] = $a->borrower_address;
        }
        foreach (DB::table('loans as l')->join('borrowers as b', 'b.id', '=', 'l.borrower_id')->get(['l.id', 'b.address']) as $l) {
            $out["new:{$l->id}"] = $l->address;
        }

        return $out;
    }

    /**
     * public.assign_candidates(p_day, p_q, p_filter): accounts with a balance, biggest arrears first (at most 300).
     * filter: due_day | overdue | overdue3 | week | unassigned | all (all also shows seized ones).
     */
    public function candidates(array $p, User $u): array
    {
        if (! Perm::can($u, 'assign')) {
            throw RpcError::notAllowed();
        }
        $day = (string) ($p['p_day'] ?? now()->toDateString());
        $q = mb_strtolower(trim((string) ($p['p_q'] ?? '')));
        $filter = (string) ($p['p_filter'] ?? '');
        $week = date('Y-m-d', strtotime("$day +6 days"));
        $addr = self::addresses();
        $assigned = [];
        foreach (DB::table('collection_assignments as c')->leftJoin('users as s', 's.id', '=', 'c.user_id')->where('c.day', $day)
            ->get(['c.source', 'c.ref_id', 's.full_name']) as $c) {
            $assigned["{$c->source}:{$c->ref_id}"] = $c->full_name ?? '—';
        }
        $rows = [];
        foreach (DueReport::run($day) as $d) {
            $k = "{$d['source']}:{$d['ref_id']}";
            $a = $addr[$k] ?? null;
            if (Money::paise($d['balance']) <= 0) {
                continue;
            }
            if ($q !== '' && ! str_contains($d['search_text'], $q) && ! str_contains(mb_strtolower((string) $a), $q)) {
                continue;
            }
            $ok = match ($filter) {
                'due_day' => $d['next_due'] === $day,
                'overdue' => Money::paise($d['arrears']) > 0,
                'overdue3' => $d['overdue_emis'] >= 3,
                'week' => $d['next_due'] !== null && $d['next_due'] >= $day && $d['next_due'] <= $week,
                'unassigned' => ! isset($assigned[$k]),
                default => true,
            };
            if (! $ok || ($filter !== 'all' && $d['seized'])) {
                continue;
            }
            $rows[] = ['source' => $d['source'], 'ref_id' => $d['ref_id'], 'folio' => $d['folio'], 'borrower_name' => $d['borrower_name'],
                'mobile' => $d['mobile'], 'address' => $a, 'emi' => (float) $d['emi'], 'balance' => (float) $d['balance'], 'arrears' => (float) $d['arrears'],
                'overdue_emis' => $d['overdue_emis'], 'next_due' => $d['next_due'], 'seized' => $d['seized'], 'assigned_to' => $assigned[$k] ?? null];
        }
        usort($rows, fn ($x, $y) => [$y['arrears'], $x['next_due'] === null ? 1 : 0, $x['next_due'] ?? ''] <=> [$x['arrears'], $y['next_due'] === null ? 1 : 0, $y['next_due'] ?? '']);

        return array_slice($rows, 0, 300);
    }

    /** public.collection_list(p_day, p_user): the accounts on collection lists that day, with what was collected. */
    public function list(array $p, User $u): array
    {
        if (! Perm::any($u, 'collect', 'assign')) {
            throw RpcError::notAllowed();
        }
        $day = (string) ($p['p_day'] ?? now()->toDateString());
        $who = $p['p_user'] ?? null;
        if (($who === null || $who !== $u->id) && ! Perm::can($u, 'assign')) {
            throw RpcError::notAllowed();
        }
        $a = DB::table('collection_assignments as c')->leftJoin('users as s', 's.id', '=', 'c.user_id')->where('c.day', $day)
            ->when($who, fn ($q) => $q->where('c.user_id', $who))->get(['c.*', 's.full_name']);
        if ($a->isEmpty()) {
            return [];
        }
        $due = collect(DueReport::run($day))->keyBy(fn ($d) => "{$d['source']}:{$d['ref_id']}");
        $snoOf = DB::table('legacy_accounts')->pluck('sno', 'id');
        $paid = [];
        foreach (DB::table('payments')->whereRaw('date(created_at) = ?', [$day])->get(['legacy_account_id', 'loan_id', 'paid_amount']) as $x) {
            $k = $x->loan_id === null ? 'old:'.$snoOf[$x->legacy_account_id] : "new:{$x->loan_id}";
            $paid[$k] ??= ['amt' => 0, 'n' => 0, 'wait' => 0];
            $paid[$k]['amt'] += Money::paise($x->paid_amount);
            $paid[$k]['n']++;
        }
        foreach (DB::table('pending_payments')->whereRaw('date(created_at) = ?', [$day])->get(['source', 'ref_id', 'paid_amount']) as $x) {
            $k = "{$x->source}:{$x->ref_id}";
            $paid[$k] ??= ['amt' => 0, 'n' => 0, 'wait' => 0];
            $paid[$k]['amt'] += Money::paise($x->paid_amount);
            $paid[$k]['n']++;
            $paid[$k]['wait'] += Money::paise($x->paid_amount);
        }
        $rows = [];
        foreach ($a as $c) {
            $k = "{$c->source}:{$c->ref_id}";
            $d = $due[$k] ?? null;
            if ($c->source === 'old') {
                $x = DB::table('legacy_accounts')->where('sno', $c->ref_id)->first(['fno', 'borrower_name', 'borrower_mobile', 'borrower_mobile2', 'borrower_address',
                    'vehicle_model', 'registration_no']);
                $info = ['folio' => $x?->fno === null ? null : (string) $x->fno, 'name' => $x?->borrower_name,
                    'mobile' => implode(', ', array_filter([$x?->borrower_mobile, $x?->borrower_mobile2], fn ($m) => $m !== null)) ?: null,
                    'address' => $x?->borrower_address, 'vehicle' => implode(' · ', array_filter([$x?->vehicle_model, $x?->registration_no], fn ($m) => $m !== null)) ?: null];
            } else {
                $x = DB::table('loans as l')->join('borrowers as b', 'b.id', '=', 'l.borrower_id')->where('l.id', $c->ref_id)
                    ->first(['l.folio_no', 'b.full_name', 'b.mobile', 'b.address', 'l.vehicle_model', 'l.vehicle_no']);
                $info = ['folio' => $x?->folio_no, 'name' => $x?->full_name, 'mobile' => $x?->mobile, 'address' => $x?->address,
                    'vehicle' => implode(' · ', array_filter([$x?->vehicle_model, $x?->vehicle_no], fn ($m) => $m !== null)) ?: null];
            }
            $pd = $paid[$k] ?? ['amt' => 0, 'n' => 0, 'wait' => 0];
            $rows[] = [
                'id' => $c->id, 'user_id' => $c->user_id, 'collector' => $c->full_name ?? '—', 'source' => $c->source, 'ref_id' => (int) $c->ref_id,
                'folio' => $d['folio'] ?? $info['folio'], 'borrower_name' => $d['borrower_name'] ?? $info['name'], 'mobile' => $d['mobile'] ?? $info['mobile'],
                'address' => $info['address'], 'vehicle' => $info['vehicle'],
                'emi' => $d ? (float) $d['emi'] : null, 'balance' => $d ? (float) $d['balance'] : null, 'arrears' => $d ? (float) $d['arrears'] : null,
                'overdue_emis' => $d['overdue_emis'] ?? null, 'next_due' => $d['next_due'] ?? null, 'seized' => (bool) ($d['seized'] ?? false), 'closed' => $d === null,
                'collected' => $pd['amt'] / 100, 'receipts' => $pd['n'], 'note' => $c->note, 'waiting' => $pd['wait'] / 100,
            ];
        }
        usort($rows, fn ($x, $y) => [$x['collector'], -($x['arrears'] ?? 0), $x['id']] <=> [$y['collector'], -($y['arrears'] ?? 0), $y['id']]);

        return $rows;
    }

    /** public.unassign_collections(p_ids) */
    public function unassign(array $p, User $u): int
    {
        if (! Perm::can($u, 'assign')) {
            throw RpcError::notAllowed();
        }
        $ids = array_values(array_filter(array_map('intval', (array) ($p['p_ids'] ?? [])), fn ($i) => $i > 0));
        $n = $ids ? DB::table('collection_assignments')->whereIn('id', $ids)->delete() : 0;
        Audit::log('unassigned', null, null, ['removed' => $n]);

        return $n;
    }
}

<?php

namespace App\Rpc;

use App\Models\User;
use App\Support\Audit;
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

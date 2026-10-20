<?php

namespace App\Rpc;

use App\Models\User;
use App\Support\Perm;
use Illuminate\Support\Facades\DB;

/** Staff lists for the control pages. */
class Staff
{
    /** public.staff_names(p_all): everyone (removed ones only with p_all), for people who manage staff work. */
    public function names(array $p, User $u): array
    {
        if (! Perm::any($u, 'cash', 'activity', 'approve', 'assign')) {
            return [];
        }

        return DB::table('users')->when(! ($p['p_all'] ?? false), fn ($q) => $q->whereNull('archived_at'))
            ->orderByRaw('archived_at is not null')->orderByDesc('active')->orderBy('full_name')
            ->get(['id', 'full_name', 'active', 'archived_at'])
            ->map(fn ($r) => ['user_id' => $r->id, 'full_name' => $r->full_name.($r->archived_at !== null ? ' (removed)' : ''), 'active' => (bool) $r->active])
            ->all();
    }
}

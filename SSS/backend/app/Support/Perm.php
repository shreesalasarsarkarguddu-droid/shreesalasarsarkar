<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Http\Exceptions\HttpResponseException;

/** The same permission keys as the old app (src/lib/permissions.ts). Admins have every permission. */
final class Perm
{
    public const KEYS = [
        'view_accounts', 'collect', 'new_loan', 'seize', 'reports', 'assign', 'backdate', 'approve', 'cash',
        'fix_entries', 'money', 'activity', 'backup',
    ];

    public static function can(?User $u, string $p): bool
    {
        return $u !== null && $u->active && ($u->role === 'admin' || in_array($p, $u->permissions ?? [], true));
    }

    /** Stop the request with 403 unless the signed-in person has this permission. */
    public static function need(string $p): User
    {
        $u = auth()->user();
        if (! self::can($u, $p)) {
            throw new HttpResponseException(response()->json(['ok' => false, 'error' => 'Your login is not allowed to do this.'], 403));
        }

        return $u;
    }

    public static function needAdmin(): User
    {
        $u = auth()->user();
        if (! $u || ! $u->active || $u->role !== 'admin') {
            throw new HttpResponseException(response()->json(['ok' => false, 'error' => 'Only the admin can do this.'], 403));
        }

        return $u;
    }

    /** Has any one of these permissions. */
    public static function any(?User $u, string ...$ps): bool
    {
        foreach ($ps as $p) {
            if (self::can($u, $p)) {
                return true;
            }
        }

        return false;
    }

    /** Keep only known keys, no duplicates. */
    public static function clean(array $perms): array
    {
        return array_values(array_unique(array_intersect($perms, self::KEYS)));
    }
}

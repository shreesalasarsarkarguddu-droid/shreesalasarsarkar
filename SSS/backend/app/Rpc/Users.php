<?php

namespace App\Rpc;

use App\Models\User;
use App\Support\Audit;
use App\Support\Perm;
use Illuminate\Support\Facades\DB;

/** Staff logins (admin only). */
class Users
{
    private static function admin(User $u): void
    {
        if (! $u->isAdmin()) {
            throw RpcError::notAllowed('only admin');
        }
    }

    /** Known keys, sorted, with "view_accounts" added whenever any is given (app_private.clean_perms). */
    public static function cleanPerms(mixed $p): array
    {
        $x = Perm::clean(array_map('strval', (array) $p));
        if (! $x) {
            return [];
        }
        $x[] = 'view_accounts';
        $x = array_values(array_unique($x));
        sort($x);

        return $x;
    }

    /** Sign someone out everywhere: their sessions go, and any session older than now is refused. */
    private static function signOutEverywhere(string $id): void
    {
        DB::table('users')->where('id', $id)->update(['force_logout_at' => now()->format('Y-m-d H:i:s.u')]);
        DB::table('sessions')->where('user_id', $id)->delete();
    }

    /** The power admin's login is not managed from the Users page (only from the server: php artisan site:poweradmin). */
    private static function notPower(string $id): void
    {
        if (DB::table('users')->where('id', $id)->value('is_poweradmin')) {
            throw RpcError::notAllowed('this login cannot be changed here');
        }
    }

    /** public.admin_list_users() */
    public function list(array $p, User $u): array
    {
        self::admin($u);

        return DB::table('users')->where('is_poweradmin', false)->orderByRaw('archived_at is not null')->orderByDesc('active')->orderByRaw("role = 'admin' desc")->orderBy('full_name')
            ->get(['id', 'email', 'full_name', 'role', 'active', 'permissions', 'last_sign_in_at', 'created_at', 'archived_at'])
            ->map(fn ($r) => ['user_id' => $r->id, 'email' => $r->email, 'full_name' => $r->full_name, 'role' => $r->role, 'active' => (bool) $r->active,
                'permissions' => json_decode($r->permissions, true) ?? [], 'last_sign_in_at' => $r->last_sign_in_at, 'created_at' => $r->created_at,
                'archived_at' => $r->archived_at])->all();
    }

    /** public.admin_create_user(p_email, p_name, p_password, p_role, p_perms) */
    public function create(array $p, User $u): string
    {
        self::admin($u);
        $email = mb_strtolower(trim((string) ($p['p_email'] ?? '')));
        if (! preg_match('/^[^@\s]+@[^@\s]+\.[^@\s]+$/', $email)) {
            throw RpcError::bad('enter a valid email');
        }
        if (strlen((string) ($p['p_password'] ?? '')) < 8) {
            throw RpcError::bad('password must be at least 8 characters');
        }
        $name = trim((string) ($p['p_name'] ?? ''));
        if ($name === '') {
            throw RpcError::bad("enter the person's name");
        }
        $role = $p['p_role'] ?? '';
        if (! in_array($role, ['admin', 'staff'], true)) {
            throw RpcError::bad('bad role');
        }
        if (DB::table('users')->where('email', $email)->exists()) {
            throw new RpcError('23505', 'that email already has a login');
        }
        $new = User::create(['email' => $email, 'password' => (string) $p['p_password'], 'full_name' => $name, 'role' => $role, 'active' => true,
            'permissions' => $role === 'admin' ? [] : self::cleanPerms($p['p_perms'] ?? [])]);

        return $new->id;
    }

    /** public.admin_update_user(p_user, p_name, p_role, p_active, p_perms) */
    public function update(array $p, User $u): ?bool
    {
        self::admin($u);
        $name = trim((string) ($p['p_name'] ?? ''));
        if ($name === '') {
            throw RpcError::bad("enter the person's name");
        }
        $role = $p['p_role'] ?? '';
        if (! in_array($role, ['admin', 'staff'], true)) {
            throw RpcError::bad('bad role');
        }
        $id = (string) ($p['p_user'] ?? '');
        self::notPower($id);
        $active = (bool) ($p['p_active'] ?? false);
        if ($id === $u->id && ($role !== 'admin' || ! $active)) {
            throw RpcError::bad('you cannot remove your own admin access or switch yourself off');
        }
        $row = DB::table('users')->where('id', $id)->first();
        if (! $row) {
            throw RpcError::bad('user not found');
        }
        if ($active && $row->archived_at !== null) {
            throw RpcError::bad('this user is removed; restore them first');
        }
        DB::table('users')->where('id', $id)->update(['full_name' => $name, 'role' => $role, 'active' => $active,
            'permissions' => json_encode($role === 'admin' ? [] : self::cleanPerms($p['p_perms'] ?? []))]);
        if (! $active) {
            DB::table('sessions')->where('user_id', $id)->delete();
        }

        return null;
    }

    /** public.admin_set_password(p_user, p_password): others are signed out everywhere. */
    public function password(array $p, User $u): ?bool
    {
        self::admin($u);
        if (strlen((string) ($p['p_password'] ?? '')) < 8) {
            throw RpcError::bad('password must be at least 8 characters');
        }
        self::notPower((string) ($p['p_user'] ?? ''));
        $target = User::find((string) ($p['p_user'] ?? ''));
        if (! $target) {
            throw RpcError::bad('user not found');
        }
        $target->forceFill(['password' => (string) $p['p_password']])->save();
        if ($target->id !== $u->id) {
            self::signOutEverywhere($target->id);
        }
        Audit::log('password_reset', $target->full_name, null, []);

        return null;
    }

    /** public.admin_sign_out_user(p_user) */
    public function signOut(array $p, User $u): ?bool
    {
        self::admin($u);
        $id = (string) ($p['p_user'] ?? '');
        self::notPower($id);
        if ($id === $u->id) {
            throw RpcError::bad('use Sign out to sign yourself out');
        }
        $name = DB::table('users')->where('id', $id)->value('full_name');
        if ($name === null) {
            throw RpcError::bad('user not found');
        }
        self::signOutEverywhere($id);
        Audit::log('signed_out', $name, null, []);

        return null;
    }

    /** public.admin_archive_user(p_user, p_archive): remove (login off, signed out, books closed, future lists cleared) or restore. */
    public function archive(array $p, User $u): array
    {
        self::admin($u);
        $id = (string) ($p['p_user'] ?? '');
        self::notPower($id);
        if ($id === $u->id) {
            throw RpcError::bad('you cannot remove yourself');
        }
        $row = DB::table('users')->where('id', $id)->first();
        if (! $row) {
            throw RpcError::bad('user not found');
        }
        $books = 0;
        $lists = 0;
        if ($p['p_archive'] ?? false) {
            if ($row->role === 'admin' && ! DB::table('users')->where('role', 'admin')->where('active', 1)->whereNull('archived_at')->where('id', '<>', $id)->exists()) {
                throw RpcError::bad('this is the last admin; make someone else admin first');
            }
            DB::table('users')->where('id', $id)->update(['archived_at' => now()->format('Y-m-d H:i:s.u'), 'active' => false]);
            self::signOutEverywhere($id);
            $books = DB::table('receipt_books')->where('user_id', $id)->whereNull('closed_at')->update(['closed_at' => now()->format('Y-m-d H:i:s.u')]);
            $lists = DB::table('collection_assignments')->where('user_id', $id)->where('day', '>=', now()->toDateString())->delete();
            Audit::log('user_archived', $row->full_name, null, ['books_closed' => $books, 'list_entries_removed' => $lists]);
        } else {
            DB::table('users')->where('id', $id)->update(['archived_at' => null]);
            Audit::log('user_restored', $row->full_name, null, []);
        }

        return ['books_closed' => $books, 'list_entries_removed' => $lists];
    }
}

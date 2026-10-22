<?php

namespace App\AutoDeal\Http\Controllers;

use App\AutoDeal\Models\ActivityLog;
use App\AutoDeal\Models\Branch;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Who uses Auto Deal. Logins, passwords and the "Auto Deal" permission are managed in SSS (Users); here the owner only
 * limits a staff member to one yard.
 */
class AccountController extends Controller
{
    public function show(): Response
    {
        $owner = $this->isDealerOwner();
        $yards = DB::table('ad_branch_user')->pluck('branch_id', 'user_id');

        return Inertia::render('Account/Index', [
            'users' => $owner ? User::where('active', true)->whereNull('archived_at')
                ->where(fn ($q) => $q->where('role', 'admin')->orWhereJsonContains('permissions', 'autodeal'))
                ->orderByRaw("role = 'admin' desc")->orderBy('full_name')->get(['id', 'full_name', 'email', 'role'])
                ->map(fn (User $u) => ['id' => $u->id, 'name' => $u->full_name, 'email' => $u->email, 'role' => $u->isAdmin() ? 'owner' : 'staff',
                    'branch_id' => $u->isAdmin() ? null : ($yards[$u->id] ?? null)]) : [],
            'allBranches' => $owner ? Branch::orderBy('name')->get(['id', 'name', 'is_active']) : [],
        ]);
    }

    /** Owner: limit a staff member to one yard (empty = every yard). */
    public function updateUser(Request $request, User $user): RedirectResponse
    {
        abort_if($user->isAdmin() || ! $user->canUseDealer(), 404);
        $data = $request->validate(['branch_id' => ['nullable', 'integer', Rule::exists('ad_branches', 'id')]]);
        $old = DB::table('ad_branch_user')->where('user_id', $user->id)->value('branch_id');
        if (empty($data['branch_id'])) {
            DB::table('ad_branch_user')->where('user_id', $user->id)->delete();
        } else {
            DB::table('ad_branch_user')->updateOrInsert(['user_id' => $user->id], ['branch_id' => $data['branch_id'], 'updated_at' => now(), 'created_at' => now()]);
        }
        $name = fn ($id) => $id ? Branch::find($id)?->name : 'every yard';
        if ((int) $old !== (int) ($data['branch_id'] ?? 0)) {
            ActivityLog::record('staff.yard', null, "{$user->full_name}: {$name($old)} → {$name($data['branch_id'] ?? null)}");
        }

        return back()->with('success', 'Saved.');
    }
}

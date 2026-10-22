<?php

namespace App\AutoDeal\Http\Controllers;

use App\AutoDeal\Models\ActivityLog;
use App\AutoDeal\Models\Branch;
use App\AutoDeal\Models\Vehicle;
use App\AutoDeal\Models\VehicleTransfer;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/** Owner-only management of yards / showrooms (full CRUD). */
class BranchController extends Controller
{
    public function index(): Response
    {
        $branches = Branch::query()
            ->withCount([
                'vehicles as stock_count' => fn ($q) => $q->whereIn('status', Vehicle::SELLABLE),
                'vehicles as sold_count' => fn ($q) => $q->where('status', 'sold'),
                'vehicles as total_count' => fn ($q) => $q->withTrashed(),
            ])
            ->withSum(['vehicles as stock_value' => fn ($q) => $q->whereIn('status', Vehicle::SELLABLE)], 'expected_price')
            ->orderByDesc('is_active')->orderBy('name')
            ->get();

        $staff = DB::table('ad_branch_user')->selectRaw('branch_id, COUNT(*) as n')->groupBy('branch_id')->pluck('n', 'branch_id');

        return Inertia::render('Branches/Index', [
            'branches' => $branches->map(fn (Branch $b) => [
                ...$b->only('id', 'name', 'address', 'phone', 'is_active', 'stock_count', 'sold_count', 'created_at'),
                'stock_value' => (float) $b->stock_value,
                'staff_count' => (int) ($staff[$b->id] ?? 0),
                // Only a yard that never held a vehicle can be deleted; otherwise it is closed instead.
                'deletable' => $b->total_count === 0 && ! $this->hasTransfers($b),
            ]),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $branch = Branch::create($this->validated($request));
        ActivityLog::record('branch.created', $branch, "Added yard {$branch->name}");

        return back()->with('success', "Yard “{$branch->name}” added.");
    }

    public function update(Request $request, Branch $branch): RedirectResponse
    {
        $data = $this->validated($request, $branch);

        if (! $data['is_active'] && $branch->is_active) {
            if ($branch->vehicles()->whereIn('status', Vehicle::SELLABLE)->exists()) {
                return back()->with('error', 'Transfer this yard’s unsold vehicles before closing it.');
            }
            if (Branch::active()->whereKeyNot($branch->id)->doesntExist()) {
                return back()->with('error', 'At least one yard must stay open.');
            }
        }

        $before = $branch->getRawOriginal();
        $branch->update($data);
        if ($changes = ActivityLog::diff($before, $branch)) {
            ActivityLog::record('branch.updated', $branch, "Updated yard {$branch->name}", $changes);
        }

        return back()->with('success', 'Yard saved.');
    }

    public function destroy(Branch $branch): RedirectResponse
    {
        if ($branch->vehicles()->withTrashed()->exists() || $this->hasTransfers($branch)) {
            return back()->with('error', 'This yard has vehicle history, so it can’t be deleted. Close it instead – its records stay in reports.');
        }
        if ($branch->is_active && Branch::active()->whereKeyNot($branch->id)->doesntExist()) {
            return back()->with('error', 'At least one yard must stay open.');
        }

        $branch->delete(); // staff limited to this yard fall back to "all yards" (their ad_branch_user rows go with it)
        ActivityLog::record('branch.deleted', null, "Deleted yard {$branch->name}");

        return back()->with('success', "Yard “{$branch->name}” deleted.");
    }

    private function hasTransfers(Branch $branch): bool
    {
        return VehicleTransfer::where('from_branch_id', $branch->id)->orWhere('to_branch_id', $branch->id)->exists();
    }

    private function validated(Request $request, ?Branch $branch = null): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:80', Rule::unique('ad_branches')->ignore($branch?->id)],
            'address' => ['nullable', 'string', 'max:255'],
            'phone' => ['nullable', 'regex:/^[6-9]\d{9}$/'],
            'is_active' => ['boolean'],
        ], ['phone.regex' => 'Enter a 10-digit mobile number.', 'name.unique' => 'A yard with this name already exists.'])
            + ['is_active' => true];
    }
}

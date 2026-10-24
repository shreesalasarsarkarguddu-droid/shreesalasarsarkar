<?php

namespace App\AutoDeal\Http\Middleware;

use App\AutoDeal\Models\Branch;
use App\AutoDeal\Support\Module;
use App\AutoDeal\Support\Shop;
use Illuminate\Http\Request;
use Inertia\Middleware;

/** Inertia for Auto Deal's screens (resources/autodeal), built into public/autodeal-build. */
class HandleInertiaRequests extends Middleware
{
    protected $rootView = 'autodeal::app';

    public function version(Request $request): ?string
    {
        $manifest = public_path('autodeal-build/manifest.json');

        return is_file($manifest) ? hash_file('xxh128', $manifest) : null;
    }

    /** @return array<string, mixed> */
    public function share(Request $request): array
    {
        $user = $request->user();

        return [
            ...parent::share($request),
            'auth' => [
                // the SSS login: an SSS admin is the owner here, everyone else with Auto Deal is staff
                'user' => $user ? ['id' => $user->id, 'name' => $user->full_name, 'email' => $user->email,
                    'role' => $user->isDealerOwner() ? 'owner' : 'staff', 'branch_id' => $user->dealerBranch()] : null,
                'can' => [
                    'owner' => (bool) $user?->isDealerOwner(),
                ],
            ],
            'app' => [
                'name' => Shop::get()['name'],
                'phone' => Shop::get()['phone'],
                'home' => Module::homeUrl(), // back to the SSS screens
            ],
            // Branch UI only appears once a dealer has more than one active yard.
            'branches' => fn () => $user ? Branch::options() : [],
            'flash' => [
                'success' => fn () => $request->session()->get('success'),
                'error' => fn () => $request->session()->get('error'),
            ],
        ];
    }
}

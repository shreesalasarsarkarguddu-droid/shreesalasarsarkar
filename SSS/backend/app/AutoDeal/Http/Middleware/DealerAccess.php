<?php

namespace App\AutoDeal\Http\Middleware;

use App\AutoDeal\Support\Module;
use Closure;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

/**
 * Auto Deal uses the SSS login (the same session cookie). Not signed in: off to the SSS sign-in page.
 * Signed in without the "Auto Deal" permission: 403.
 */
class DealerAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (! $user) {
            return $request->header('X-Inertia') ? Inertia::location(Module::loginUrl()) : redirect()->away(Module::loginUrl());
        }
        abort_unless($user->active && $user->canUseDealer(), 403, 'Your login does not have Auto Deal. Ask the admin to give you the "Auto Deal" permission.');

        return $next($request);
    }
}

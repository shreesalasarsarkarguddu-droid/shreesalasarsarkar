<?php

namespace App\Http\Middleware;

use App\Support\SiteSwitch;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * While the site is off: every page (the screens, Auto Deal, the public catalogue) shows "site closed" and the API answers
 * 503, for admins too. Only /power (the switch) and a signed-in power admin get through.
 */
class SiteOff
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! SiteSwitch::isOff() || $request->is('power', 'power/*') || Auth::guard('sanctum')->user()?->is_poweradmin) {
            return $next($request);
        }
        if ($request->is('api/*', 'sanctum/*') || $request->expectsJson() && ! $request->header('X-Inertia')) {
            return response()->json(['ok' => false, 'error' => SiteSwitch::message(), 'site_off' => true], 503);
        }
        if ($request->header('X-Inertia')) {
            // Auto Deal: a full page load, which then shows the closed page
            return response('', 409)->header('X-Inertia-Location', $request->fullUrl());
        }

        return response()->view('site-off', ['message' => SiteSwitch::message()], 503)->header('Retry-After', '600');
    }
}

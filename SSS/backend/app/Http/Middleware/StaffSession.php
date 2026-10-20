<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * A signed-in person must still be an active, not removed staff member, and the admin must not have signed
 * them out after this login (force_logout_at later than the time this session signed in).
 */
class StaffSession
{
    public function handle(Request $request, Closure $next)
    {
        $u = $request->user();
        if ($u) {
            $loginAt = $request->hasSession() ? (float) $request->session()->get('login_at', 0) : PHP_FLOAT_MAX;
            $forced = $u->force_logout_at?->getTimestamp() ?? 0;
            if (! $u->active || $u->archived_at !== null || ($forced && $loginAt < $forced)) {
                Auth::guard('web')->logout();
                if ($request->hasSession()) {
                    $request->session()->invalidate();
                    $request->session()->regenerateToken();
                }

                return response()->json(['ok' => false, 'error' => 'Your login is off or you were signed out. Sign in again.'], 401);
            }
        }

        return $next($request);
    }
}

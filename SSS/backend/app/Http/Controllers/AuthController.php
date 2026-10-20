<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;

/** Sign in / out with email + password (session cookie, Sanctum SPA). */
class AuthController extends Controller
{
    public function login(Request $request)
    {
        $data = $request->validate([
            'email' => ['required', 'email', 'max:200'],
            'password' => ['required', 'string', 'max:200'],
        ]);
        $key = 'login:'.strtolower($data['email']).'|'.$request->ip();
        if (RateLimiter::tooManyAttempts($key, 8)) {
            return response()->json(['ok' => false, 'error' => 'Too many tries. Wait a minute and try again.'], 429);
        }
        if (! Auth::guard('web')->attempt(['email' => strtolower(trim($data['email'])), 'password' => $data['password']])) {
            RateLimiter::hit($key, 60);

            return response()->json(['ok' => false, 'error' => 'Wrong email or password.'], 422);
        }
        $u = Auth::guard('web')->user();
        if (! $u->active || $u->archived_at !== null) {
            Auth::guard('web')->logout();

            return response()->json(['ok' => false, 'error' => 'This login is switched off. Ask the admin.'], 403);
        }
        RateLimiter::clear($key);
        $request->session()->regenerate();
        $request->session()->put('login_at', microtime(true));
        $u->forceFill(['last_sign_in_at' => now()])->save();

        return response()->json(['ok' => true, 'user' => $u->access()]);
    }

    public function logout(Request $request)
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['ok' => true]);
    }

    /** POST /api/password { current, next } — change your own password (the current one is checked first). */
    public function password(Request $request)
    {
        $u = $request->user();
        $current = (string) $request->input('current');
        $next = (string) $request->input('next');
        if (strlen($next) < 8 || strlen($next) > 200) {
            return response()->json(['ok' => false, 'error' => 'New password must be at least 8 characters.'], 422);
        }
        if (! Hash::check($current, $u->password)) {
            return response()->json(['ok' => false, 'error' => 'Current password is incorrect.'], 422);
        }
        $u->forceFill(['password' => $next])->save();

        return response()->json(['ok' => true]);
    }

    public function me(Request $request)
    {
        return response()->json(['user' => $request->user()->access()]);
    }
}

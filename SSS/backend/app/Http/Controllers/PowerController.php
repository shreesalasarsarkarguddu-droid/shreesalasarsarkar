<?php

namespace App\Http\Controllers;

use App\Support\SiteSwitch;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;

/** /power: the power admin signs in here and switches the whole site on or off (works while the site is off). */
class PowerController extends Controller
{
    public function show(Request $request)
    {
        $u = Auth::guard('web')->user();

        return view('power', [
            'power' => (bool) $u?->is_poweradmin,
            'name' => $u?->full_name,
            'off' => SiteSwitch::isOff(),
            'message' => SiteSwitch::isOff() ? SiteSwitch::message() : '',
            'changedAt' => SiteSwitch::changedAt(),
        ]);
    }

    public function login(Request $request)
    {
        $data = $request->validate(['email' => ['required', 'email', 'max:200'], 'password' => ['required', 'string', 'max:200']]);
        $key = 'power:'.$request->ip();
        if (RateLimiter::tooManyAttempts($key, 5)) {
            return back()->withErrors(['email' => 'Too many tries. Wait a minute.']);
        }
        $ok = Auth::guard('web')->attempt(['email' => mb_strtolower(trim($data['email'])), 'password' => $data['password']]);
        $u = Auth::guard('web')->user();
        if (! $ok || ! $u->is_poweradmin || ! $u->active) {
            if ($ok) {
                Auth::guard('web')->logout();
            }
            RateLimiter::hit($key, 60);

            return back()->withErrors(['email' => 'Wrong email or password, or this login is not the power admin.'])->onlyInput('email');
        }
        RateLimiter::clear($key);
        $request->session()->regenerate();
        $request->session()->put('login_at', microtime(true));

        return redirect('/power');
    }

    public function toggle(Request $request)
    {
        $u = Auth::guard('web')->user();
        abort_unless($u?->is_poweradmin, 403);
        $data = $request->validate(['off' => ['required', 'boolean'], 'message' => ['nullable', 'string', 'max:500']]);
        SiteSwitch::set((bool) $data['off'], $data['message'] ?? null, $u);

        return redirect('/power')->with('status', $data['off'] ? 'The site is OFF now.' : 'The site is ON now.');
    }

    public function logout(Request $request)
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect('/power');
    }
}

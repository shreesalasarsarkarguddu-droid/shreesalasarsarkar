<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Site power · Shree Salasar Sarkar</title>
    <link rel="icon" href="/favicon.ico">
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f1f5f9; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; padding: 16px; }
        .card { max-width: 440px; width: 100%; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
        h1 { font-size: 20px; margin: 0 0 4px; }
        .muted { color: #64748b; font-size: 14px; margin: 0 0 16px; }
        label { display: block; font-size: 14px; font-weight: 600; margin: 12px 0 4px; }
        input, textarea { width: 100%; font: inherit; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 10px; }
        button { width: 100%; font: inherit; font-weight: 700; padding: 12px; border: 0; border-radius: 12px; margin-top: 16px; cursor: pointer; color: #fff; }
        .blue { background: #1d4ed8; } .red { background: #b91c1c; } .green { background: #047857; } .link { background: none; color: #475569; font-weight: 500; margin-top: 8px; }
        .status { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 12px; font-weight: 700; }
        .on { background: #ecfdf5; color: #065f46; } .off { background: #fef2f2; color: #991b1b; }
        .dot { width: 12px; height: 12px; border-radius: 50%; } .on .dot { background: #10b981; } .off .dot { background: #ef4444; }
        .err { background: #fef2f2; color: #991b1b; padding: 10px 12px; border-radius: 10px; font-size: 14px; margin-top: 12px; }
        .ok { background: #ecfdf5; color: #065f46; padding: 10px 12px; border-radius: 10px; font-size: 14px; margin-bottom: 12px; }
    </style>
</head>
<body>
<div class="card">
    <h1>Site power</h1>
    @if (! $power)
        <p class="muted">Only the power admin can sign in here.</p>
        <form method="post" action="/power/login">
            @csrf
            <label for="email">Email</label>
            <input id="email" name="email" type="email" value="{{ old('email') }}" autocomplete="username" required>
            <label for="password">Password</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required>
            @error('email') <div class="err">{{ $message }}</div> @enderror
            <button class="blue" type="submit">Sign in</button>
        </form>
    @else
        <p class="muted">Signed in as {{ $name }} (power admin). This switch is for the whole site: the screens, the API, Auto Deal and the public catalogue.</p>
        @if (session('status')) <div class="ok">{{ session('status') }}</div> @endif
        <div class="status {{ $off ? 'off' : 'on' }}">
            <span class="dot"></span>
            {{ $off ? 'Site is OFF — nobody can open it (admins too)' : 'Site is ON — working normally' }}
        </div>
        @if ($changedAt) <p class="muted" style="margin-top:8px">Last changed {{ \Illuminate\Support\Carbon::parse($changedAt)->format('d/m/Y h:i A') }}</p> @endif
        <form method="post" action="/power/toggle">
            @csrf
            @if ($off)
                <input type="hidden" name="off" value="0">
                <button class="green" type="submit">Turn the site ON</button>
            @else
                <input type="hidden" name="off" value="1">
                <label for="message">Message for everyone (optional)</label>
                <textarea id="message" name="message" rows="3" maxlength="500" placeholder="{{ \App\Support\SiteSwitch::DEFAULT_MESSAGE }}">{{ old('message') }}</textarea>
                <button class="red" type="submit" onclick="return confirm('Turn the whole site OFF? Nobody (admins too) can use it until you turn it on again.')">Turn the site OFF</button>
            @endif
        </form>
        <form method="post" action="/power/logout">
            @csrf
            <button class="link" type="submit">Sign out</button>
        </form>
    @endif
</div>
</body>
</html>

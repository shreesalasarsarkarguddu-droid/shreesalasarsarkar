<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#0f172a">
    @isset($meta)
        {{-- Server-rendered so WhatsApp / Facebook link previews show the vehicle --}}
        <meta name="description" content="{{ $meta['description'] }}">
        <meta property="og:type" content="website">
        <meta property="og:title" content="{{ $meta['title'] }}">
        <meta property="og:description" content="{{ $meta['description'] }}">
        <meta property="og:image" content="{{ $meta['image'] }}">
        <meta property="og:url" content="{{ url()->current() }}">
        <meta name="twitter:card" content="summary_large_image">
    @else
        <meta name="robots" content="noindex, nofollow">
    @endisset
    <link rel="icon" href="/favicon.ico" sizes="48x48">
    <link rel="icon" href="/icons/icon-192.png" type="image/png">
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
    <title inertia>{{ $meta['title'] ?? 'Auto Deal' }}</title>
    @routes
    {{-- Auto Deal's own Vite build (public/autodeal-build), separate from the SSS screens --}}
    @php(\Illuminate\Support\Facades\Vite::useHotFile(public_path('autodeal.hot'))->useBuildDirectory('autodeal-build'))
    @viteReactRefresh
    @vite(['resources/autodeal/js/app.jsx', "resources/autodeal/js/Pages/{$page['component']}.jsx"])
    @inertiaHead
</head>
<body class="bg-slate-100 text-slate-900 antialiased">
    @inertia
</body>
</html>

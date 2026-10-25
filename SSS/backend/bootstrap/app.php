<?php

use App\Http\Middleware\IsoTimes;
use App\Http\Middleware\SiteOff;
use App\Http\Middleware\StaffSession;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // the React app signs in with the session cookie (Sanctum SPA): sessions + CSRF on the API
        $middleware->statefulApi();
        $middleware->api(append: [SiteOff::class, StaffSession::class, IsoTimes::class]);
        // the site switch (power admin): pages too, Auto Deal and the public catalogue included
        $middleware->web(append: [SiteOff::class]);
        // not signed in: the React app shows its own sign-in page (no Laravel "login" route)
        $middleware->redirectGuestsTo('/login');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // the API always answers JSON in the { ok: false, error } shape the screens expect
        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if ($request->is('api/*')) {
                return response()->json(['ok' => false, 'error' => 'Sign in again.'], 401);
            }
        });
        $exceptions->render(function (HttpExceptionInterface $e, Request $request) {
            if ($request->is('api/*')) {
                $status = $e->getStatusCode();
                $msg = match ($status) {
                    404 => 'Not found.',
                    419 => 'The page was open too long. Reload and try again.',
                    429 => 'Too many requests. Wait a moment.',
                    default => $e->getMessage() ?: 'Request refused.',
                };

                return response()->json(['ok' => false, 'error' => $msg], $status);
            }
        });
    })->create();

<?php

use App\Http\Controllers\PowerController;
use Illuminate\Support\Facades\Route;

// the whole site on / off (power admin only; this page works while the site is off)
Route::get('/power', [PowerController::class, 'show']);
Route::post('/power/login', [PowerController::class, 'login'])->middleware('throttle:20,1');
Route::post('/power/toggle', [PowerController::class, 'toggle']);
Route::post('/power/logout', [PowerController::class, 'logout']);

// The React app (built into public/app by `npm run build` in SSS/frontend): every non-API page is its index.html.
Route::get('/{any?}', function () {
    $index = public_path('app/index.html');
    abort_unless(is_file($index), 404, 'Build the frontend first (SSS/frontend: npm run build).');

    return response()->file($index, ['Cache-Control' => 'no-cache']);
})->where('any', '^(?!api|sanctum|up|autodeal|storage|power).*$');

<?php

use Illuminate\Support\Facades\Route;

// The React app (built into public/app by `npm run build` in SSS/frontend): every non-API page is its index.html.
Route::get('/{any?}', function () {
    $index = public_path('app/index.html');
    abort_unless(is_file($index), 404, 'Build the frontend first (SSS/frontend: npm run build).');

    return response()->file($index, ['Cache-Control' => 'no-cache']);
})->where('any', '^(?!api|sanctum|up|autodeal|storage).*$');

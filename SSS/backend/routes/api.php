<?php

use App\Http\Controllers\AccountsController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\LoansController;
use App\Http\Controllers\PaymentsController;
use App\Http\Controllers\ReportsController;
use App\Http\Controllers\RpcController;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

// The browser first gets the CSRF cookie from /sanctum/csrf-cookie, then signs in here (session cookie).
Route::post('/login', [AuthController::class, 'login']);

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/me', [AuthController::class, 'me']);
    Route::post('/password', [AuthController::class, 'password']);

    // the old database functions the screens call by name
    Route::post('/rpc/{name}', [RpcController::class, 'call'])->where('name', '[a-z_]+');

    // open receipt books of the zones (people's receipt books form)
    Route::get('/receipt-series/open', function () {
        \App\Support\Perm::need('cash');

        return response()->json(DB::table('receipt_series')->whereNull('closed_at')->orderBy('id')->get(['id', 'code']));
    });

    // active zone names (loan form)
    Route::get('/zones/names', fn () => response()->json(DB::table('zones')->where('active', 1)->orderBy('name')->pluck('name')));

    // accounts
    Route::get('/accounts', [AccountsController::class, 'index']);
    Route::get('/legacy-accounts/{sno}', [AccountsController::class, 'legacy']);
    Route::get('/loans/{id}', [AccountsController::class, 'loan']);
    Route::post('/loans', [LoansController::class, 'store']);

    // reports
    Route::get('/reports/due', [ReportsController::class, 'due']);
    Route::get('/reports/day-book', [ReportsController::class, 'dayBook']);
    Route::get('/reports/seized', [ReportsController::class, 'seized']);
    Route::get('/dashboard', [ReportsController::class, 'dashboard']);
    Route::get('/staff-performance', [ReportsController::class, 'staff']);
    Route::get('/assignments', [ReportsController::class, 'assignments']);

    // admin
    Route::get('/activity', [\App\Http\Controllers\AdminController::class, 'activity']);
    Route::get('/notification-log', [\App\Http\Controllers\AdminController::class, 'notificationLog']);
    Route::get('/backup', [\App\Http\Controllers\AdminController::class, 'backup']);

    // collecting payments
    Route::get('/payments/pending', [PaymentsController::class, 'pending']);
    Route::get('/ledger/{source}/{ref}', [PaymentsController::class, 'ledger']);
    Route::get('/receipt-hint', [PaymentsController::class, 'hint']);
    Route::post('/payments', [PaymentsController::class, 'store']);
});

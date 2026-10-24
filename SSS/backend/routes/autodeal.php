<?php

// Auto Deal: loaded by App\AutoDeal\AutoDealServiceProvider under /autodeal with the "web" middleware and route names
// "autodeal.*". Signing in is done by SSS (same session cookie); there is no login page here.

use App\AutoDeal\Http\Controllers\AccountController;
use App\AutoDeal\Http\Controllers\ActivityController;
use App\AutoDeal\Http\Controllers\BranchController;
use App\AutoDeal\Http\Controllers\CatalogueController;
use App\AutoDeal\Http\Controllers\DocumentController;
use App\AutoDeal\Http\Controllers\ExportController;
use App\AutoDeal\Http\Controllers\PriceHintController;
use App\AutoDeal\Http\Controllers\ReceiptController;
use App\AutoDeal\Http\Controllers\ReportController;
use App\AutoDeal\Http\Controllers\SaleController;
use App\AutoDeal\Http\Controllers\ShopController;
use App\AutoDeal\Http\Controllers\VehicleController;
use App\AutoDeal\Http\Middleware\DealerAccess;
use App\AutoDeal\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\StaffSession;
use Illuminate\Support\Facades\Route;

Route::middleware(HandleInertiaRequests::class)->group(function () {
    // Public stock catalogue for customers (no login).
    Route::middleware('throttle:120,1')->group(function () {
        Route::get('catalogue', [CatalogueController::class, 'index'])->name('catalogue.index');
        Route::get('catalogue/{vehicle}', [CatalogueController::class, 'show'])->name('catalogue.show');
    });

    Route::middleware([DealerAccess::class, StaffSession::class])->group(function () {
        Route::redirect('/', '/autodeal/vehicles');

        // ---- Everyone with Auto Deal (owner + staff; staff limited to their yard) ----
        Route::resource('vehicles', VehicleController::class)->except('destroy');
        Route::get('price-hint', PriceHintController::class)->middleware('throttle:60,1')->name('price-hint');
        Route::patch('vehicles/{vehicle}/status', [VehicleController::class, 'updateStatus'])->name('vehicles.status');
        Route::post('vehicles/{vehicle}/transfer', [VehicleController::class, 'transfer'])->name('vehicles.transfer');
        Route::post('vehicles/{vehicle}/photos', [VehicleController::class, 'addPhotos'])->name('vehicles.photos.store');

        Route::get('sales', [SaleController::class, 'index'])->name('sales.index');
        Route::post('vehicles/{vehicle}/sale', [SaleController::class, 'store'])->name('sales.store');
        Route::post('sales/{sale}/payments', [SaleController::class, 'recordPayment'])->name('sales.payments.store');

        Route::get('vehicles/{vehicle}/receipt', [ReceiptController::class, 'purchase'])->name('receipts.purchase');
        Route::get('sales/{sale}/receipt', [ReceiptController::class, 'sale'])->name('receipts.sale');

        Route::get('files/seller/{seller}', [DocumentController::class, 'sellerProof'])->name('files.seller');
        Route::get('files/buyer/{buyer}', [DocumentController::class, 'buyerProof'])->name('files.buyer');
        Route::get('files/sale-document/{document}', [DocumentController::class, 'saleDocument'])->name('files.sale-document');

        Route::get('account', [AccountController::class, 'show'])->name('account');

        // ---- Owner (SSS admin) only: money, deletions, staff yards, data ----
        Route::middleware('can:autodeal-owner')->group(function () {
            Route::delete('vehicles/{vehicle}', [VehicleController::class, 'destroy'])->name('vehicles.destroy');
            Route::post('vehicles/{vehicle}/restore', [VehicleController::class, 'restore'])->withTrashed()->name('vehicles.restore');
            Route::post('vehicles/{vehicle}/listing', [VehicleController::class, 'toggleListing'])->name('vehicles.listing');
            Route::delete('vehicles/{vehicle}/photos/{photo}', [VehicleController::class, 'destroyPhoto'])->name('vehicles.photos.destroy');
            Route::delete('sales/{sale}', [SaleController::class, 'destroy'])->name('sales.destroy');

            Route::get('reports', [ReportController::class, 'index'])->name('reports.index');
            Route::get('exports/{type}', ExportController::class)->name('exports');
            Route::get('activity', [ActivityController::class, 'index'])->name('activity.index');

            Route::put('account/users/{user}', [AccountController::class, 'updateUser'])->name('account.users.update');
            Route::get('shop', [ShopController::class, 'edit'])->name('shop.edit');
            Route::put('shop', [ShopController::class, 'update'])->name('shop.update');
            Route::get('branches', [BranchController::class, 'index'])->name('branches.index');
            Route::post('branches', [BranchController::class, 'store'])->name('branches.store');
            Route::put('branches/{branch}', [BranchController::class, 'update'])->name('branches.update');
            Route::delete('branches/{branch}', [BranchController::class, 'destroy'])->name('branches.destroy');
        });
    });
});

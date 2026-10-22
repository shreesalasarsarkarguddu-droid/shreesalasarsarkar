<?php

namespace App\AutoDeal;

use App\AutoDeal\Models\Branch;
use App\AutoDeal\Models\Buyer;
use App\AutoDeal\Models\Sale;
use App\AutoDeal\Models\SaleDocument;
use App\AutoDeal\Models\Seller;
use App\AutoDeal\Models\Vehicle;
use App\AutoDeal\Models\VehiclePhoto;
use App\AutoDeal\Support\Module;
use App\Models\User;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/** Auto Deal inside SSS: its tables, screens and routes (/autodeal). See App\AutoDeal\Support\Module. */
class AutoDealServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // tables exist even while the module is switched off, so nothing is lost
        $this->loadMigrationsFrom(database_path('migrations/autodeal'));
        $this->loadViewsFrom(resource_path('autodeal/views'), 'autodeal');
        // Inertia's page files are Auto Deal's (the only Inertia screens in SSS)
        config(['inertia.page_paths' => [resource_path('autodeal/js/Pages')], 'inertia.testing.page_paths' => [resource_path('autodeal/js/Pages')]]);

        // the activity log stores short names, not class names
        Relation::morphMap([
            'ad_vehicle' => Vehicle::class, 'ad_sale' => Sale::class, 'ad_branch' => Branch::class, 'ad_seller' => Seller::class,
            'ad_buyer' => Buyer::class, 'ad_sale_document' => SaleDocument::class, 'ad_vehicle_photo' => VehiclePhoto::class,
        ]);
        Gate::define('autodeal-owner', fn (User $user) => $user->isDealerOwner());

        if ($this->app->runningInConsole()) {
            $this->commands([Console\RemoveCommand::class]);
        }
        if (! Module::enabled()) {
            return;
        }
        Route::middleware('web')->prefix('autodeal')->name('autodeal.')->group(base_path('routes/autodeal.php'));

        // friendly pages for Auto Deal's screens; SSS's API keeps its JSON errors
        $this->callAfterResolving(ExceptionHandler::class, function ($handler) {
            if (! method_exists($handler, 'respondUsing')) {
                return; // the console's handler
            }
            $handler->respondUsing(function (Response $response, Throwable $e, Request $request) {
                if (! $request->is('autodeal', 'autodeal/*')) {
                    return $response;
                }
                $status = $response->getStatusCode();
                if ($status === 419) {
                    return back()->with('error', 'Your session expired. Please try again.');
                }
                if (! config('app.debug') && in_array($status, [403, 404, 500, 503], true)) {
                    return Inertia::render('Error', ['status' => $status, 'message' => $status === 403 ? $e->getMessage() : null, 'home' => Module::homeUrl()])
                        ->rootView('autodeal::app')->toResponse($request)->setStatusCode($status);
                }

                return $response;
            });
        });
    }
}

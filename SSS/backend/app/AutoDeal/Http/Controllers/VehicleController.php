<?php

namespace App\AutoDeal\Http\Controllers;

use App\AutoDeal\Http\Requests\StoreVehicleRequest;
use App\AutoDeal\Models\ActivityLog;
use App\AutoDeal\Models\Branch;
use App\AutoDeal\Models\Seller;
use App\AutoDeal\Models\Vehicle;
use App\AutoDeal\Models\VehiclePhoto;
use App\AutoDeal\Support\Uploads;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

class VehicleController extends Controller
{
    private const FILTERS = ['q', 'status', 'intake_type', 'company', 'year', 'min_price', 'max_price', 'branch', 'listed'];

    /** Stock dashboard: summary tiles + filterable, "load more" card list. */
    public function index(Request $request): Response|RedirectResponse
    {
        // "Load more" puts ?page=N in the URL; a full reload of that URL would show page N
        // alone, so restart the list from the top instead.
        if ($request->integer('page') > 1 && ! $request->header('X-Inertia-Partial-Data')) {
            return redirect()->route('autodeal.vehicles.index', $request->except('page'));
        }

        $user = $request->user();
        $filters = array_filter($request->only(self::FILTERS), fn ($v) => $v !== null && $v !== '');
        if (! $this->isDealerOwner()) {
            // Staff can't filter by cost.
            unset($filters['min_price'], $filters['max_price']);
        }

        // simplePaginate skips the COUNT(*) query, which matters on shared MySQL.
        $page = Vehicle::query()
            ->select(['id', 'intake_type', 'company_name', 'model_name', 'variant', 'model_year', 'color',
                'registration_number', 'chassis_number', 'engine_number', 'purchase_price', 'expected_price',
                'status', 'is_listed', 'branch_id', 'intake_date', 'created_by', 'deleted_at'])
            ->with(['coverPhoto:ad_vehicle_photos.id,ad_vehicle_photos.vehicle_id,file_path,photo_type', 'sale:id,vehicle_id,selling_price,balance_amount'])
            ->visibleTo($user)
            ->filter($filters)
            ->orderByDesc('intake_date')
            ->orderByDesc('id')
            ->simplePaginate(20)
            ->withQueryString();

        $items = collect($page->items())->map(fn (Vehicle $v) => $this->forViewer($v))->all();

        return Inertia::render('Vehicles/Index', [
            'filters' => (object) $filters,
            'vehicles' => Inertia::merge(fn () => $items),
            'nextPage' => $page->hasMorePages() ? $page->currentPage() + 1 : null,
            'summary' => Inertia::defer(fn () => $this->summary($user, $filters['branch'] ?? null)),
            'companies' => fn () => Vehicle::query()->visibleTo($user)->distinct()->orderBy('company_name')->pluck('company_name'),
        ]);
    }

    public function create(Request $request): Response
    {
        return Inertia::render('Vehicles/Form', [
            'vehicle' => null,
            'photoTypes' => VehiclePhoto::TYPES,
            'defaultBranch' => $request->user()->dealerBranch() ?? Branch::active()->orderBy('id')->value('id'),
        ]);
    }

    public function store(StoreVehicleRequest $request): RedirectResponse
    {
        $data = $request->validated();
        $user = $request->user();

        $vehicle = $this->withFileRollback(function (array &$stored) use ($request, $data, $user) {
            $seller = $this->upsertSeller($data['seller'], $request, $stored);

            $vehicle = Vehicle::create([
                ...Arr::except($data, ['seller', 'seller_id_proof', 'photos']),
                // Branch-bound staff always take stock into their own branch.
                'branch_id' => $user->dealerBranch() ?? $data['branch_id'] ?? Branch::active()->orderBy('id')->value('id'),
                'status' => 'in_stock',
                'seller_id' => $seller->id,
                'created_by' => $user->id,
            ]);
            $this->storePhotos($vehicle, $request->input('photos', []), $request, $stored);

            return $vehicle;
        });

        ActivityLog::record('vehicle.created', $vehicle, "Added {$vehicle->title} ({$vehicle->chassis_number})");

        return redirect()->route('autodeal.vehicles.show', $vehicle)->with('success', 'Vehicle added to stock.');
    }

    public function show(Request $request, Vehicle $vehicle): Response
    {
        $this->ensureVisible($vehicle);
        $vehicle->load(['seller', 'photos', 'branch:id,name', 'transfers.from:id,name', 'transfers.to:id,name', 'transfers.user:id,full_name',
            'sale.buyer', 'sale.documents:id,sale_id,label', 'sale.payments']);
        $owner = $this->isDealerOwner();

        return Inertia::render('Vehicles/Show', [
            'vehicle' => [
                ...$this->forViewer($vehicle)->toArray(),
                'title' => $vehicle->title,
                'days_in_stock' => (int) $vehicle->intake_date->diffInDays($vehicle->sale?->sale_date ?? now()),
                'profit' => $owner ? $vehicle->sale?->profit : null,
                'sellable' => $vehicle->isSellable(),
                'can_print_purchase' => $this->canPrintPurchase($vehicle),
            ],
            'statuses' => Vehicle::STATUSES,
            'photoTypes' => VehiclePhoto::TYPES,
            // Sale/payment events are logged against the vehicle too, so this is its full history.
            'activity' => $owner
                ? fn () => ActivityLog::with('user:id,full_name')->whereMorphedTo('subject', $vehicle)
                    ->latest('id')->limit(30)->get(['id', 'user_id', 'action', 'description', 'changes', 'created_at'])
                : [],
        ]);
    }

    public function edit(Vehicle $vehicle): Response
    {
        $this->ensureVisible($vehicle);
        $vehicle->load('seller');

        return Inertia::render('Vehicles/Form', [
            'vehicle' => $this->forViewer($vehicle),
            'photoTypes' => VehiclePhoto::TYPES,
            'defaultBranch' => $vehicle->branch_id,
        ]);
    }

    public function update(StoreVehicleRequest $request, Vehicle $vehicle): RedirectResponse
    {
        $this->ensureVisible($vehicle);
        // Branch moves go through transfer() so they're recorded; staff never change cost.
        $data = Arr::except($request->validated(), ['branch_id', ...($this->isDealerOwner() ? [] : Vehicle::OWNER_ONLY)]);
        $before = $vehicle->getRawOriginal();

        $this->withFileRollback(function (array &$stored) use ($request, $data, $vehicle) {
            $seller = $this->upsertSeller($data['seller'], $request, $stored, $vehicle->seller);
            $vehicle->update([
                ...Arr::except($data, ['seller', 'seller_id_proof', 'photos']),
                'seller_id' => $seller->id,
            ]);
            $this->storePhotos($vehicle, $request->input('photos', []), $request, $stored);
        });

        $changes = ActivityLog::diff($before, $vehicle);
        $photos = count($request->input('photos', []));
        if ($changes || $photos) {
            ActivityLog::record('vehicle.updated', $vehicle, "Edited {$vehicle->title}".($photos ? " (+{$photos} photos)" : ''), $changes);
        }

        return redirect()->route('autodeal.vehicles.show', $vehicle)->with('success', 'Vehicle updated.');
    }

    /** Quick status change: In Stock ⇄ Processing ⇄ Reserved ⇄ Archived (Sold is set by SaleController). */
    public function updateStatus(Request $request, Vehicle $vehicle): RedirectResponse
    {
        $this->ensureVisible($vehicle);
        $request->validate(['status' => ['required', Rule::in(['in_stock', 'processing', 'reserved', 'archived'])]]);

        if ($vehicle->status === 'sold') {
            return back()->with('error', 'Cancel the sale first to change the status of a sold vehicle.');
        }
        $old = $vehicle->status;
        $vehicle->update(['status' => $request->status]);
        ActivityLog::record('vehicle.status', $vehicle, "Status of {$vehicle->title}: {$old} → {$request->status}", ['status' => [$old, $request->status]]);

        return back()->with('success', 'Status updated.');
    }

    /** Owner: show/hide on the public catalogue. */
    public function toggleListing(Vehicle $vehicle): RedirectResponse
    {
        $vehicle->update(['is_listed' => ! $vehicle->is_listed]);
        ActivityLog::record('vehicle.listing', $vehicle, ($vehicle->is_listed ? 'Listed ' : 'Unlisted ')."{$vehicle->title} on the public catalogue");

        return back()->with('success', $vehicle->is_listed
            ? ($vehicle->isSellable() ? 'Now visible on the public catalogue.' : 'Listed – it will show on the catalogue while it is In Stock or Reserved.')
            : 'Removed from the public catalogue.');
    }

    /** Move a vehicle to another branch/yard, keeping a transfer record. */
    public function transfer(Request $request, Vehicle $vehicle): RedirectResponse
    {
        $this->ensureVisible($vehicle);
        $data = $request->validate([
            'to_branch_id' => ['required', 'integer', Rule::exists('ad_branches', 'id')->where('is_active', true), Rule::notIn([$vehicle->branch_id])],
            'transferred_on' => ['required', 'date', 'before_or_equal:today'],
            'note' => ['nullable', 'string', 'max:255'],
        ], ['to_branch_id.not_in' => 'The vehicle is already at that branch.']);

        if ($vehicle->status === 'sold') {
            return back()->with('error', 'Sold vehicles cannot be transferred.');
        }

        $from = $vehicle->branch;
        DB::transaction(function () use ($vehicle, $data, $request) {
            $vehicle->transfers()->create([...$data, 'from_branch_id' => $vehicle->branch_id, 'user_id' => $request->user()->id]);
            $vehicle->update(['branch_id' => $data['to_branch_id']]);
        });
        $to = Branch::find($data['to_branch_id']);
        ActivityLog::record('vehicle.transferred', $vehicle, "Moved {$vehicle->title} from {$from?->name} to {$to->name}");

        // Branch-bound staff no longer see the vehicle once it leaves their branch.
        return $vehicle->isVisibleTo($request->user())
            ? back()->with('success', "Transferred to {$to->name}.")
            : redirect()->route('autodeal.vehicles.index')->with('success', "Transferred to {$to->name}.");
    }

    public function addPhotos(Request $request, Vehicle $vehicle): RedirectResponse
    {
        $this->ensureVisible($vehicle);
        $remaining = config('autodeal.max_photos') - $vehicle->photos()->count();
        $request->validate([
            'photos' => ['required', 'array', 'max:'.max($remaining, 0)],
            'photos.*.file' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:'.config('autodeal.max_photo_kb')],
            'photos.*.type' => ['required', Rule::in(VehiclePhoto::TYPES)],
        ], ['photos.max' => "This vehicle can have {$remaining} more photo(s)."]);

        $this->withFileRollback(fn (array &$stored) => $this->storePhotos($vehicle, $request->input('photos'), $request, $stored));
        ActivityLog::record('vehicle.photos', $vehicle, 'Added '.count($request->input('photos')).' photo(s)');

        return back()->with('success', 'Photos uploaded.');
    }

    public function destroyPhoto(Vehicle $vehicle, VehiclePhoto $photo): RedirectResponse
    {
        abort_unless($photo->vehicle_id === $vehicle->id, 404);
        $photo->delete();
        Uploads::deletePhoto($photo->file_path);
        ActivityLog::record('vehicle.photos', $vehicle, "Removed a {$photo->photo_type} photo");

        return back()->with('success', 'Photo removed.');
    }

    /** Soft delete; sold vehicles are kept for the ledger. */
    public function destroy(Vehicle $vehicle): RedirectResponse
    {
        if ($vehicle->sale()->exists()) {
            return back()->with('error', 'Sold vehicles cannot be deleted. Archive it instead.');
        }
        $vehicle->update(['is_listed' => false]);
        $vehicle->delete();
        ActivityLog::record('vehicle.deleted', $vehicle, "Deleted {$vehicle->title} ({$vehicle->chassis_number})");

        return redirect()->route('autodeal.vehicles.index')->with('success', 'Vehicle deleted. You can restore it from the “Deleted” tab.');
    }

    public function restore(Vehicle $vehicle): RedirectResponse
    {
        $vehicle->restore();
        ActivityLog::record('vehicle.restored', $vehicle, "Restored {$vehicle->title}");

        return redirect()->route('autodeal.vehicles.show', $vehicle)->with('success', 'Vehicle restored.');
    }

    // ------------------------------------------------------------------

    /** Strips cost fields for staff logins. */
    private function forViewer(Vehicle $vehicle): Vehicle
    {
        return $this->isDealerOwner() ? $vehicle : $vehicle->makeHidden(Vehicle::OWNER_ONLY);
    }

    /** Owners always; staff only for vehicles they took in themselves (to hand the seller a copy). */
    private function canPrintPurchase(Vehicle $vehicle): bool
    {
        return $this->isDealerOwner() || (string) $vehicle->created_by === (string) request()->user()->id;
    }

    /**
     * Runs $work in a DB transaction and deletes any files it stored if anything
     * throws, so a failed save never leaves orphan uploads on the disk.
     */
    private function withFileRollback(callable $work): mixed
    {
        $stored = [];
        try {
            return DB::transaction(function () use ($work, &$stored) {
                return $work($stored);
            });
        } catch (\Throwable $e) {
            foreach ($stored as [$disk, $path]) {
                $disk === 'photo' ? Uploads::deletePhoto($path) : Storage::disk($disk)->delete($path);
            }
            throw $e;
        }
    }

    private function summary($user, $branch = null): array
    {
        $rows = Vehicle::query()
            ->visibleTo($user)
            ->when($branch, fn ($q) => $q->where('branch_id', (int) $branch))
            ->selectRaw('status, COUNT(*) as units, COALESCE(SUM(purchase_price),0) as cost, COALESCE(SUM(COALESCE(expected_price, purchase_price)),0) as est_value')
            ->groupBy('status')
            ->get()
            ->keyBy('status');

        $available = collect(Vehicle::SELLABLE)->map(fn ($s) => $rows->get($s));

        return [
            'by_status' => collect(Vehicle::STATUSES)->mapWithKeys(fn ($s) => [$s => (int) ($rows->get($s)->units ?? 0)]),
            'available_units' => (int) $available->sum('units'),
            // Cost and the cost-based estimate are owner-only.
            'stock_cost' => $user->isDealerOwner() ? (float) $available->sum('cost') : null,
            'stock_value' => $user->isDealerOwner() ? (float) $available->sum('est_value') : null,
        ];
    }

    private function upsertSeller(array $input, Request $request, array &$stored, ?Seller $current = null): Seller
    {
        // Same phone = same person/agency: reuse the record so their history stays linked.
        $seller = ($current && $current->phone === $input['phone'])
            ? $current
            : Seller::firstOrNew(['phone' => $input['phone']]);

        $seller->fill(Arr::only($input, ['name', 'phone', 'address', 'id_proof_type']));

        if ($file = $request->file('seller_id_proof')) {
            $old = $seller->id_proof_path;
            $seller->id_proof_path = Uploads::privateDocument($file, 'sellers');
            $stored[] = ['local', $seller->id_proof_path];
            if ($old) {
                DB::afterCommit(fn () => Storage::disk('local')->delete($old));
            }
        }
        $seller->save();

        return $seller;
    }

    private function storePhotos(Vehicle $vehicle, array $photos, Request $request, array &$stored): void
    {
        foreach ($photos as $i => $photo) {
            $file = $request->file("photos.{$i}.file");
            if (! $file) {
                continue;
            }
            [$path, $kb] = Uploads::vehiclePhoto($file, $vehicle->id);
            $stored[] = ['photo', $path];

            $vehicle->photos()->create([
                'file_path' => $path,
                'photo_type' => $photo['type'] ?? 'other',
                'size_kb' => $kb,
            ]);
        }
    }
}

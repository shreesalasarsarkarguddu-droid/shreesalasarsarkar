<?php

namespace App\AutoDeal\Http\Controllers;

use App\AutoDeal\Models\Branch;
use App\AutoDeal\Models\Vehicle;
use App\AutoDeal\Support\Money;
use App\AutoDeal\Support\Shop;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Public, no-login stock catalogue for customers. Only vehicles the owner has
 * listed and that are still available appear, and only customer-safe fields
 * leave the server: no cost, seller, chassis/engine numbers or document photos.
 */
class CatalogueController extends Controller
{
    /** Exterior/interior shots only – chassis plates and RC photos stay private. */
    private const PUBLIC_PHOTOS = ['front', 'rear', 'interior', 'engine', 'other'];

    public function index(Request $request): Response
    {
        $filters = array_filter($request->only('q', 'company', 'max_price', 'branch'), fn ($v) => $v !== null && $v !== '');

        $page = $this->listed()
            ->with(['branch', 'photos' => fn ($q) => $q->whereIn('photo_type', self::PUBLIC_PHOTOS)->orderBy('id')])
            ->when($filters['q'] ?? null, fn ($q, $search) => $this->search($q, $search))
            ->when($filters['company'] ?? null, fn ($q, $v) => $q->where('company_name', $v))
            ->when($filters['branch'] ?? null, fn ($q, $v) => $q->where('branch_id', (int) $v))
            ->when($filters['max_price'] ?? null, fn ($q, $v) => $q->where('expected_price', '<=', (float) $v))
            ->orderByDesc('intake_date')->orderByDesc('id')
            ->simplePaginate(24)
            ->withQueryString();

        return Inertia::render('Catalogue/Index', [
            'vehicles' => collect($page->items())->map(fn (Vehicle $v) => $this->present($v, cover: true)),
            'nextPageUrl' => $page->nextPageUrl(),
            'prevPageUrl' => $page->previousPageUrl(),
            'filters' => (object) $filters,
            'companies' => $this->listed()->distinct()->orderBy('company_name')->pluck('company_name'),
            'branches' => Branch::active()->orderBy('name')->get(['id', 'name', 'address', 'phone']),
            'dealer' => $this->dealer(),
        ])->withViewData(['meta' => [
            'title' => Shop::get()['name'].' – Used cars & bikes in stock',
            'description' => 'Browse available vehicles with photos and prices. Call or WhatsApp to book a test drive.',
            'image' => url('/icons/icon-512.png'),
        ]]);
    }

    public function show(Vehicle $vehicle): Response
    {
        $listed = $this->listed()->whereKey($vehicle->id)->first();
        abort_unless($listed, 404);
        $listed->load(['branch', 'photos' => fn ($q) => $q->whereIn('photo_type', self::PUBLIC_PHOTOS)->orderBy('id')]);
        $data = $this->present($listed);

        return Inertia::render('Catalogue/Show', [
            'vehicle' => $data,
            'dealer' => $this->dealer(),
        ])->withViewData(['meta' => [
            // WhatsApp/Facebook link previews read these server-rendered tags.
            'title' => $data['title'].($data['price'] ? ' – '.Money::inr($data['price']) : ''),
            'description' => collect([$data['color'], $data['registration'], $data['branch']['name'] ?? null, Shop::get()['name']])->filter()->implode(' · '),
            'image' => $data['photos'][0]['url'] ?? url('/icons/icon-512.png'),
        ]]);
    }

    // ------------------------------------------------------------------

    private function listed(): Builder
    {
        abort_unless(config('autodeal.catalogue_enabled'), 404);

        return Vehicle::query()->where('is_listed', true)->whereIn('status', ['in_stock', 'reserved']);
    }

    /** Customer search: make/model/variant/colour/year only – never chassis or engine numbers. */
    private function search(Builder $q, string $search): void
    {
        foreach (array_slice(preg_split('/\s+/', trim($search), -1, PREG_SPLIT_NO_EMPTY), 0, 5) as $word) {
            $like = '%'.addcslashes($word, '%_\\').'%';
            $q->where(fn (Builder $w) => $w->where('company_name', 'like', $like)->orWhere('model_name', 'like', $like)
                ->orWhere('variant', 'like', $like)->orWhere('color', 'like', $like)
                ->when(preg_match('/^(19|20)\d{2}$/', $word), fn ($w) => $w->orWhere('model_year', (int) $word)));
        }
    }

    private function present(Vehicle $v, bool $cover = false): array
    {
        $photos = $v->photos->map(fn ($p) => ['url' => url($p->url), 'type' => $p->photo_type]);

        return [
            'id' => $v->id,
            'title' => $v->title,
            'company_name' => $v->company_name,
            'model_name' => $v->model_name,
            'variant' => $v->variant,
            'model_year' => $v->model_year,
            'color' => $v->color,
            // e.g. CG04••1234 – shows the RTO region without exposing the full number.
            'registration' => $v->registration_number
                ? substr($v->registration_number, 0, 4).'••'.substr($v->registration_number, -4)
                : null,
            'price' => $v->expected_price ? (float) $v->expected_price : null,
            'reserved' => $v->status === 'reserved',
            'branch' => $v->branch ? $v->branch->only('id', 'name', 'address', 'phone') : null,
            'photos' => $cover ? $photos->take(1)->values() : $photos->values(),
            'photo_count' => $v->photos->count(),
        ];
    }

    /** The shop's contact details (Account → Shop details), GSTIN left out. */
    private function dealer(): array
    {
        return collect(Shop::get())->except('gstin')->all();
    }
}

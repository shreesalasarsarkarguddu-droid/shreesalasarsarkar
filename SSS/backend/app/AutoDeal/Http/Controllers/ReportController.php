<?php

namespace App\AutoDeal\Http\Controllers;

use App\AutoDeal\Models\Sale;
use App\AutoDeal\Models\Vehicle;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class ReportController extends Controller
{
    /** Optional branch filter applied to every query below. */
    private ?int $branch = null;

    public function index(Request $request): Response
    {
        $year = (int) $request->input('year', now()->year);
        $this->branch = $request->integer('branch') ?: null;

        return Inertia::render('Reports/Index', [
            'year' => $year,
            'branch' => $this->branch,
            'years' => $this->years(),
            'ledger' => $this->ledger($year),
            'monthly' => $this->monthly($year),
            'intakeSplit' => $this->intakeSplit($year),
            'sources' => $this->sources($year),
            'aging' => Inertia::defer(fn () => $this->aging()),
            'profitability' => Inertia::defer(fn () => $this->profitability($year)),
        ]);
    }

    /** Overall ledger for the selected year plus all-time outstanding. */
    private function ledger(int $year): array
    {
        $purchases = $this->vehicles()->whereYear('intake_date', $year)
            ->selectRaw('COUNT(*) as units, COALESCE(SUM(purchase_price),0) as total')->first();

        $sales = $this->salesQuery()->whereYear('ad_sales.sale_date', $year)
            ->selectRaw('COUNT(*) as units, COALESCE(SUM(ad_sales.selling_price),0) as revenue,
                COALESCE(SUM(ad_sales.selling_price - ad_vehicles.purchase_price),0) as profit,
                COALESCE(SUM(ad_vehicles.purchase_price),0) as cost')->first();

        return [
            'purchase_units' => (int) $purchases->units,
            'purchase_total' => (float) $purchases->total,
            'sale_units' => (int) $sales->units,
            'revenue' => (float) $sales->revenue,
            'cost_of_sold' => (float) $sales->cost,
            'profit' => (float) $sales->profit,
            'margin' => $sales->revenue > 0 ? round($sales->profit / $sales->revenue * 100, 1) : 0,
            'outstanding' => (float) Sale::query()
                ->when($this->branch, fn ($q) => $q->whereHas('vehicle', fn ($v) => $v->where('branch_id', $this->branch)))
                ->sum('balance_amount'),
        ];
    }

    /** 12 rows: purchases vs sales per month. */
    private function monthly(int $year): array
    {
        $bought = $this->vehicles()->whereYear('intake_date', $year)
            ->selectRaw($this->month('intake_date').' as m, COUNT(*) as units, SUM(purchase_price) as amount')
            ->groupBy('m')->get()->keyBy('m');

        $sold = $this->salesQuery()->whereYear('ad_sales.sale_date', $year)
            ->selectRaw($this->month('ad_sales.sale_date').' as m, COUNT(*) as units, SUM(ad_sales.selling_price) as amount,
                SUM(ad_sales.selling_price - ad_vehicles.purchase_price) as profit')
            ->groupBy('m')->get()->keyBy('m');

        return collect(range(1, 12))->map(function ($m) use ($bought, $sold) {
            $b = $bought->get($m);
            $s = $sold->get($m);

            return [
                'month' => $m,
                'bought_units' => (int) ($b->units ?? 0),
                'bought_amount' => (float) ($b->amount ?? 0),
                'sold_units' => (int) ($s->units ?? 0),
                'sold_amount' => (float) ($s->amount ?? 0),
                'profit' => (float) ($s->profit ?? 0),
            ];
        })->all();
    }

    /** Seized vs Direct Purchase comparison for vehicles taken in this year. */
    private function intakeSplit(int $year): array
    {
        return $this->vehicles()
            ->leftJoin('ad_sales', 'ad_sales.vehicle_id', '=', 'ad_vehicles.id')
            ->whereYear('ad_vehicles.intake_date', $year)
            ->groupBy('ad_vehicles.intake_type')
            ->selectRaw('ad_vehicles.intake_type,
                COUNT(*) as units,
                SUM(ad_vehicles.purchase_price) as cost,
                COUNT(ad_sales.id) as sold_units,
                COALESCE(SUM(ad_sales.selling_price),0) as revenue,
                COALESCE(SUM(CASE WHEN ad_sales.id IS NOT NULL THEN ad_sales.selling_price - ad_vehicles.purchase_price END),0) as profit')
            ->get()
            ->map(fn ($r) => [
                'intake_type' => $r->intake_type,
                'units' => (int) $r->units,
                'cost' => (float) $r->cost,
                'sold_units' => (int) $r->sold_units,
                'revenue' => (float) $r->revenue,
                'profit' => (float) $r->profit,
            ])->all();
    }

    /** Direct purchases of the year by where they came from (source / showroom). */
    private function sources(int $year): array
    {
        return $this->vehicles()
            ->leftJoin('ad_sales', 'ad_sales.vehicle_id', '=', 'ad_vehicles.id')
            ->whereYear('ad_vehicles.intake_date', $year)
            ->where('ad_vehicles.intake_type', 'customer_buy')
            ->groupBy('ad_vehicles.source')
            ->selectRaw('ad_vehicles.source, COUNT(*) as units, SUM(ad_vehicles.purchase_price) as cost, COUNT(ad_sales.id) as sold_units,
                COALESCE(SUM(CASE WHEN ad_sales.id IS NOT NULL THEN ad_sales.selling_price - ad_vehicles.purchase_price END),0) as profit')
            ->orderByDesc('units')
            ->get()
            ->map(fn ($r) => ['source' => $r->source, 'units' => (int) $r->units, 'cost' => (float) $r->cost,
                'sold_units' => (int) $r->sold_units, 'profit' => (float) $r->profit])->all();
    }

    /** Unsold stock bucketed by days since intake – the oldest cars tie up the most cash. */
    private function aging(): array
    {
        $vehicles = $this->vehicles()
            ->whereIn('status', Vehicle::SELLABLE)
            ->orderBy('intake_date')
            ->get(['id', 'company_name', 'model_name', 'variant', 'model_year', 'chassis_number', 'intake_type', 'purchase_price', 'intake_date', 'status']);

        $buckets = ['0-30' => [0, 0], '31-60' => [0, 0], '61-90' => [0, 0], '90+' => [0, 0]];
        $list = $vehicles->map(function (Vehicle $v) use (&$buckets) {
            $days = (int) $v->intake_date->diffInDays(now());
            $key = $days <= 30 ? '0-30' : ($days <= 60 ? '31-60' : ($days <= 90 ? '61-90' : '90+'));
            $buckets[$key][0]++;
            $buckets[$key][1] += (float) $v->purchase_price;

            return [...$v->only('id', 'chassis_number', 'intake_type', 'status'), 'title' => $v->title,
                'purchase_price' => (float) $v->purchase_price, 'days' => $days];
        });

        return [
            'buckets' => collect($buckets)->map(fn ($b, $k) => ['range' => $k, 'units' => $b[0], 'cost' => $b[1]])->values(),
            'oldest' => $list->take(25)->values(),
        ];
    }

    /** Per-vehicle P&L for the year. */
    private function profitability(int $year): array
    {
        return $this->salesQuery()
            ->whereYear('ad_sales.sale_date', $year)
            ->orderByDesc('ad_sales.sale_date')
            ->limit(500)
            ->get([
                'ad_sales.id', 'ad_sales.vehicle_id', 'ad_sales.sale_date', 'ad_sales.selling_price', 'ad_sales.balance_amount',
                'ad_vehicles.company_name', 'ad_vehicles.model_name', 'ad_vehicles.model_year', 'ad_vehicles.intake_type',
                'ad_vehicles.purchase_price', 'ad_vehicles.intake_date',
            ])
            ->map(function ($r) {
                $profit = (float) $r->selling_price - (float) $r->purchase_price;

                return [
                    'sale_id' => $r->id,
                    'vehicle_id' => $r->vehicle_id,
                    'title' => trim("{$r->model_year} {$r->company_name} {$r->model_name}"),
                    'intake_type' => $r->intake_type,
                    'sale_date' => substr((string) $r->sale_date, 0, 10),
                    'cost' => (float) $r->purchase_price,
                    'price' => (float) $r->selling_price,
                    'profit' => $profit,
                    'margin' => $r->selling_price > 0 ? round($profit / $r->selling_price * 100, 1) : 0,
                    'balance' => (float) $r->balance_amount,
                    'days' => (int) round((strtotime($r->sale_date) - strtotime($r->intake_date)) / 86400),
                ];
            })->all();
    }

    // ------------------------------------------------------------------

    private function salesQuery()
    {
        // Sold vehicles can't be soft-deleted, so the plain join never loses a sale.
        return DB::table('ad_sales')->join('ad_vehicles', 'ad_vehicles.id', '=', 'ad_sales.vehicle_id')
            ->when($this->branch, fn ($q) => $q->where('ad_vehicles.branch_id', $this->branch));
    }

    private function vehicles()
    {
        return Vehicle::query()->when($this->branch, fn ($q) => $q->where('ad_vehicles.branch_id', $this->branch));
    }

    /** Month number expression that works on MySQL (production) and SQLite (local/tests). */
    private function month(string $column): string
    {
        return DB::getDriverName() === 'sqlite'
            ? "CAST(strftime('%m', {$column}) AS INTEGER)"
            : "MONTH({$column})";
    }

    private function years(): array
    {
        $first = $this->vehicles()->min('intake_date');
        $start = $first ? (int) substr($first, 0, 4) : now()->year;

        return range(now()->year, min($start, now()->year));
    }
}

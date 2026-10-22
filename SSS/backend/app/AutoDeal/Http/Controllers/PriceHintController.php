<?php

namespace App\AutoDeal\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Pricing guidance from the dealer's own history: what this make/model
 * (same year ±1, falling back to any year) has actually sold for.
 * Owners also get cost and margin; staff only see selling prices.
 */
class PriceHintController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'company' => ['required', 'string', 'max:60'],
            'model' => ['required', 'string', 'max:80'],
            'year' => ['nullable', 'integer', 'min:1980', 'max:2100'],
            'exclude' => ['nullable', 'integer'], // the vehicle being priced
        ]);

        $base = DB::table('ad_sales')
            ->join('ad_vehicles', 'ad_vehicles.id', '=', 'ad_sales.vehicle_id')
            ->where('ad_vehicles.company_name', $data['company'])
            ->where('ad_vehicles.model_name', $data['model'])
            ->when($data['exclude'] ?? null, fn ($q, $id) => $q->where('ad_vehicles.id', '!=', $id))
            ->where('ad_sales.sale_date', '>=', now()->subYears(3)->toDateString());

        $scope = 'similar year';
        $stats = $this->stats((clone $base)->when($data['year'] ?? null, fn ($q, $y) => $q->whereBetween('ad_vehicles.model_year', [$y - 1, $y + 1])));
        if ($stats['count'] < 2 && ($data['year'] ?? null)) {
            $scope = 'any year';
            $stats = $this->stats($base);
        }

        if ($stats['count'] === 0) {
            return response()->json(['count' => 0]);
        }

        $result = ['scope' => $scope, ...$stats];
        if (! $this->isDealerOwner()) {
            unset($result['avg_cost'], $result['avg_profit'], $result['avg_margin']);
        }

        return response()->json($result);
    }

    private function stats($query): array
    {
        // Clone before selectRaw(): once columns are set, get([...]) would return the aggregate row instead.
        $days = (clone $query)->get(['ad_sales.sale_date', 'ad_vehicles.intake_date'])
            ->avg(fn ($r) => (strtotime($r->sale_date) - strtotime($r->intake_date)) / 86400);

        $row = $query->selectRaw('COUNT(*) as n,
                AVG(ad_sales.selling_price) as avg_price, MIN(ad_sales.selling_price) as min_price, MAX(ad_sales.selling_price) as max_price,
                AVG(ad_vehicles.purchase_price) as avg_cost, AVG(ad_sales.selling_price - ad_vehicles.purchase_price) as avg_profit,
                MAX(ad_sales.sale_date) as last_sold')
            ->first();

        return [
            'count' => (int) $row->n,
            'avg_price' => round((float) $row->avg_price, -3),
            'min_price' => (float) $row->min_price,
            'max_price' => (float) $row->max_price,
            'avg_cost' => round((float) $row->avg_cost, -3),
            'avg_profit' => round((float) $row->avg_profit, -2),
            'avg_margin' => $row->avg_price > 0 ? round($row->avg_profit / $row->avg_price * 100, 1) : 0,
            'avg_days' => $days !== null ? (int) round($days) : null,
            'last_sold' => $row->last_sold ? substr((string) $row->last_sold, 0, 10) : null,
        ];
    }
}

<?php

namespace App\AutoDeal\Http\Controllers;

use App\AutoDeal\Models\ActivityLog;
use App\AutoDeal\Models\Branch;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Owner-only CSV exports for the CA / Excel. Streamed in chunks so even years of
 * data never load into memory at once (shared-hosting memory limits).
 */
class ExportController extends Controller
{
    public const TYPES = [
        'stock' => 'Current stock',
        'purchases' => 'Purchases (intake)',
        'sales' => 'Sales',
        'payments' => 'Payments received',
        'dues' => 'Outstanding dues',
    ];

    public function __invoke(Request $request, string $type): StreamedResponse
    {
        abort_unless(isset(self::TYPES[$type]), 404);
        $f = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'branch' => ['nullable', 'integer'],
        ]);

        [$headers, $query, $row] = $this->{$type}($f);
        $branchName = ($f['branch'] ?? null) ? Branch::find($f['branch'])?->name : null;
        $name = collect(['autodeal', $type, $branchName, $f['from'] ?? null, $f['to'] ?? null, now()->format('Ymd-Hi')])
            ->filter()->map(fn ($p) => str($p)->slug())->implode('-').'.csv';

        ActivityLog::record('export.'.$type, null, 'Downloaded '.self::TYPES[$type].' CSV'.($branchName ? " ({$branchName})" : ''));

        return response()->streamDownload(function () use ($headers, $query, $row) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM so Excel shows ₹ and Hindi names correctly
            fputcsv($out, $headers);
            $query->chunk(500, function ($rows) use ($out, $row) {
                foreach ($rows as $r) {
                    fputcsv($out, array_map(fn ($v) => $this->safe($v), $row($r)));
                }
            });
            fclose($out);
        }, $name, ['Content-Type' => 'text/csv; charset=UTF-8', 'Cache-Control' => 'no-store']);
    }

    // ---- one method per export: [headers, query (ordered, chunkable), row mapper] ----

    private function stock(array $f): array
    {
        $q = $this->vehicles($f)->whereNull('ad_vehicles.deleted_at')->whereIn('ad_vehicles.status', ['in_stock', 'processing', 'reserved'])
            ->orderBy('ad_vehicles.intake_date')->orderBy('ad_vehicles.id');

        return [
            ['Branch', 'Status', 'Intake type', 'Intake date', 'Days in stock', 'Make', 'Model', 'Variant', 'Year', 'Colour',
                'Reg no', 'Chassis no', 'Engine no', 'Cost', 'Expected price', 'Listed online', 'Seller', 'Seller mobile'],
            $q,
            fn ($r) => [$r->branch, $r->status, $r->intake_type, $r->intake_date, (int) floor((time() - strtotime($r->intake_date)) / 86400),
                $r->company_name, $r->model_name, $r->variant, $r->model_year, $r->color, $r->registration_number, $r->chassis_number,
                $r->engine_number, $this->money($r->purchase_price), $this->money($r->expected_price), $r->is_listed ? 'Yes' : 'No', $r->seller, $r->seller_phone],
        ];
    }

    private function purchases(array $f): array
    {
        $q = $this->vehicles($f)->whereNull('ad_vehicles.deleted_at')
            ->when($f['from'] ?? null, fn ($q, $v) => $q->where('ad_vehicles.intake_date', '>=', $v))
            ->when($f['to'] ?? null, fn ($q, $v) => $q->where('ad_vehicles.intake_date', '<=', $v))
            ->orderBy('ad_vehicles.intake_date')->orderBy('ad_vehicles.id');

        return [
            ['Intake date', 'Branch', 'Intake type', 'Make', 'Model', 'Variant', 'Year', 'Reg no', 'Chassis no', 'Engine no',
                'Cost', 'Seller', 'Seller mobile', 'Current status'],
            $q,
            fn ($r) => [$r->intake_date, $r->branch, $r->intake_type, $r->company_name, $r->model_name, $r->variant, $r->model_year,
                $r->registration_number, $r->chassis_number, $r->engine_number, $this->money($r->purchase_price), $r->seller, $r->seller_phone, $r->status],
        ];
    }

    private function sales(array $f): array
    {
        $q = $this->salesBase($f)
            ->when($f['from'] ?? null, fn ($q, $v) => $q->where('ad_sales.sale_date', '>=', $v))
            ->when($f['to'] ?? null, fn ($q, $v) => $q->where('ad_sales.sale_date', '<=', $v))
            ->orderBy('ad_sales.sale_date')->orderBy('ad_sales.id');

        return [
            ['Sale date', 'Receipt no', 'Branch', 'Make', 'Model', 'Year', 'Reg no', 'Chassis no', 'Intake type', 'Intake date',
                'Cost', 'Selling price', 'Profit', 'Margin %', 'Payment mode', 'Financier', 'Received', 'Balance', 'Buyer', 'Buyer mobile'],
            $q,
            fn ($r) => [$r->sale_date, 'SAL-'.str_pad($r->id, 5, '0', STR_PAD_LEFT), $r->branch, $r->company_name, $r->model_name, $r->model_year,
                $r->registration_number, $r->chassis_number, $r->intake_type, $r->intake_date, $this->money($r->purchase_price), $this->money($r->selling_price),
                $this->money($r->selling_price - $r->purchase_price),
                $r->selling_price > 0 ? round(($r->selling_price - $r->purchase_price) / $r->selling_price * 100, 1) : 0,
                $r->payment_mode, $r->financier, $this->money($r->paid_amount), $this->money($r->balance_amount), $r->buyer, $r->buyer_phone],
        ];
    }

    private function payments(array $f): array
    {
        $q = DB::table('ad_sale_payments')
            ->join('ad_sales', 'ad_sales.id', '=', 'ad_sale_payments.sale_id')
            ->join('ad_vehicles', 'ad_vehicles.id', '=', 'ad_sales.vehicle_id')
            ->join('ad_buyers', 'ad_buyers.id', '=', 'ad_sales.buyer_id')
            ->leftJoin('ad_branches', 'ad_branches.id', '=', 'ad_vehicles.branch_id')
            ->when($f['branch'] ?? null, fn ($q, $v) => $q->where('ad_vehicles.branch_id', $v))
            ->when($f['from'] ?? null, fn ($q, $v) => $q->where('ad_sale_payments.paid_on', '>=', $v))
            ->when($f['to'] ?? null, fn ($q, $v) => $q->where('ad_sale_payments.paid_on', '<=', $v))
            ->select('ad_sale_payments.*', 'ad_sales.id as sale_id', 'ad_vehicles.company_name', 'ad_vehicles.model_name', 'ad_vehicles.chassis_number',
                'ad_buyers.name as buyer', 'ad_buyers.phone as buyer_phone', 'ad_branches.name as branch')
            ->orderBy('ad_sale_payments.paid_on')->orderBy('ad_sale_payments.id');

        return [
            ['Paid on', 'Receipt no', 'Branch', 'Vehicle', 'Chassis no', 'Buyer', 'Buyer mobile', 'Amount', 'Mode', 'Reference'],
            $q,
            fn ($r) => [$r->paid_on, 'SAL-'.str_pad($r->sale_id, 5, '0', STR_PAD_LEFT), $r->branch, "{$r->company_name} {$r->model_name}",
                $r->chassis_number, $r->buyer, $r->buyer_phone, $this->money($r->amount), $r->mode, $r->reference],
        ];
    }

    private function dues(array $f): array
    {
        $q = $this->salesBase($f)->where('ad_sales.balance_amount', '>', 0)->orderBy('ad_sales.sale_date')->orderBy('ad_sales.id');

        return [
            ['Sale date', 'Days outstanding', 'Receipt no', 'Branch', 'Vehicle', 'Chassis no', 'Buyer', 'Buyer mobile',
                'Selling price', 'Received', 'Balance due', 'Payment mode', 'Financier'],
            $q,
            fn ($r) => [$r->sale_date, (int) floor((time() - strtotime($r->sale_date)) / 86400), 'SAL-'.str_pad($r->id, 5, '0', STR_PAD_LEFT),
                $r->branch, "{$r->model_year} {$r->company_name} {$r->model_name}", $r->chassis_number, $r->buyer, $r->buyer_phone,
                $this->money($r->selling_price), $this->money($r->paid_amount), $this->money($r->balance_amount), $r->payment_mode, $r->financier],
        ];
    }

    // ------------------------------------------------------------------

    private function vehicles(array $f)
    {
        return DB::table('ad_vehicles')
            ->join('ad_sellers', 'ad_sellers.id', '=', 'ad_vehicles.seller_id')
            ->leftJoin('ad_branches', 'ad_branches.id', '=', 'ad_vehicles.branch_id')
            ->when($f['branch'] ?? null, fn ($q, $v) => $q->where('ad_vehicles.branch_id', $v))
            ->select('ad_vehicles.*', 'ad_sellers.name as seller', 'ad_sellers.phone as seller_phone', 'ad_branches.name as branch');
    }

    private function salesBase(array $f)
    {
        return DB::table('ad_sales')
            ->join('ad_vehicles', 'ad_vehicles.id', '=', 'ad_sales.vehicle_id')
            ->join('ad_buyers', 'ad_buyers.id', '=', 'ad_sales.buyer_id')
            ->leftJoin('ad_branches', 'ad_branches.id', '=', 'ad_vehicles.branch_id')
            ->when($f['branch'] ?? null, fn ($q, $v) => $q->where('ad_vehicles.branch_id', $v))
            ->select('ad_sales.*', 'ad_vehicles.company_name', 'ad_vehicles.model_name', 'ad_vehicles.model_year', 'ad_vehicles.registration_number',
                'ad_vehicles.chassis_number', 'ad_vehicles.intake_type', 'ad_vehicles.intake_date', 'ad_vehicles.purchase_price',
                'ad_buyers.name as buyer', 'ad_buyers.phone as buyer_phone', 'ad_branches.name as branch');
    }

    /** Same "12345.00" format from MySQL and SQLite, so Excel sums cleanly. */
    private function money($value): ?string
    {
        return $value === null ? null : number_format((float) $value, 2, '.', '');
    }

    /** Neutralise spreadsheet formula injection (a name like "=HYPERLINK(...)"). */
    private function safe($value)
    {
        if (is_string($value) && $value !== '' && in_array($value[0], ['=', '+', '-', '@', "\t", "\r"], true) && ! is_numeric($value)) {
            return "'".$value;
        }

        return $value;
    }
}

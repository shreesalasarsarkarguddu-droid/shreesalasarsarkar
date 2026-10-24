<?php

namespace App\AutoDeal\Http\Controllers;

use App\AutoDeal\Models\Sale;
use App\AutoDeal\Models\Vehicle;
use App\AutoDeal\Support\Shop;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Request;

/**
 * Purchase & sale agreements. The same Blade view renders as a mobile-friendly
 * printable page (default) or as a downloadable PDF (?download=1).
 */
class ReceiptController extends Controller
{
    public function purchase(Request $request, Vehicle $vehicle)
    {
        $this->ensureVisible($vehicle);
        // The purchase agreement shows the cost: owners, or the staff member who did the intake.
        abort_unless($this->isDealerOwner() || (string) $vehicle->created_by === (string) $request->user()->id, 403);
        $vehicle->load('seller', 'branch');

        return $this->render($request, 'autodeal::receipts.purchase', [
            'vehicle' => $vehicle,
            'number' => 'PUR-'.str_pad($vehicle->id, 5, '0', STR_PAD_LEFT),
        ], "purchase-{$vehicle->chassis_number}.pdf");
    }

    public function sale(Request $request, Sale $sale)
    {
        $sale->load(['vehicle.seller', 'vehicle.branch', 'buyer']);
        $this->ensureVisible($sale->vehicle);

        return $this->render($request, 'autodeal::receipts.sale', [
            'sale' => $sale,
            'vehicle' => $sale->vehicle,
            'number' => 'SAL-'.str_pad($sale->id, 5, '0', STR_PAD_LEFT),
        ], "sale-{$sale->vehicle->chassis_number}.pdf");
    }

    private function render(Request $request, string $view, array $data, string $filename)
    {
        // A branch's own address/phone (when set) replaces the head-office details on its paperwork.
        $branch = $data['vehicle']->branch;
        $shop = Shop::get();
        $data['business'] = [
            ...config('autodeal'),
            'business_name' => $shop['name'],
            'business_address' => $branch?->address ?: $shop['address'],
            'business_phone' => $branch?->phone ?: collect([$shop['phone'], $shop['phone2']])->filter()->implode(', '),
            'business_gstin' => $shop['gstin'],
            'business_email' => $shop['email'],
        ];
        $data['pdf'] = $request->boolean('download');

        if (! $data['pdf']) {
            return view($view, $data);
        }

        return Pdf::loadView($view, $data)
            ->setPaper('a4')
            ->setOption(['isRemoteEnabled' => false, 'defaultFont' => 'DejaVu Sans'])
            ->download($filename);
    }
}

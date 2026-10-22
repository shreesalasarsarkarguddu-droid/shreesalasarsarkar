<?php

namespace App\AutoDeal\Http\Controllers;

use App\AutoDeal\Http\Requests\StoreSaleRequest;
use App\AutoDeal\Models\ActivityLog;
use App\AutoDeal\Models\Buyer;
use App\AutoDeal\Models\Sale;
use App\AutoDeal\Models\Vehicle;
use App\AutoDeal\Support\Money;
use App\AutoDeal\Support\Uploads;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

class SaleController extends Controller
{
    /** Sales ledger with outstanding-balance filter. */
    public function index(Request $request): Response
    {
        $owner = $this->isDealerOwner();
        $visible = fn ($q) => $q->visibleTo($request->user());

        $sales = Sale::query()
            ->with(['vehicle:id,company_name,model_name,variant,model_year,chassis_number,purchase_price,branch_id', 'buyer:id,name,phone'])
            ->whereHas('vehicle', $visible)
            ->when($request->boolean('outstanding'), fn ($q) => $q->where('balance_amount', '>', 0))
            ->when($request->q, fn ($q, $term) => $q->whereHas('buyer', fn ($b) => $b->where(fn ($w) => $w
                ->where('name', 'like', '%'.addcslashes($term, '%_\\').'%')
                ->orWhere('phone', 'like', preg_replace('/\D/', '', $term).'%'))))
            ->orderByDesc('sale_date')->orderByDesc('id')
            ->simplePaginate(25)
            ->withQueryString();

        return Inertia::render('Sales/Index', [
            'sales' => $sales->through(function (Sale $s) use ($owner) {
                $row = $s->toArray();
                if (! $owner) {
                    unset($row['vehicle']['purchase_price']);
                }

                return [...$row, 'profit' => $owner ? $s->profit : null];
            }),
            'filters' => $request->only('q', 'outstanding'),
            'outstandingTotal' => (float) Sale::whereHas('vehicle', $visible)->sum('balance_amount'),
        ]);
    }

    /** Liquidation: record buyer + sale, mark vehicle Sold. */
    public function store(StoreSaleRequest $request, Vehicle $vehicle): RedirectResponse
    {
        $this->ensureVisible($vehicle);
        $data = $request->validated();
        $stored = [];

        try {
            DB::transaction(function () use ($request, $data, $vehicle, &$stored) {
                // Row lock prevents two staff phones selling the same car at once.
                $locked = Vehicle::whereKey($vehicle->id)->lockForUpdate()->firstOrFail();
                if (! $locked->isSellable()) {
                    throw ValidationException::withMessages(['selling_price' => 'This vehicle is no longer available for sale.']);
                }

                $buyer = Buyer::firstOrNew(['phone' => $data['buyer']['phone']]);
                $buyer->fill(Arr::only($data['buyer'], ['name', 'phone', 'address', 'id_proof_type']));
                if ($file = $request->file('buyer_id_proof')) {
                    $old = $buyer->id_proof_path;
                    $buyer->id_proof_path = Uploads::privateDocument($file, 'buyers');
                    $stored[] = ['local', $buyer->id_proof_path];
                    if ($old) {
                        DB::afterCommit(fn () => Storage::disk('local')->delete($old));
                    }
                }
                $buyer->save();

                $sale = Sale::create([
                    'vehicle_id' => $locked->id,
                    'buyer_id' => $buyer->id,
                    'selling_price' => $data['selling_price'],
                    'sale_date' => $data['sale_date'],
                    'payment_mode' => $data['payment_mode'],
                    'financier' => $data['financier'] ?? null,
                    'notes' => $data['notes'] ?? null,
                    'created_by' => $request->user()->id,
                    ...Sale::settle((float) $data['selling_price'], (float) $data['paid_amount']),
                ]);

                if ($sale->paid_amount > 0) {
                    $sale->payments()->create([
                        'amount' => $sale->paid_amount,
                        'paid_on' => $data['sale_date'],
                        'mode' => $data['payment_mode'],
                        'reference' => 'At sale',
                        'created_by' => $request->user()->id,
                    ]);
                }

                foreach ($request->file('documents', []) as $doc) {
                    $path = Uploads::privateDocument($doc, 'sales');
                    $stored[] = ['local', $path];
                    $sale->documents()->create(['file_path' => $path, 'label' => $doc->getClientOriginalName()]);
                }

                $locked->update(['status' => 'sold']);
            });
        } catch (\Throwable $e) {
            foreach ($stored as [$disk, $path]) {
                Storage::disk($disk)->delete($path);
            }
            throw $e;
        }

        $profit = (float) $data['selling_price'] - (float) $vehicle->purchase_price;
        ActivityLog::record('sale.created', $vehicle, sprintf('Sold %s to %s for %s', $vehicle->title, $data['buyer']['name'], Money::inr($data['selling_price'])));

        // Only owners are told the margin.
        return redirect()->route('autodeal.vehicles.show', $vehicle)->with('success', $this->isDealerOwner()
            ? sprintf('Sold! Net %s: %s', $profit >= 0 ? 'profit' : 'loss', Money::inr(abs($profit)))
            : 'Sale recorded.');
    }

    /** Record a follow-up instalment against an outstanding balance. */
    public function recordPayment(Request $request, Sale $sale): RedirectResponse
    {
        $this->ensureVisible($sale->vehicle);
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:1', 'max:'.$sale->balance_amount],
            'paid_on' => ['required', 'date', 'before_or_equal:today', 'after_or_equal:'.$sale->sale_date->toDateString()],
            'mode' => ['required', Rule::in(Sale::PAYMENT_MODES)],
            'reference' => ['nullable', 'string', 'max:120'],
        ], ['amount.max' => 'Amount cannot exceed the outstanding balance.']);

        DB::transaction(function () use ($sale, $data, $request) {
            $sale->payments()->create([...$data, 'created_by' => $request->user()->id]);
            $sale->update(Sale::settle((float) $sale->selling_price, (float) $sale->payments()->sum('amount')));
        });
        ActivityLog::record('sale.payment', $sale->vehicle, sprintf('Received %s (%s) from %s', Money::inr($data['amount']), $data['mode'], $sale->buyer->name));

        return back()->with('success', 'Payment recorded.');
    }

    /** Undo a sale (wrong entry / deal fell through): vehicle goes back to stock. */
    public function destroy(Sale $sale): RedirectResponse
    {
        $paths = $sale->documents()->pluck('file_path');

        DB::transaction(function () use ($sale) {
            $sale->vehicle()->update(['status' => 'in_stock']);
            $sale->delete();
        });
        Storage::disk('local')->delete($paths->all());
        ActivityLog::record('sale.cancelled', $sale->vehicle, sprintf('Cancelled sale of %s to %s (%s)', $sale->vehicle->title, $sale->buyer->name, Money::inr($sale->selling_price)));

        return redirect()->route('autodeal.vehicles.show', $sale->vehicle_id)->with('success', 'Sale cancelled. Vehicle is back in stock.');
    }
}

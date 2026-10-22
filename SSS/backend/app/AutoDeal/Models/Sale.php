<?php

namespace App\AutoDeal\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Sale extends Model
{
    protected $table = 'ad_sales';

    public const PAYMENT_MODES = ['cash', 'bank_transfer', 'upi', 'finance'];

    protected $fillable = [
        'vehicle_id', 'buyer_id', 'selling_price', 'sale_date', 'payment_mode',
        'payment_status', 'paid_amount', 'balance_amount', 'financier', 'notes', 'created_by',
    ];

    protected $casts = [
        'sale_date' => 'date:Y-m-d',
        'selling_price' => 'decimal:2',
        'paid_amount' => 'decimal:2',
        'balance_amount' => 'decimal:2',
    ];

    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class)->withTrashed();
    }

    public function buyer(): BelongsTo
    {
        return $this->belongsTo(Buyer::class);
    }

    public function documents(): HasMany
    {
        return $this->hasMany(SaleDocument::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(SalePayment::class)->orderBy('paid_on')->orderBy('id');
    }

    /** Net profit = selling price − cost basis of the vehicle. */
    public function getProfitAttribute(): float
    {
        return round((float) $this->selling_price - (float) $this->vehicle?->purchase_price, 2);
    }

    /** Derive status and balance from the amount actually received. */
    public static function settle(float $price, float $paid): array
    {
        $paid = min(max($paid, 0), $price);
        $balance = round($price - $paid, 2);

        return [
            'paid_amount' => $paid,
            'balance_amount' => $balance,
            'payment_status' => $balance <= 0 ? 'paid' : ($paid > 0 ? 'partial' : 'pending'),
        ];
    }
}

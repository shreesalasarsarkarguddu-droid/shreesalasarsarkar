<?php

namespace App\AutoDeal\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SalePayment extends Model
{
    protected $table = 'ad_sale_payments';

    protected $fillable = ['sale_id', 'amount', 'paid_on', 'mode', 'reference', 'created_by'];

    protected $casts = [
        'paid_on' => 'date:Y-m-d',
        'amount' => 'decimal:2',
    ];

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }
}

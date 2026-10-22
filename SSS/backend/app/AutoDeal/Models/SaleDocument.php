<?php

namespace App\AutoDeal\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SaleDocument extends Model
{
    protected $table = 'ad_sale_documents';

    protected $fillable = ['sale_id', 'file_path', 'label'];

    protected $hidden = ['file_path'];

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }
}

<?php

namespace App\AutoDeal\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

class VehiclePhoto extends Model
{
    protected $table = 'ad_vehicle_photos';

    public const TYPES = ['front', 'rear', 'interior', 'engine', 'chassis', 'document', 'other'];

    protected $fillable = ['vehicle_id', 'file_path', 'photo_type', 'size_kb'];

    protected $appends = ['url'];

    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    public function getUrlAttribute(): string
    {
        return Storage::disk('public')->url($this->file_path);
    }
}

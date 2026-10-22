<?php

namespace App\AutoDeal\Models;

use App\AutoDeal\Support\Uploads;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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
        return Uploads::photoUrl($this->file_path);
    }
}

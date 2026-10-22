<?php

namespace App\AutoDeal\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class VehicleTransfer extends Model
{
    protected $table = 'ad_vehicle_transfers';

    protected $fillable = ['vehicle_id', 'from_branch_id', 'to_branch_id', 'transferred_on', 'note', 'user_id'];

    protected $casts = ['transferred_on' => 'date:Y-m-d'];

    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    public function from(): BelongsTo
    {
        return $this->belongsTo(Branch::class, 'from_branch_id');
    }

    public function to(): BelongsTo
    {
        return $this->belongsTo(Branch::class, 'to_branch_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

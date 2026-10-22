<?php

namespace App\AutoDeal\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Seller extends Model
{
    protected $table = 'ad_sellers';

    protected $fillable = ['name', 'phone', 'address', 'id_proof_type', 'id_proof_path'];

    protected $hidden = ['id_proof_path'];

    protected $appends = ['has_id_proof'];

    public function vehicles(): HasMany
    {
        return $this->hasMany(Vehicle::class);
    }

    public function getHasIdProofAttribute(): bool
    {
        return (bool) $this->id_proof_path;
    }
}

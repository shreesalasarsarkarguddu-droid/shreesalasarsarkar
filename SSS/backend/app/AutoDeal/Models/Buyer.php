<?php

namespace App\AutoDeal\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Buyer extends Model
{
    protected $table = 'ad_buyers';

    protected $fillable = ['name', 'phone', 'address', 'id_proof_type', 'id_proof_path'];

    protected $hidden = ['id_proof_path'];

    protected $appends = ['has_id_proof'];

    public function sales(): HasMany
    {
        return $this->hasMany(Sale::class);
    }

    public function getHasIdProofAttribute(): bool
    {
        return (bool) $this->id_proof_path;
    }
}

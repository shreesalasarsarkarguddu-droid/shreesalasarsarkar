<?php

namespace App\AutoDeal\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Branch extends Model
{
    protected $table = 'ad_branches';

    protected $fillable = ['name', 'address', 'phone', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    public function vehicles(): HasMany
    {
        return $this->hasMany(Vehicle::class);
    }

    public function scopeActive(Builder $q): Builder
    {
        return $q->where('is_active', true);
    }

    /** [{id, name}] of active branches, sorted – a list, so JS keeps the order. */
    public static function options(): array
    {
        return static::active()->orderBy('name')->get(['id', 'name'])->toArray();
    }
}

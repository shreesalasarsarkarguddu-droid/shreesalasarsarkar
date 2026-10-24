<?php

namespace App\AutoDeal\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

class Vehicle extends Model
{
    protected $table = 'ad_vehicles';

    use SoftDeletes;

    public const STATUSES = ['in_stock', 'processing', 'reserved', 'sold', 'archived'];

    public const SELLABLE = ['in_stock', 'processing', 'reserved'];

    public const INTAKE_TYPES = ['seized', 'customer_buy'];

    protected $fillable = [
        'intake_type', 'source', 'company_name', 'model_name', 'variant', 'model_year', 'color',
        'registration_number', 'chassis_number', 'engine_number', 'purchase_price',
        'expected_price', 'status', 'intake_date', 'remarks', 'seller_id', 'created_by', 'branch_id', 'is_listed',
    ];

    protected $casts = [
        'intake_date' => 'date:Y-m-d',
        'purchase_price' => 'decimal:2',
        'expected_price' => 'decimal:2',
        'model_year' => 'integer',
        'is_listed' => 'boolean',
    ];

    /** Cost-side fields that staff (non-owner) logins must never receive. */
    public const OWNER_ONLY = ['purchase_price'];

    public function seller(): BelongsTo
    {
        return $this->belongsTo(Seller::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function transfers(): HasMany
    {
        return $this->hasMany(VehicleTransfer::class)->latest('transferred_on')->latest('id');
    }

    /** Staff tied to a branch only see that branch's vehicles. */
    public function scopeVisibleTo(Builder $q, User $user): Builder
    {
        return $q->when($user->dealerBranch(), fn ($q, $branchId) => $q->where('ad_vehicles.branch_id', $branchId));
    }

    public function isVisibleTo(User $user): bool
    {
        return ! $user->dealerBranch() || $user->dealerBranch() === (int) $this->branch_id;
    }

    public function photos(): HasMany
    {
        return $this->hasMany(VehiclePhoto::class);
    }

    /** Thumbnail for list cards: earliest photo that isn't a document/chassis-plate close-up. */
    public function coverPhoto(): HasOne
    {
        return $this->hasOne(VehiclePhoto::class)->ofMany(
            ['id' => 'min'],
            fn (Builder $q) => $q->whereNotIn('photo_type', ['document', 'chassis']),
        );
    }

    public function sale(): HasOne
    {
        return $this->hasOne(Sale::class);
    }

    public function isSellable(): bool
    {
        return in_array($this->status, self::SELLABLE, true);
    }

    public function getTitleAttribute(): string
    {
        return trim("{$this->model_year} {$this->company_name} {$this->model_name} {$this->variant}");
    }

    /**
     * Stock dashboard search and filters.
     * Search is multi-word: every word must match some column, so "swift 2019",
     * "suzuki white" or the last 5 chassis characters all work. A dealer's stock is
     * a few thousand rows at most, so "contains" matching stays fast even on shared MySQL.
     * Archived vehicles are hidden unless that status is asked for; status=deleted lists soft-deleted ones.
     */
    public function scopeFilter(Builder $q, array $f): Builder
    {
        $status = $f['status'] ?? null;

        return $q
            ->when($f['q'] ?? null, function (Builder $q, string $search) {
                $words = array_slice(preg_split('/\s+/', trim($search), -1, PREG_SPLIT_NO_EMPTY), 0, 5);
                foreach ($words as $word) {
                    $like = '%'.addcslashes($word, '%_\\').'%';
                    $q->where(fn (Builder $w) => $w
                        ->where('company_name', 'like', $like)
                        ->orWhere('model_name', 'like', $like)
                        ->orWhere('variant', 'like', $like)
                        ->orWhere('color', 'like', $like)
                        ->orWhere('registration_number', 'like', $like)
                        ->orWhere('chassis_number', 'like', $like)
                        ->orWhere('source', 'like', $like)
                        ->orWhere('engine_number', 'like', $like)
                        ->when(preg_match('/^(19|20)\d{2}$/', $word), fn ($w) => $w->orWhere('model_year', (int) $word)));
                }
            })
            ->when($status === 'deleted', fn ($q) => $q->onlyTrashed())
            ->when($status && $status !== 'deleted', fn ($q) => $q->where('status', $status))
            ->when(! $status, fn ($q) => $q->where('status', '!=', 'archived'))
            ->when($f['intake_type'] ?? null, fn ($q, $v) => $q->where('intake_type', $v))
            ->when($f['branch'] ?? null, fn ($q, $v) => $q->where('ad_vehicles.branch_id', (int) $v))
            ->when(isset($f['listed']) && $f['listed'] !== '', fn ($q) => $q->where('is_listed', (bool) $f['listed']))
            ->when($f['company'] ?? null, fn ($q, $v) => $q->where('company_name', $v))
            ->when($f['year'] ?? null, fn ($q, $v) => $q->where('model_year', (int) $v))
            ->when($f['min_price'] ?? null, fn ($q, $v) => $q->where('purchase_price', '>=', (float) $v))
            ->when($f['max_price'] ?? null, fn ($q, $v) => $q->where('purchase_price', '<=', (float) $v));
    }
}

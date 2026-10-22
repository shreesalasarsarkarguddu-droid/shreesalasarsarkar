<?php

namespace App\AutoDeal\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Support\Arr;

/** Append-only audit trail: who did what, when, and what changed. */
class ActivityLog extends Model
{
    protected $table = 'ad_activity_logs';

    public const UPDATED_AT = null;

    protected $fillable = ['user_id', 'action', 'subject_type', 'subject_id', 'description', 'changes', 'ip'];

    protected $casts = ['changes' => 'array', 'created_at' => 'datetime'];

    /** Fields never written to the log, even when they change. */
    private const SECRET = ['password', 'remember_token', 'id_proof_path', 'file_path', 'updated_at', 'created_at'];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function subject(): MorphTo
    {
        return $this->morphTo();
    }

    public static function record(string $action, ?Model $subject, string $description, array $changes = [], ?string $userId = null): self
    {
        $changes = Arr::except($changes, self::SECRET);

        return static::create([
            'user_id' => $userId ?? auth()->id(),
            'action' => $action,
            'subject_type' => $subject?->getMorphClass(),
            'subject_id' => $subject?->getKey(),
            'description' => mb_substr($description, 0, 255),
            'changes' => $changes ?: null,
            'ip' => request()?->ip(),
        ]);
    }

    /**
     * [field => [old, new]] for what the last save() changed. Pass the raw attributes
     * captured *before* saving ($model->getRawOriginal()) – after save() the model's
     * "original" already holds the new values.
     */
    public static function diff(array $before, Model $model): array
    {
        $out = [];
        foreach (Arr::except($model->getChanges(), self::SECRET) as $field => $new) {
            $old = $before[$field] ?? null;
            // Ignore cosmetic changes such as "350000.00" → 350000.
            if (is_numeric($old) && is_numeric($new) && (float) $old === (float) $new) {
                continue;
            }
            $out[$field] = [$old, $new];
        }

        return $out;
    }
}

<?php

namespace App\Models;

use App\Support\Perm;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

/** A staff login. Admins can do everything; staff only what their permissions allow (see App\Support\Perm). */
class User extends Authenticatable
{
    use HasApiTokens, HasUuids, Notifiable;

    protected $fillable = ['email', 'password', 'full_name', 'role', 'active', 'permissions'];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            'active' => 'boolean',
            'permissions' => 'array',
            'force_logout_at' => 'datetime',
            'archived_at' => 'datetime',
            'last_sign_in_at' => 'datetime',
        ];
    }

    public function isAdmin(): bool
    {
        return $this->role === 'admin';
    }

    public function can($ability, $arguments = []): bool
    {
        return Perm::can($this, (string) $ability);
    }

    /** What the browser needs to know about the person signed in. */
    public function access(): array
    {
        return [
            'id' => $this->id,
            'email' => $this->email,
            'full_name' => $this->full_name,
            'role' => $this->role,
            'permissions' => array_values($this->permissions ?? []),
        ];
    }
}

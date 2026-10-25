<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/** The whole site on / off (the power admin at /power, or `php artisan site:on|off`). */
final class SiteSwitch
{
    public const DEFAULT_MESSAGE = 'The site is closed for some time. Please come back later.';

    private static ?object $row = null;

    private static function row(): ?object
    {
        return self::$row ??= DB::table('app_settings')->where('id', 1)->first(['site_off', 'site_off_message', 'site_off_changed_at']);
    }

    public static function isOff(): bool
    {
        return (bool) (self::row()?->site_off ?? false);
    }

    public static function message(): string
    {
        return self::row()?->site_off_message ?: self::DEFAULT_MESSAGE;
    }

    public static function changedAt(): ?string
    {
        return self::row()?->site_off_changed_at;
    }

    /** $by: the power admin, or null from the server's terminal. */
    public static function set(bool $off, ?string $message, ?User $by): void
    {
        $message = $message !== null && trim($message) !== '' ? mb_substr(trim($message), 0, 500) : null;
        DB::table('app_settings')->where('id', 1)->update([
            'site_off' => $off, 'site_off_message' => $message,
            'site_off_changed_at' => now()->format('Y-m-d H:i:s.u'), 'site_off_changed_by' => $by?->id,
        ]);
        self::$row = null;
        Audit::log($off ? 'site_off' : 'site_on', null, null, ['message' => $off ? $message : null, 'from' => $by ? 'power page' : 'server terminal'], $by?->id);
    }

    public static function forget(): void
    {
        self::$row = null;
    }
}

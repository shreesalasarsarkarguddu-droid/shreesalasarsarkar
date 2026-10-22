<?php

namespace App\AutoDeal\Support;

use Illuminate\Support\Facades\Schema;

/**
 * Auto Deal (used-vehicle stock and sales) as one switchable part of SSS. Everything it owns:
 *  - code: app/AutoDeal, routes/autodeal.php, config/autodeal.php, resources/autodeal, database/migrations/autodeal,
 *    public/autodeal-build (built screens), tests/Feature/AutoDeal
 *  - data: the ad_* tables below (and their rp_ad_* restore-point copies)
 *  - files: storage/app/public/autodeal (photos) and storage/app/private/autodeal (KYC documents)
 * AUTODEAL_ENABLED=false hides it without deleting anything; `php artisan autodeal:remove` takes it out for good.
 */
final class Module
{
    /** In the order they can be filled (a row's references come first). */
    public const TABLES = ['ad_branches', 'ad_sellers', 'ad_buyers', 'ad_vehicles', 'ad_vehicle_photos', 'ad_vehicle_transfers',
        'ad_sales', 'ad_sale_documents', 'ad_sale_payments', 'ad_branch_user', 'ad_activity_logs'];

    private static ?bool $installed = null;

    public static function enabled(): bool
    {
        return (bool) config('autodeal.enabled', true);
    }

    /** Its tables exist (migrated and not removed). */
    public static function installed(): bool
    {
        return self::$installed ??= Schema::hasTable('ad_vehicles');
    }

    /** [disk => folder] of its uploaded files. */
    public static function fileFolders(): array
    {
        return ['public' => 'autodeal', 'local' => 'autodeal'];
    }

    /** Where someone not signed in is sent: the SSS sign-in page. */
    public static function loginUrl(): string
    {
        $front = trim(explode(',', (string) config('cors.allowed_origins.0', ''))[0] ?? '');

        // no FRONTEND_URL: the SSS screens are on this same site (relative, so it also works behind the dev proxy)
        return config('autodeal.login_url') ?: rtrim($front, '/').'/login';
    }

    /** The SSS screens (back link in the header). */
    public static function homeUrl(): string
    {
        return preg_replace('#/login$#', '/accounts', self::loginUrl());
    }
}

<?php

namespace App\AutoDeal\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The shop's contact details (Auto Deal → Account → Shop details), shown on the public catalogue and on receipts.
 * Anything not filled in falls back to .env (DEALER_NAME, DEALER_ADDRESS, DEALER_PHONE, DEALER_GSTIN).
 */
class Shop
{
    public const FIELDS = ['shop_name', 'tagline', 'address', 'phone', 'phone2', 'whatsapp', 'email', 'gstin', 'map_url', 'hours', 'about'];

    private static ?array $cache = null;

    /** The saved row as typed (nulls for empty), for the form. */
    public static function saved(): array
    {
        $row = Schema::hasTable('ad_settings') ? DB::table('ad_settings')->orderBy('id')->first() : null;

        return array_combine(self::FIELDS, array_map(fn ($f) => $row?->$f, self::FIELDS));
    }

    /** What customers and paperwork see: the saved details over the .env ones. */
    public static function get(): array
    {
        if (self::$cache !== null) {
            return self::$cache;
        }
        $s = self::saved();

        return self::$cache = [
            'name' => $s['shop_name'] ?: config('autodeal.business_name'),
            'tagline' => $s['tagline'],
            'address' => $s['address'] ?: (config('autodeal.business_address') ?: null),
            'phone' => $s['phone'] ?: (config('autodeal.business_phone') ?: null),
            'phone2' => $s['phone2'],
            // WhatsApp enquiries go here; else to the main number
            'whatsapp' => $s['whatsapp'] ?: ($s['phone'] ?: (config('autodeal.business_phone') ?: null)),
            'email' => $s['email'],
            'gstin' => $s['gstin'] ?: (config('autodeal.business_gstin') ?: null),
            'map_url' => $s['map_url'],
            'hours' => $s['hours'],
            'about' => $s['about'],
        ];
    }

    public static function save(array $values): void
    {
        $row = array_combine(self::FIELDS, array_map(fn ($f) => ($v = trim((string) ($values[$f] ?? ''))) === '' ? null : $v, self::FIELDS));
        $id = DB::table('ad_settings')->orderBy('id')->value('id');
        $id ? DB::table('ad_settings')->where('id', $id)->update($row + ['updated_at' => now()])
            : DB::table('ad_settings')->insert($row + ['created_at' => now(), 'updated_at' => now()]);
        self::$cache = null;
    }
}

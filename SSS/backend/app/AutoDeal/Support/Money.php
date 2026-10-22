<?php

namespace App\AutoDeal\Support;

/** Indian digit grouping (12,34,567) to match the app's en-IN formatting. */
class Money
{
    public static function format(float|int|string|null $value, int $decimals = 0): string
    {
        $value = (float) $value;
        [$int, $frac] = array_pad(explode('.', number_format(abs($value), $decimals, '.', '')), 2, null);

        if (strlen($int) > 3) {
            // Last three digits, then groups of two: 1234567 → 12,34,567
            $int = preg_replace('/\B(?=(\d{2})+(?!\d))/', ',', substr($int, 0, -3)).','.substr($int, -3);
        }

        return ($value < 0 ? '-' : '').$int.($frac !== null ? ".{$frac}" : '');
    }

    /** "₹3,84,000" / "-₹950" */
    public static function inr(float|int|string|null $value, int $decimals = 0): string
    {
        return ((float) $value < 0 ? '-' : '').'₹'.self::format(abs((float) $value), $decimals);
    }
}

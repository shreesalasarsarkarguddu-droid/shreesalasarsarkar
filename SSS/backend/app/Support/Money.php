<?php

namespace App\Support;

/**
 * Money as integer paise, never floats. The database gives DECIMAL strings ("1234.50"); the API sends strings back.
 */
final class Money
{
    /** "1234.5" / "1234.50" / 1234 / null -> 123450 */
    public static function paise(string|int|float|null $v): int
    {
        if ($v === null || $v === '') {
            return 0;
        }
        if (is_int($v)) {
            return $v * 100;
        }
        $s = is_float($v) ? number_format($v, 2, '.', '') : trim($v);
        $neg = str_starts_with($s, '-');
        $s = ltrim($s, '+-');
        [$int, $frac] = array_pad(explode('.', $s, 2), 2, '');
        $frac = substr(str_pad($frac, 3, '0'), 0, 3);
        $p = ((int) $int) * 100 + intdiv((int) $frac + 5, 10); // round half up on the third decimal

        return $neg ? -$p : $p;
    }

    /** 123450 -> "1234.50" */
    public static function str(int $p): string
    {
        $neg = $p < 0;
        $p = abs($p);

        return ($neg ? '-' : '').intdiv($p, 100).'.'.str_pad((string) ($p % 100), 2, '0', STR_PAD_LEFT);
    }

    /** Postgres-style numeric for SQL parameters: same as str(). */
    public static function dec(string|int|float|null $v): string
    {
        return self::str(self::paise($v));
    }

    /** "₹1,21,768" (Indian grouping), for Telegram texts. */
    public static function inr(int $p): string
    {
        $neg = $p < 0;
        $p = abs($p);
        $int = (string) intdiv($p, 100);
        $last3 = substr($int, -3);
        $rest = substr($int, 0, -3);
        $grouped = $rest !== '' ? preg_replace('/\B(?=(\d{2})+(?!\d))/', ',', $rest).','.$last3 : $last3;
        $paise = $p % 100 ? '.'.str_pad((string) ($p % 100), 2, '0', STR_PAD_LEFT) : '';

        return ($neg ? '-' : '').'₹'.$grouped.$paise;
    }
}

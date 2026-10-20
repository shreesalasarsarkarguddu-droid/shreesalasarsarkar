<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Receipt books per zone (receipt_series). A receipt no. only has to be unique inside its book.
 * MAIN (zone null, book 1) = DHAMTARI: accounts with no zone, or a zone name not in the list.
 */
final class Receipts
{
    /** The zone text on an account (old = legacy_accounts by SNO, new = loans by id). */
    public static function refZone(?string $source, ?int $ref): ?string
    {
        return match ($source) {
            'old' => DB::table('legacy_accounts')->where('sno', $ref)->value('zone'),
            'new' => DB::table('loans')->where('id', $ref)->value('zone'),
            default => null,
        };
    }

    public static function acctZone(?int $acct, ?int $loan): ?string
    {
        return $acct ? DB::table('legacy_accounts')->where('id', $acct)->value('zone') : DB::table('loans')->where('id', $loan)->value('zone');
    }

    /** The open book of a zone name (MAIN's open book when the zone is blank or not a zone). */
    public static function openSeries(?string $zone): int
    {
        $z = trim((string) $zone);
        if ($z !== '') {
            $id = DB::table('receipt_series as s')->join('zones as z', 'z.id', '=', 's.zone_id')
                ->where('z.name', $z)->whereNull('s.closed_at')->value('s.id');
            if ($id) {
                return (int) $id;
            }
        }

        return self::ensureMain();
    }

    /** The first book of a zone, for receipts from the old software (MAIN's first book when no zone). */
    public static function historySeries(?string $zone): int
    {
        $z = trim((string) $zone);
        if ($z !== '') {
            $id = DB::table('receipt_series as s')->join('zones as z', 'z.id', '=', 's.zone_id')
                ->where('z.name', $z)->orderBy('s.book_no')->value('s.id');
            if ($id) {
                return (int) $id;
            }
        }

        return (int) (DB::table('receipt_series')->whereNull('zone_id')->orderBy('book_no')->value('id') ?? self::ensureMain());
    }

    /** MAIN must always exist. */
    public static function ensureMain(): int
    {
        $id = DB::table('receipt_series')->whereNull('zone_id')->whereNull('closed_at')->value('id');
        if ($id) {
            return (int) $id;
        }
        $book = (int) DB::table('receipt_series')->whereNull('zone_id')->max('book_no') + 1;

        return (int) DB::table('receipt_series')->insertGetId(['zone_id' => null, 'book_no' => $book, 'code' => $book === 1 ? 'MAIN' : "DHAMTARI-$book", 'start_no' => 1]);
    }

    /** What receipts show with their number ("NARHARPUR-2"); null for the first main book. */
    public static function code(int $series): ?string
    {
        $s = DB::table('receipt_series')->where('id', $series)->first(['zone_id', 'book_no', 'code']);

        return ! $s || ($s->zone_id === null && (int) $s->book_no === 1) ? null : $s->code;
    }

    /** Last receipt no. used in a book from its start number up (app, waiting, old software). */
    public static function seriesLast(int $series): ?int
    {
        $start = (int) DB::table('receipt_series')->where('id', $series)->value('start_no');
        $max = max(
            (int) DB::table('payments')->where('series_id', $series)->where('receipt_no', '>=', $start)->max('receipt_no'),
            (int) DB::table('pending_payments')->where('series_id', $series)->where('receipt_no', '>=', $start)->max('receipt_no'),
            (int) DB::table('legacy_payments')->where('series_id', $series)->where('receipt_no', '>=', $start)->max('receipt_no'),
        );

        return $max > 0 ? $max : null;
    }

    /** Is this receipt no. already used in the book (app payments, waiting payments, old software)? */
    public static function used(int $series, int $no, ?int $exceptPayment = null): bool
    {
        return DB::table('payments')->where('series_id', $series)->where('receipt_no', $no)->when($exceptPayment, fn ($q) => $q->where('id', '<>', $exceptPayment))->exists()
            || DB::table('pending_payments')->where('series_id', $series)->where('receipt_no', $no)->exists()
            || DB::table('legacy_payments')->where('series_id', $series)->where('receipt_no', $no)->exists();
    }

    /** Receipt numbers for the Collect window (public.receipt_hint). */
    public static function hint(?string $source, ?int $ref, string $userId): array
    {
        $s = DB::table('receipt_series')->where('id', self::openSeries(self::refZone($source, $ref)))->first();
        $max = fn ($q) => ($v = $q->max('receipt_no')) === null ? null : (int) $v;
        $lastApp = max($max(DB::table('payments')->where('series_id', $s->id)) ?? 0, $max(DB::table('pending_payments')->where('series_id', $s->id)) ?? 0);
        $lastMine = max($max(DB::table('payments')->where('series_id', $s->id)->where('created_by', $userId)) ?? 0,
            $max(DB::table('pending_payments')->where('series_id', $s->id)->where('created_by', $userId)) ?? 0);
        $books = [];
        foreach (DB::table('receipt_books')->where('user_id', $userId)->whereNull('closed_at')->where('series_id', $s->id)->orderBy('from_no')->get() as $b) {
            $usedNos = DB::table('payments')->where('series_id', $s->id)->whereBetween('receipt_no', [$b->from_no, $b->to_no])->pluck('receipt_no')
                ->merge(DB::table('pending_payments')->where('series_id', $s->id)->whereBetween('receipt_no', [$b->from_no, $b->to_no])->pluck('receipt_no'))
                ->map(fn ($v) => (int) $v)->flip();
            $next = null;
            for ($n = (int) $b->from_no; $n <= (int) $b->to_no; $n++) {
                if (! isset($usedNos[$n])) {
                    $next = $n;
                    break;
                }
            }
            $books[] = ['from' => (int) $b->from_no, 'to' => (int) $b->to_no, 'next' => $next];
        }
        $series = null;
        if ($s->zone_id !== null || (int) $s->book_no > 1) {
            $last = self::seriesLast($s->id);
            $series = [
                'code' => $s->code,
                'zone' => $s->zone_id ? DB::table('zones')->where('id', $s->zone_id)->value('name') : 'DHAMTARI',
                'book_no' => (int) $s->book_no,
                'start' => (int) $s->start_no,
                'last' => $last,
                'next' => $last !== null ? $last + 1 : (int) $s->start_no,
            ];
        }

        return [
            'last_app' => $lastApp ?: null,
            'last_mine' => $lastMine ?: null,
            'last_old' => $max(DB::table('legacy_payments')->where('series_id', $s->id)),
            'books' => $books,
            'series' => $series,
        ];
    }
}

<?php

namespace App\Rpc;

use App\Models\User;
use App\Services\Receipts;
use App\Support\Audit;
use App\Support\Perm;
use Illuminate\Support\Facades\DB;

/** People's receipt books, zones and their receipt books (main book = DHAMTARI). */
class Books
{
    // ---------------------------------------------------------------- people's receipt books

    /** public.receipt_book_status(): every book with its use and the numbers skipped below the last one used. */
    public function status(array $p, User $u): array
    {
        $q = DB::table('receipt_books as b')->join('users as s', 's.id', '=', 'b.user_id')->join('receipt_series as rs', 'rs.id', '=', 'b.series_id')
            ->orderByRaw('b.closed_at is not null')->orderBy('s.full_name')->orderBy('b.from_no');
        if (! Perm::can($u, 'cash')) {
            $q->where('b.user_id', $u->id);
        }
        $out = [];
        foreach ($q->get(['b.*', 's.full_name', 'rs.code']) as $b) {
            $used = DB::table('payments')->where('series_id', $b->series_id)->whereBetween('receipt_no', [$b->from_no, $b->to_no])->pluck('receipt_no')
                ->map(fn ($v) => (int) $v)->flip();
            $last = $used->isEmpty() ? null : max(array_keys($used->all()));
            $skipped = [];
            $count = 0;
            for ($n = (int) $b->from_no; $last !== null && $n <= $last; $n++) {
                if (! isset($used[$n])) {
                    $count++;
                    if (count($skipped) < 50) {
                        $skipped[] = $n;
                    }
                }
            }
            $out[] = ['id' => $b->id, 'user_id' => $b->user_id, 'full_name' => $b->full_name, 'from_no' => (int) $b->from_no, 'to_no' => (int) $b->to_no,
                'issued_on' => $b->issued_on, 'note' => $b->note, 'closed' => $b->closed_at !== null, 'used' => $used->count(), 'last_used' => $last,
                'skipped' => $skipped ?: null, 'skipped_count' => $count, 'book' => $b->code];
        }

        return $out;
    }

    /** public.admin_receipt_book(p): add | close | reopen | delete */
    public function book(array $p, User $u): array
    {
        $p = $p['p'] ?? $p;
        if (! Perm::can($u, 'cash')) {
            throw RpcError::notAllowed();
        }
        $action = $p['action'] ?? '';
        if ($action === 'add') {
            $who = DB::table('users')->where('id', $p['user_id'] ?? '')->first();
            if (! $who) {
                throw RpcError::bad('choose the person');
            }
            $from = (int) ($p['from_no'] ?? 0);
            $to = (int) ($p['to_no'] ?? 0);
            if ($from <= 0 || $to <= 0 || $to < $from) {
                throw RpcError::bad('enter the first and last receipt number');
            }
            if ($to - $from >= 10000) {
                throw RpcError::bad('a book can have at most 10,000 receipts');
            }
            $series = (int) ($p['series_id'] ?? 0) ?: Receipts::openSeries(null);
            $s = DB::table('receipt_series')->where('id', $series)->whereNull('closed_at')->lockForUpdate()->first();
            if (! $s) {
                throw RpcError::bad('choose an open zone book');
            }
            if (DB::table('receipt_books')->where('series_id', $series)->where('from_no', '<=', $to)->where('to_no', '>=', $from)->exists()) {
                throw RpcError::bad('these numbers overlap another receipt book');
            }
            $id = DB::table('receipt_books')->insertGetId(['user_id' => $who->id, 'from_no' => $from, 'to_no' => $to, 'issued_on' => now()->toDateString(),
                'note' => trim((string) ($p['note'] ?? '')) ?: null, 'series_id' => $series, 'created_by' => $u->id]);
            $b = DB::table('receipt_books')->where('id', $id)->first();
        } else {
            $b = DB::table('receipt_books')->where('id', (int) ($p['id'] ?? 0))->lockForUpdate()->first();
            if (! $b) {
                throw RpcError::notFound('receipt book not found');
            }
            $id = $b->id;
            if ($action === 'close') {
                DB::table('receipt_books')->where('id', $id)->update(['closed_at' => now()->format('Y-m-d H:i:s.u')]);
            } elseif ($action === 'reopen') {
                DB::table('receipt_books')->where('id', $id)->update(['closed_at' => null]);
            } elseif ($action === 'delete') {
                if (DB::table('payments')->where('series_id', $b->series_id)->whereBetween('receipt_no', [$b->from_no, $b->to_no])->exists()) {
                    throw RpcError::bad('receipts from this book are already used; close it instead');
                }
                DB::table('receipt_books')->where('id', $id)->delete();
            } else {
                throw RpcError::bad('bad action');
            }
        }
        Audit::log('book_'.$action, Audit::staffName($b->user_id), null, ['from_no' => (int) $b->from_no, 'to_no' => (int) $b->to_no, 'note' => $b->note,
            'book' => DB::table('receipt_series')->where('id', $b->series_id)->value('code')]);

        return ['id' => $id];
    }

    // ---------------------------------------------------------------- zones and their books

    private static function accountsIn(string $zone): int
    {
        return DB::table('loans')->where('zone', $zone)->count() + DB::table('legacy_accounts')->where('zone', $zone)->count();
    }

    private static function bookStats(int $series): array
    {
        $last = Receipts::seriesLast($series);
        $receipts = DB::table('payments')->where('series_id', $series)->count();

        return [$last, $receipts];
    }

    /** public.zone_status(): each zone with its open book, the next number and its old books. */
    public function zones(array $p, User $u): array
    {
        $out = [];
        foreach (DB::table('zones')->orderBy('name')->get() as $z) {
            $s = DB::table('receipt_series')->where('zone_id', $z->id)->whereNull('closed_at')->first();
            $last = $s ? Receipts::seriesLast($s->id) : null;
            $books = [];
            foreach (DB::table('receipt_series')->where('zone_id', $z->id)->whereNotNull('closed_at')->orderByDesc('book_no')->get() as $o) {
                $books[] = ['code' => $o->code, 'book_no' => (int) $o->book_no, 'start' => (int) $o->start_no, 'opened' => $o->opened_at, 'closed' => $o->closed_at,
                    'last' => Receipts::seriesLast($o->id),
                    'receipts' => DB::table('payments')->where('series_id', $o->id)->count() + DB::table('legacy_payments')->where('series_id', $o->id)->count()];
            }
            $out[] = [
                'id' => $z->id, 'name' => $z->name, 'active' => (bool) $z->active, 'accounts' => self::accountsIn($z->name),
                'book_id' => $s?->id, 'book_no' => $s ? (int) $s->book_no : null, 'book_code' => $s?->code, 'book_start' => $s ? (int) $s->start_no : null,
                'book_opened' => $s?->opened_at, 'last_used' => $last, 'next_no' => $s ? ($last !== null ? $last + 1 : (int) $s->start_no) : null,
                'receipts' => $s ? DB::table('payments')->where('series_id', $s->id)->count() + DB::table('pending_payments')->where('series_id', $s->id)->count() : 0,
                'books' => $books,
            ];
        }

        return $out;
    }

    /** public.admin_zone(p): add | rename | new_book | hide | show | delete */
    public function zone(array $p, User $u): array
    {
        $p = $p['p'] ?? $p;
        if (! $u->isAdmin()) {
            throw RpcError::notAllowed('only admin');
        }
        $action = $p['action'] ?? '';
        $name = mb_strtoupper(trim((string) ($p['name'] ?? '')));
        if (in_array($action, ['add', 'rename'], true) && $name === '') {
            throw RpcError::bad('enter the zone name');
        }
        $start = null;
        if (in_array($action, ['add', 'new_book'], true)) {
            $start = (int) ($p['receipt_start'] ?? 0);
            if ($start <= 0) {
                throw RpcError::bad('enter the first receipt number of the book');
            }
        }
        if ($action === 'add') {
            if (DB::table('zones')->where('name', $name)->exists()) {
                throw RpcError::bad('a zone with this name already exists');
            }
            if (DB::table('receipt_series')->where('code', "$name-1")->exists()) {
                throw RpcError::bad("a book named $name-1 already exists");
            }
            $id = DB::table('zones')->insertGetId(['name' => $name, 'receipt_start' => $start, 'created_by' => $u->id]);
            DB::table('receipt_series')->insert(['zone_id' => $id, 'book_no' => 1, 'code' => "$name-1", 'start_no' => $start, 'opened_by' => $u->id]);
            Audit::log('zone_add', $name, null, ['book' => "$name-1", 'start_no' => $start]);

            return ['id' => $id];
        }
        $z = DB::table('zones')->where('id', (int) ($p['id'] ?? 0))->lockForUpdate()->first();
        if (! $z) {
            throw RpcError::notFound('zone not found');
        }
        if ($action === 'new_book') {
            $cur = DB::table('receipt_series')->where('zone_id', $z->id)->whereNull('closed_at')->lockForUpdate()->first();
            $book = (int) DB::table('receipt_series')->where('zone_id', $z->id)->max('book_no') + 1;
            $now = now()->format('Y-m-d H:i:s.u');
            if ($cur) {
                DB::table('receipt_series')->where('id', $cur->id)->update(['closed_at' => $now]);
                DB::table('receipt_books')->where('series_id', $cur->id)->whereNull('closed_at')->update(['closed_at' => $now]);
            }
            DB::table('receipt_series')->insert(['zone_id' => $z->id, 'book_no' => $book, 'code' => "{$z->name}-$book", 'start_no' => $start, 'opened_by' => $u->id]);
            DB::table('zones')->where('id', $z->id)->update(['receipt_start' => $start]);
            Audit::log('zone_book', $z->name, null, ['book' => "{$z->name}-$book", 'start_no' => $start, 'closed' => $cur?->code]);
        } elseif ($action === 'rename') {
            if ($name !== $z->name && DB::table('zones')->where('name', $name)->exists()) {
                throw RpcError::bad('a zone with this name already exists');
            }
            DB::table('zones')->where('id', $z->id)->update(['name' => $name]);
            DB::table('loans')->where('zone', $z->name)->update(['zone' => $name]);
            DB::table('legacy_accounts')->where('zone', $z->name)->update(['zone' => $name]);
            Audit::log('zone_edit', $name, null, ['changes' => ['name' => ['from' => $z->name, 'to' => $name]]]);
        } elseif (in_array($action, ['hide', 'show'], true)) {
            DB::table('zones')->where('id', $z->id)->update(['active' => $action === 'show']);
            Audit::log("zone_$action", $z->name, null, []);
        } elseif ($action === 'delete') {
            if (self::accountsIn($z->name) > 0) {
                throw RpcError::bad('accounts are in this zone; hide it instead');
            }
            $books = DB::table('receipt_series')->where('zone_id', $z->id)->pluck('id');
            foreach (['payments', 'pending_payments', 'legacy_payments', 'receipt_books'] as $t) {
                if (DB::table($t)->whereIn('series_id', $books)->exists()) {
                    throw RpcError::bad("receipts were written in this zone's books; hide it instead");
                }
            }
            DB::table('receipt_series')->where('zone_id', $z->id)->delete();
            DB::table('zones')->where('id', $z->id)->delete();
            Audit::log('zone_delete', $z->name, null, []);
        } else {
            throw RpcError::bad('bad action');
        }

        return ['id' => $z->id];
    }

    /** public.main_book_status(): the DHAMTARI (main) book; "next" counts only receipts written in this app for book 1. */
    public function main(array $p, User $u): ?array
    {
        $s = DB::table('receipt_series')->where('id', Receipts::ensureMain())->first();
        $lastApp = max((int) DB::table('payments')->where('series_id', $s->id)->max('receipt_no'), (int) DB::table('pending_payments')->where('series_id', $s->id)->max('receipt_no')) ?: null;
        $books = [];
        foreach (DB::table('receipt_series')->whereNull('zone_id')->whereNotNull('closed_at')->orderByDesc('book_no')->get() as $o) {
            $books[] = ['code' => (int) $o->book_no === 1 ? 'MAIN' : $o->code, 'book_no' => (int) $o->book_no, 'start' => (int) $o->start_no, 'opened' => $o->opened_at,
                'closed' => $o->closed_at, 'last' => ($v = DB::table('payments')->where('series_id', $o->id)->max('receipt_no')) === null ? null : (int) $v,
                'receipts' => DB::table('payments')->where('series_id', $o->id)->count() + DB::table('legacy_payments')->where('series_id', $o->id)->count()];
        }
        $zones = DB::table('zones')->pluck('name')->all();

        return [
            'book_no' => (int) $s->book_no, 'book_code' => (int) $s->book_no === 1 ? 'MAIN' : $s->code, 'book_start' => (int) $s->start_no, 'book_opened' => $s->opened_at,
            'last_used' => $lastApp, 'next_no' => (int) $s->book_no === 1 ? ($lastApp === null ? null : $lastApp + 1) : ($lastApp === null ? (int) $s->start_no : $lastApp + 1),
            'receipts' => DB::table('payments')->where('series_id', $s->id)->count() + DB::table('pending_payments')->where('series_id', $s->id)->count(),
            'accounts' => DB::table('legacy_accounts')->where(fn ($q) => $q->whereNull('zone')->orWhereNotIn('zone', $zones))->count()
                + DB::table('loans')->where(fn ($q) => $q->whereNull('zone')->orWhereNotIn('zone', $zones))->count(),
            'books' => $books,
        ];
    }

    /** public.admin_main_book(p_start): open a new DHAMTARI book. */
    public function newMain(array $p, User $u): array
    {
        if (! $u->isAdmin()) {
            throw RpcError::notAllowed('only admin');
        }
        $start = (int) ($p['p_start'] ?? 0);
        if ($start <= 0) {
            throw RpcError::bad('enter the first receipt number of the book');
        }
        $cur = DB::table('receipt_series')->whereNull('zone_id')->whereNull('closed_at')->lockForUpdate()->first();
        $book = (int) DB::table('receipt_series')->whereNull('zone_id')->max('book_no') + 1;
        $code = "DHAMTARI-$book";
        if (DB::table('receipt_series')->where('code', $code)->exists()) {
            throw RpcError::bad("a book named $code already exists");
        }
        $now = now()->format('Y-m-d H:i:s.u');
        if ($cur) {
            DB::table('receipt_series')->where('id', $cur->id)->update(['closed_at' => $now]);
            DB::table('receipt_books')->where('series_id', $cur->id)->whereNull('closed_at')->update(['closed_at' => $now]);
        }
        DB::table('receipt_series')->insert(['zone_id' => null, 'book_no' => $book, 'code' => $code, 'start_no' => $start, 'opened_by' => $u->id]);
        Audit::log('zone_book', 'DHAMTARI', null, ['book' => $code, 'start_no' => $start, 'closed' => $cur ? ((int) $cur->book_no === 1 ? 'MAIN' : $cur->code) : null]);

        return ['book' => $code];
    }
}

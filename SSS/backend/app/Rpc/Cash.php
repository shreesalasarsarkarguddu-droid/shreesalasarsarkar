<?php

namespace App\Rpc;

use App\Models\User;
use App\Services\Notify;
use App\Services\Reports;
use App\Support\Audit;
use App\Support\Money;
use App\Support\Perm;
use Illuminate\Support\Facades\DB;

/** Daily cash: each person's collection on a day and the cash they handed in. */
class Cash
{
    /** Every payment (counted and waiting) a person took that day: [mode, amount, parts, waiting]. */
    private static function dayPayments(string $day, ?string $user = null): array
    {
        $rows = [];
        foreach (['payments' => false, 'pending_payments' => true] as $t => $waiting) {
            foreach (DB::table($t)->whereRaw('date(created_at) = ?', [$day])->when($user, fn ($q) => $q->where('created_by', $user))
                ->get(['created_by', 'payment_mode', 'paid_amount', 'parts']) as $r) {
                $rows[] = [$r->created_by, $r->payment_mode, $r->paid_amount, $r->parts, $waiting];
            }
        }

        return $rows;
    }

    private static function part(string $mode, string $amount, ?string $parts, string $want): int
    {
        if ($mode === 'SPLIT') {
            $t = 0;
            foreach (json_decode((string) $parts, true) ?? [] as $x) {
                $t += ($x['mode'] ?? '') === $want ? Money::paise((string) $x['amount']) : 0;
            }

            return $t;
        }

        return $mode === $want ? Money::paise($amount) : 0;
    }

    /** public.cash_day(p_day): everyone with cash people (all with "cash"; your own with "collect"). */
    public function day(array $p, User $u): array
    {
        $day = (string) ($p['p_day'] ?? now()->toDateString());
        $all = Perm::can($u, 'cash');
        if (! $all && ! Perm::can($u, 'collect')) {
            return [];
        }
        $pay = [];
        foreach (self::dayPayments($day) as [$by, $mode, $amt, $parts, $waiting]) {
            $x = $pay[$by] ?? ['n' => 0, 'cash' => 0, 'cheque' => 0, 'sbi' => 0, 'bank' => 0, 'total' => 0, 'pc' => 0, 'pa' => 0];
            $x['n']++;
            $x['cash'] += self::part($mode, $amt, $parts, 'CASH');
            $x['cheque'] += self::part($mode, $amt, $parts, 'CHEQUE');
            $x['sbi'] += self::part($mode, $amt, $parts, 'SBI');
            $x['bank'] += self::part($mode, $amt, $parts, 'BANK');
            $x['total'] += Money::paise($amt);
            if ($waiting) {
                $x['pc']++;
                $x['pa'] += Money::paise($amt);
            }
            $pay[$by] = $x;
        }
        $closings = DB::table('cash_closings')->where('day', $day)->get()->keyBy('user_id');
        $people = array_unique(array_merge(array_keys($pay), $closings->keys()->all()));
        $f = fn (int $v) => $v / 100;
        $rows = [];
        foreach (DB::table('users')->whereIn('id', $people)->orderBy('full_name')->get(['id', 'full_name']) as $s) {
            if (! $all && $s->id !== $u->id) {
                continue;
            }
            $x = $pay[$s->id] ?? ['n' => 0, 'cash' => 0, 'cheque' => 0, 'sbi' => 0, 'bank' => 0, 'total' => 0, 'pc' => 0, 'pa' => 0];
            $c = $closings[$s->id] ?? null;
            $rows[] = [
                'user_id' => $s->id, 'full_name' => $s->full_name, 'receipts' => $x['n'], 'cash' => $f($x['cash']), 'cheque' => $f($x['cheque']),
                'sbi' => $f($x['sbi']), 'bank' => $f($x['bank']), 'total' => $f($x['total']), 'closed' => $c !== null,
                'received_amount' => $c ? (float) $c->received_amount : null, 'expected_at_close' => $c ? (float) $c->expected_cash : null,
                'note' => $c?->note, 'received_by' => $c ? Audit::staffName($c->received_by) : null, 'received_at' => $c?->received_at,
                'pending_count' => $x['pc'], 'pending_amount' => $f($x['pa']),
            ];
        }

        return $rows;
    }

    /** public.cash_receive(p_user, p_day, p_amount, p_note): the cash this person handed in for the day. */
    public function receive(array $p, User $u): array
    {
        if (! Perm::can($u, 'cash')) {
            throw RpcError::notAllowed();
        }
        $amount = $p['p_amount'] ?? null;
        if ($amount === null || ! is_numeric($amount) || (float) $amount < 0) {
            throw RpcError::bad('enter the cash received');
        }
        $day = (string) ($p['p_day'] ?? '');
        if ($day > now()->toDateString()) {
            throw RpcError::bad('the day cannot be in the future');
        }
        $user = (string) ($p['p_user'] ?? '');
        $n = 0;
        $cash = 0;
        $other = 0;
        foreach (self::dayPayments($day, $user) as [, $mode, $amt, $parts]) {
            $n++;
            $c = Reports::cashPart($mode, $amt, $parts);
            $cash += $c;
            $other += Money::paise($amt) - $c;
        }
        $got = Money::paise((string) $amount);
        $note = trim((string) ($p['p_note'] ?? '')) ?: null;
        DB::table('cash_closings')->upsert([[
            'user_id' => $user, 'day' => $day, 'receipts' => $n, 'expected_cash' => Money::str($cash), 'expected_other' => Money::str($other),
            'received_amount' => Money::str($got), 'note' => $note, 'received_by' => $u->id, 'received_at' => now()->format('Y-m-d H:i:s.u'),
        ]], ['user_id', 'day'], ['receipts', 'expected_cash', 'expected_other', 'received_amount', 'note', 'received_by', 'received_at']);
        $name = Audit::staffName($user);
        $short = $cash - $got;
        Audit::log('cash_received', $name, null, ['day' => $day, 'expected_cash' => $cash / 100, 'received' => $got / 100, 'short' => $short / 100,
            'receipts' => $n, 'note' => $note]);
        Notify::text('payment', "💵 Cash handed in · $name · ".date('d/m/Y', strtotime($day))."\n"
            .'Collected in cash '.Money::inr($cash)." ($n receipts)\n".'Received '.Money::inr($got)
            .($short > 0 ? ' · SHORT '.Money::inr($short) : ($short < 0 ? ' · extra '.Money::inr(-$short) : ' · matches'))."\nBy {$u->full_name}", 'cash_received');

        return ['short' => $short / 100];
    }
}

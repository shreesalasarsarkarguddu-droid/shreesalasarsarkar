<?php

namespace App\Console\Commands;

use App\Services\AccountMath;
use App\Services\AccountQueries;
use App\Support\Money;
use Illuminate\Console\Command;

/**
 * Compare the Laravel maths with numbers taken from the live Supabase database (SSS/scripts/pg_parity.py).
 * Run on a database loaded with the same data (SSS/scripts/pull_from_supabase.py).
 */
class Parity extends Command
{
    protected $signature = 'sss:parity {file : JSON written by pg_parity.py}';

    protected $description = 'Check next-payment maths and account balances against the old database';

    public function handle(): int
    {
        $ref = json_decode(file_get_contents($this->argument('file')), true);
        $bad = 0;

        foreach ($ref['next_payment'] as $x) {
            $got = AccountMath::nextPayment($x['source'], (int) $x['ref'], Money::paise($x['amount']), $x['paid_date'], 1);
            $want = ['installment_no' => $x['installment_no'], 'due_date' => $x['due_date'], 'due_amount' => Money::dec($x['due_amount']),
                'balance_after' => Money::dec($x['balance_after']), 'delay_days' => $x['delay_days']];
            $have = $got === null ? null : ['installment_no' => $got['installment_no'], 'due_date' => $got['due_date'],
                'due_amount' => $got['due_amount'], 'balance_after' => $got['balance_after'], 'delay_days' => $got['delay_days']];
            if ($have != $want) {
                $bad++;
                $this->error("{$x['source']} {$x['ref']}: want ".json_encode($want).' got '.json_encode($have));
            }
        }
        $this->info(count($ref['next_payment']).' next payments checked');

        $mine = [];
        foreach (AccountQueries::all()->get() as $r) {
            $mine["{$r->source}:{$r->ref_id}"] = $r;
        }
        foreach ($ref['all_accounts'] as $x) {
            $r = $mine["{$x['source']}:{$x['ref_id']}"] ?? null;
            $want = [$x['ledger'], (int) $x['payments_count'], (bool) $x['seized'], Money::dec($x['total_paid']), Money::dec($x['balance'])];
            $have = $r ? [$r->ledger, (int) $r->payments_count, (bool) $r->seized, Money::dec($r->total_paid), Money::dec($r->balance)] : null;
            if ($have !== $want) {
                $bad++;
                if ($bad < 30) {
                    $this->error("{$x['source']} {$x['ref_id']}: want ".json_encode($want).' got '.json_encode($have));
                }
            }
        }
        $this->info(count($ref['all_accounts']).' accounts checked ('.count($mine).' here)');
        $bad ? $this->error("$bad differences") : $this->info('All match.');

        return $bad ? 1 : 0;
    }
}

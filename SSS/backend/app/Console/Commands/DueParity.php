<?php

namespace App\Console\Commands;

use App\Services\DueReport;
use App\Support\Money;
use Illuminate\Console\Command;

/** Compare DueReport with public.due_report rows from the live database (SSS/scripts/pg_due_parity.py). */
class DueParity extends Command
{
    protected $signature = 'sss:due-parity {file}';

    protected $description = 'Check the due report against the old database, every account and column';

    private const MONEY = ['emi', 'balance', 'arrears', 'finance_amount', 'interest_amount', 'other_charges', 'total_amount', 'total_paid'];

    public function handle(): int
    {
        $bad = 0;
        foreach (json_decode(file_get_contents($this->argument('file')), true) as $day => $want) {
            $mine = [];
            foreach (DueReport::run($day) as $r) {
                $mine["{$r['source']}:{$r['ref_id']}"] = $r;
            }
            foreach ($want as $w) {
                $h = $mine["{$w['source']}:{$w['ref_id']}"] ?? null;
                if (! $h) {
                    $bad++;
                    $this->error("$day {$w['source']} {$w['ref_id']}: missing");

                    continue;
                }
                foreach ($w as $col => $v) {
                    $a = in_array($col, self::MONEY, true) ? Money::dec((string) $v) : ($col === 'due_emis' ? (float) $v : $v);
                    $b = in_array($col, self::MONEY, true) ? Money::dec((string) $h[$col]) : ($col === 'due_emis' ? (float) $h[$col] : $h[$col]);
                    if ($a != $b) {
                        if (++$bad < 40) {
                            $this->error("$day {$w['source']} {$w['ref_id']} $col: want ".json_encode($v).' got '.json_encode($h[$col]));
                        }
                    }
                }
            }
            $this->info("$day: ".count($want).' accounts there, '.count($mine).' here');
        }
        $bad ? $this->error("$bad differences") : $this->info('All match.');

        return $bad ? 1 : 0;
    }
}

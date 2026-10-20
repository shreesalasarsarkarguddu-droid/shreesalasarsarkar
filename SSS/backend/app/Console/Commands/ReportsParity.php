<?php

namespace App\Console\Commands;

use App\Services\DueReport;
use App\Services\Reports;
use App\Support\Money;
use Illuminate\Console\Command;

/** Compare the report ports with the old database's output (SSS/scripts/pg_reports_parity.py). */
class ReportsParity extends Command
{
    protected $signature = 'sss:reports-parity {file}';

    protected $description = 'Check due report, dashboard, staff performance, day book and seized vehicles against the old database';

    private int $bad = 0;

    public function handle(): int
    {
        $ref = json_decode(file_get_contents($this->argument('file')), true);

        foreach ($ref['due'] as $day => $want) {
            $mine = collect(DueReport::run($day))->keyBy(fn ($r) => "{$r['source']}:{$r['ref_id']}")->all();
            $this->rows("due $day", $want, $mine, fn ($r) => "{$r['source']}:{$r['ref_id']}");
        }

        $d = Reports::dashboard($ref['dashboard']['day']);
        $this->same('dashboard', $ref['dashboard']['data'], json_decode(json_encode($d), true));

        $sp = $ref['staff_performance'];
        // (local test logins are not in the old database)
        $mine = collect(Reports::staffPerformance($sp['from'], $sp['to']))->keyBy('user_id')
            ->filter(fn ($r) => ! str_ends_with((string) \DB::table('users')->where('id', $r['user_id'])->value('email'), '@sss.test'))->all();
        $this->rows('staff', $sp['rows'], $mine, fn ($r) => $r['user_id']);

        $db = $ref['day_book'];
        $mine = Reports::dayBook($db['from'], $db['to']);
        $key = fn ($r) => "{$r['entry_date']}|{$r['kind']}|{$r['source']}|{$r['ref_id']}|{$r['receipt_no']}|"
            .Money::dec((string) (Money::paise((string) $r['debit']) ? $r['debit'] : $r['credit']));
        $this->rows('day book', $db['rows'], collect($mine)->keyBy($key)->all(), $key);
        $this->info('day book: '.count($db['rows']).' rows there, '.count($mine).' here');
        $op = Reports::dayBookOpening($db['from']);
        $this->same('opening', [Money::dec($db['opening'][0]), Money::dec($db['opening'][1])], [$op['debit'], $op['credit']]);

        $mine = collect(Reports::seized())->keyBy(fn ($r) => "{$r['source']}:{$r['ref_id']}")->all();
        $this->rows('seized', $ref['seized'], $mine, fn ($r) => "{$r['source']}:{$r['ref_id']}");

        $this->bad ? $this->error("{$this->bad} differences") : $this->info('All match.');

        return $this->bad ? 1 : 0;
    }

    private function rows(string $what, array $want, array $mine, callable $key): void
    {
        foreach ($want as $w) {
            $h = $mine[$key($w)] ?? null;
            if ($h === null) {
                $this->diff("$what {$key($w)}: missing here");

                continue;
            }
            foreach ($w as $col => $v) {
                if (! $this->eq($v, $h[$col] ?? null)) {
                    $this->diff("$what {$key($w)} $col: want ".json_encode($v).' got '.json_encode($h[$col] ?? null));
                }
            }
        }
        if (count($mine) !== count($want)) {
            $this->diff("$what: ".count($want).' rows there, '.count($mine).' here');
        }
        $this->info("$what: ".count($want).' rows checked');
    }

    private function same(string $what, mixed $want, mixed $have, string $path = ''): void
    {
        if (is_array($want) && is_array($have)) {
            foreach ($want as $k => $v) {
                $this->same($what, $v, $have[$k] ?? null, "$path.$k");
            }
            if (array_is_list($want) && count($want) !== count($have)) {
                $this->diff("$what$path: ".count($want).' items there, '.count($have).' here');
            }

            return;
        }
        if (! $this->eq($want, $have)) {
            $this->diff("$what$path: want ".json_encode($want).' got '.json_encode($have));
        }
    }

    /** Numbers compare by value (strings "12.50" == 12.5), times by their first 19 characters. */
    private function eq(mixed $a, mixed $b): bool
    {
        if (is_numeric($a) && is_numeric($b)) {
            return abs((float) $a - (float) $b) < 0.005;
        }
        if (is_string($a) && is_string($b) && preg_match('/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/', $a)) {
            // the old database answers in UTC ("+00:00"), MySQL keeps India time
            $ta = strtotime(str_replace('T', ' ', substr($a, 0, 19)).(preg_match('/[+-]\d{2}:\d{2}$/', $a, $m) ? $m[0] : '+05:30'));
            $tb = strtotime(str_replace('T', ' ', substr($b, 0, 19)).(preg_match('/[+-]\d{2}:\d{2}$/', $b, $m) ? $m[0] : '+05:30'));

            return $ta === $tb;
        }

        return $a == $b;
    }

    private function diff(string $msg): void
    {
        if (++$this->bad <= 40) {
            $this->error($msg);
        }
    }
}

<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Phase 2: reports (their numbers are checked against the old database by sss:reports-parity). */
class Phase2Test extends TestCase
{
    public function test_reports_need_the_reports_permission(): void
    {
        $this->as($this->staff('staff', ['view_accounts']));
        foreach (['/api/reports/due', '/api/reports/day-book', '/api/reports/seized', '/api/dashboard'] as $url) {
            $this->getJson($url)->assertStatus(403);
        }
        $this->as($this->staff('staff', ['reports']))->getJson('/api/staff-performance')->assertStatus(403);
        // dashboard also needs "view accounts"
        $this->as($this->staff('staff', ['reports']))->getJson('/api/dashboard')->assertStatus(403);
    }

    public function test_due_report_rows(): void
    {
        $this->as($this->staff('staff', ['reports']));
        $rows = $this->getJson('/api/reports/due?asof=2026-10-20')->assertOk()->json();
        $this->assertNotEmpty($rows);
        $r = $rows[0];
        foreach (['source', 'ref_id', 'folio', 'emi', 'balance', 'arrears', 'overdue_emis', 'due_emis', 'next_due', 'total_paid', 'late_days'] as $k) {
            $this->assertArrayHasKey($k, $r);
        }
        $this->assertMatchesRegularExpression('/^-?\d+\.\d{2}$/', $r['balance']);
        $this->assertIsBool($r['seized']);
    }

    public function test_day_book_period_and_totals(): void
    {
        $this->as($this->staff('staff', ['reports']));
        $this->getJson('/api/reports/day-book?from=2026-01-01&to=2026-10-20')->assertStatus(422);
        $d = $this->getJson('/api/reports/day-book?from=2026-10-01&to=2026-10-19')->assertOk()->json();
        $this->assertMatchesRegularExpression('/^\d+\.\d{2}$/', $d['opening']['debit']);
        $dates = array_column($d['entries'], 'entry_date');
        $sorted = $dates;
        sort($sorted);
        $this->assertSame($sorted, $dates);
        $this->assertTrue(collect($d['entries'])->every(fn ($e) => $e['entry_date'] >= '2026-10-01' && $e['entry_date'] <= '2026-10-19'));
    }

    public function test_day_book_cash_and_bank(): void
    {
        $this->as($this->admin());
        [$sno, , $acct] = $this->openOldAccount();
        $rno = $this->freeReceipt();
        // a split payment: 600 cash + 400 bank
        $this->postJson('/api/payments', $this->payment('old', $sno, '1000', $rno, ['payment_mode' => 'SPLIT',
            'parts' => [['mode' => 'CASH', 'amount' => '600', 'bank_name' => '', 'reference_no' => ''], ['mode' => 'BANK', 'amount' => '400', 'bank_name' => 'SBI', 'reference_no' => '']]]))
            ->assertOk();
        $day = now()->toDateString();
        $q = fn ($mode) => $this->getJson("/api/reports/day-book?from=$day&to=$day&mode=$mode")->assertOk()->json();
        $pick = fn ($d) => collect($d['entries'])->first(fn ($e) => (int) $e['receipt_no'] === $rno);

        $all = $q('all');
        $this->assertSame(['1000.00', '600.00', '400.00'], [$pick($all)['debit'], $pick($all)['cash'], $pick($all)['bank']]);
        $this->assertTrue(collect($all['entries'])->every(fn ($e) => bcadd($e['cash'], $e['bank'], 2) === bcadd($e['debit'], $e['credit'], 2)));
        $cash = $q('cash');
        $bank = $q('bank');
        $this->assertNotNull($pick($cash));
        $this->assertNotNull($pick($bank));
        $this->assertTrue(collect($cash['entries'])->every(fn ($e) => $e['cash'] !== '0.00'));
        $this->assertTrue(collect($bank['entries'])->every(fn ($e) => $e['bank'] !== '0.00'));
        $this->getJson("/api/reports/day-book?from=$day&to=$day&mode=nonsense")->assertOk()->assertJsonCount(count($all['entries']), 'entries');

        // the opening balance of each mode adds up to the whole
        $o = fn ($mode) => $q($mode)['opening'];
        [$a, $c, $b] = [$o('all'), $o('cash'), $o('bank')];
        $this->assertSame($a['debit'], bcadd($c['debit'], $b['debit'], 2));
        $this->assertSame($a['credit'], bcadd($c['credit'], $b['credit'], 2));
        $this->assertSame([$a['cash_debit'], $a['cash_credit']], [$c['debit'], $c['credit']]);
        $this->assertSame(['0.00', '0.00'], [$b['cash_debit'], $b['cash_credit']]);
        $this->assertNotNull($acct);
    }

    public function test_dashboard_is_kept_for_a_minute(): void
    {
        $this->as($this->staff('staff', ['reports', 'view_accounts']));
        DB::table('dashboard_cache')->delete();
        $a = $this->getJson('/api/dashboard')->assertOk()->json();
        $this->assertSame(now()->toDateString(), $a['day']);
        $this->assertSame(1, DB::table('dashboard_cache')->count());
        DB::table('dashboard_cache')->update(['data' => json_encode(['day' => 'cached'])]);
        $this->assertSame('cached', $this->getJson('/api/dashboard')->json('day'));
    }

    public function test_seized_filters(): void
    {
        $this->as($this->staff('staff', ['reports']));
        $all = $this->getJson('/api/reports/seized?status=all')->assertOk()->json();
        $pending = $this->getJson('/api/reports/seized')->json();
        $this->assertLessThanOrEqual(count($all), count($pending));
        $this->assertTrue(collect($pending)->every(fn ($r) => $r['ledger'] === 'pending'));
    }

    public function test_assign_from_the_due_report(): void
    {
        $collector = $this->staff('staff', ['collect']);
        $this->as($this->staff('staff', ['reports']));
        $this->postJson('/api/rpc/assign_collections', ['p_day' => now()->toDateString(), 'p_user' => $collector->id,
            'p_items' => [['source' => 'old', 'ref_id' => 1]], 'p_note' => ''])->assertStatus(403)->assertJsonPath('error.code', '42501');

        $this->as($this->staff('staff', ['reports', 'assign']));
        [$sno] = $this->openOldAccount();
        $body = ['p_day' => now()->toDateString(), 'p_user' => $collector->id, 'p_items' => [['source' => 'old', 'ref_id' => $sno]], 'p_note' => 'evening'];
        $this->postJson('/api/rpc/assign_collections', $body)->assertOk()->assertJsonPath('data.assigned', 1);
        $other = $this->staff('staff', ['collect']);
        $this->postJson('/api/rpc/assign_collections', ['p_user' => $other->id] + $body)->assertOk()->assertJsonPath('data.moved', 1);
        $this->assertSame($other->id, DB::table('collection_assignments')->where(['day' => now()->toDateString(), 'source' => 'old', 'ref_id' => $sno])->value('user_id'));
        $rows = $this->getJson('/api/assignments?day='.now()->toDateString())->json();
        $this->assertContains($sno, array_column($rows, 'ref_id'));

        $viewer = $this->staff('staff', ['view_accounts']);
        $this->postJson('/api/rpc/assign_collections', ['p_user' => $viewer->id] + $body)->assertStatus(422)
            ->assertJsonPath('error.message', 'this person cannot collect payments (give them "Collect payments" first)');
        $this->postJson('/api/rpc/assign_collections', ['p_day' => '2020-01-01'] + $body)->assertStatus(422);
        $this->postJson('/api/rpc/no_such_function')->assertStatus(404);
    }
}

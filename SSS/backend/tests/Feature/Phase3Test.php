<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Phase 3: approvals, daily cash, receipt books, zones, remarks, assign, my list. */
class Phase3Test extends TestCase
{
    private function rpc(string $name, array $params = [])
    {
        return $this->postJson("/api/rpc/$name", $params);
    }

    public function test_waiting_payment_is_approved_into_the_account(): void
    {
        $collector = $this->staff('staff', ['view_accounts', 'collect']);
        $this->as($collector);
        [$sno, $emi, $id] = $this->openOldAccount();
        $rno = $this->freeReceipt();
        $this->postJson('/api/payments', $this->payment('old', $sno, $emi, $rno))->assertJson(['pending' => true]);
        $pid = DB::table('pending_payments')->where('receipt_no', $rno)->value('id');

        // the collection man cannot approve
        $this->rpc('review_pending', ['p_ids' => [$pid], 'p_approve' => true, 'p_note' => ''])->assertStatus(403);

        $this->as($this->staff('staff', ['approve', 'view_accounts']));
        $list = $this->rpc('pending_approvals')->assertOk()->json('data');
        $row = collect($list)->firstWhere('id', $pid);
        $this->assertEquals((float) $emi, $row['paid_amount']);
        $this->assertStringStartsWith("SNO $sno · ", $row['subject']);
        $this->assertEquals((float) $emi, $row['cash_part']);

        $before = DB::table('payments')->where('legacy_account_id', $id)->count();
        $r = $this->rpc('review_pending', ['p_ids' => [$pid], 'p_approve' => true, 'p_note' => 'counted'])->assertOk()->json('data');
        $this->assertSame(1, $r['done']);
        $this->assertSame([], $r['failed']);
        $this->assertSame($before + 1, DB::table('payments')->where('legacy_account_id', $id)->count());
        $p = DB::table('payments')->where('receipt_no', $rno)->where('series_id', 1)->first();
        $this->assertSame($collector->id, $p->created_by); // counted for the person who collected
        $this->assertDatabaseMissing('pending_payments', ['id' => $pid]);
        $this->assertDatabaseHas('data_audit', ['action' => 'payments_approved', 'subject' => 'TEST STAFF']);
    }

    public function test_waiting_payment_reject_needs_a_reason(): void
    {
        $this->as($this->staff('staff', ['collect']));
        [$sno, $emi] = $this->openOldAccount();
        $rno = $this->freeReceipt();
        $this->postJson('/api/payments', $this->payment('old', $sno, $emi, $rno));
        $pid = DB::table('pending_payments')->where('receipt_no', $rno)->value('id');
        $this->as($this->staff('staff', ['approve']));
        $this->rpc('review_pending', ['p_ids' => [$pid], 'p_approve' => false, 'p_note' => ''])->assertStatus(422)->assertJsonPath('error.message', 'enter the reason');
        $this->rpc('review_pending', ['p_ids' => [$pid], 'p_approve' => false, 'p_note' => 'cash not given'])->assertOk()->assertJsonPath('data.done', 1);
        $this->assertDatabaseMissing('pending_payments', ['id' => $pid]);
        $this->assertDatabaseMissing('payments', ['receipt_no' => $rno, 'series_id' => 1]);
    }

    public function test_daily_cash(): void
    {
        $collector = $this->staff('staff', ['collect']);
        $this->as($collector);
        [$sno] = $this->openOldAccount();
        $this->postJson('/api/payments', $this->payment('old', $sno, '1000', $this->freeReceipt(), ['payment_mode' => 'SPLIT', 'parts' => [
            ['mode' => 'CASH', 'amount' => '600', 'bank_name' => '', 'reference_no' => ''],
            ['mode' => 'BANK', 'amount' => '400', 'bank_name' => 'SBI', 'reference_no' => ''],
        ]]))->assertOk();
        $mine = collect($this->rpc('cash_day', ['p_day' => now()->toDateString()])->assertOk()->json('data'));
        $this->assertSame([$collector->id], $mine->pluck('user_id')->all()); // a collection man sees only himself
        $this->assertSame(600.0, (float) $mine[0]['cash']);
        $this->assertSame(400.0, (float) $mine[0]['bank']);
        $this->assertSame(1, $mine[0]['pending_count']);
        $this->rpc('cash_receive', ['p_user' => $collector->id, 'p_day' => now()->toDateString(), 'p_amount' => 500, 'p_note' => ''])->assertStatus(403);

        $this->as($this->staff('staff', ['cash']));
        $this->assertSame(100.0, (float) $this->rpc('cash_receive', ['p_user' => $collector->id, 'p_day' => now()->toDateString(), 'p_amount' => 500, 'p_note' => 'short'])
            ->assertOk()->json('data.short'));
        $row = collect($this->rpc('cash_day', ['p_day' => now()->toDateString()])->json('data'))->firstWhere('user_id', $collector->id);
        $this->assertTrue($row['closed']);
        $this->assertSame(500.0, (float) $row['received_amount']);
        $this->rpc('cash_receive', ['p_user' => $collector->id, 'p_day' => now()->addDay()->toDateString(), 'p_amount' => 1, 'p_note' => ''])->assertStatus(422);
    }

    public function test_receipt_books(): void
    {
        $u = $this->staff('staff', ['collect']);
        $this->as($this->staff('staff', ['cash']));
        $this->rpc('admin_receipt_book', ['p' => ['action' => 'add', 'user_id' => $u->id, 'from_no' => 860000000, 'to_no' => 860000049, 'note' => 'book 1']])->assertOk();
        $this->rpc('admin_receipt_book', ['p' => ['action' => 'add', 'user_id' => $u->id, 'from_no' => 860000040, 'to_no' => 860000060, 'note' => '']])
            ->assertStatus(422)->assertJsonPath('error.message', 'these numbers overlap another receipt book');
        $book = collect($this->rpc('receipt_book_status')->json('data'))->firstWhere('from_no', 860000000);
        $this->assertSame(0, $book['used']);
        $this->assertSame('MAIN', $book['book']);
        $this->rpc('admin_receipt_book', ['p' => ['action' => 'close', 'id' => $book['id']]])->assertOk();
        $this->rpc('admin_receipt_book', ['p' => ['action' => 'delete', 'id' => $book['id']]])->assertOk();
        $this->assertDatabaseMissing('receipt_books', ['id' => $book['id']]);
    }

    public function test_zones_and_new_books(): void
    {
        $this->as($this->staff('staff', ['cash']));
        $this->rpc('admin_zone', ['p' => ['action' => 'add', 'name' => 'kurud', 'receipt_start' => 1]])->assertStatus(403);
        $this->as($this->admin());
        $id = $this->rpc('admin_zone', ['p' => ['action' => 'add', 'name' => ' kurud ', 'receipt_start' => 1]])->assertOk()->json('data.id');
        $this->rpc('admin_zone', ['p' => ['action' => 'add', 'name' => 'KURUD', 'receipt_start' => 5]])->assertStatus(422);
        $z = collect($this->rpc('zone_status')->json('data'))->firstWhere('id', $id);
        $this->assertSame(['KURUD-1', 1, 1], [$z['book_code'], $z['book_start'], $z['next_no']]);
        $this->rpc('admin_zone', ['p' => ['action' => 'new_book', 'id' => $id, 'receipt_start' => 500]])->assertOk();
        $z = collect($this->rpc('zone_status')->json('data'))->firstWhere('id', $id);
        $this->assertSame(['KURUD-2', 500, 'KURUD-1'], [$z['book_code'], $z['next_no'], $z['books'][0]['code']]);
        $this->rpc('admin_zone', ['p' => ['action' => 'delete', 'id' => $id]])->assertOk();

        $main = $this->rpc('main_book_status')->assertOk()->json('data');
        $this->assertSame('MAIN', $main['book_code']);
        $this->rpc('admin_main_book', ['p_start' => 1])->assertOk()->assertJsonPath('data.book', 'DHAMTARI-2');
        [$sno, $emi] = $this->openOldAccount();
        $this->postJson('/api/payments', $this->payment('old', $sno, $emi, 1))->assertOk();
        $this->assertSame('DHAMTARI-2', DB::table('payments')->where('receipt_no', 1)->orderByDesc('id')->value('receipt_book'));
    }

    public function test_account_zone(): void
    {
        [$sno] = $this->openOldAccount();
        $this->as($this->staff('staff', ['collect', 'view_accounts']));
        $this->rpc('set_account_zone', ['p_source' => 'old', 'p_ref' => $sno, 'p_zone' => 'narharpur'])->assertOk()->assertJsonPath('data.zone', 'NARHARPUR');
        $this->rpc('set_account_zone', ['p_source' => 'old', 'p_ref' => $sno, 'p_zone' => ''])->assertStatus(403);
        $this->assertSame('NARHARPUR-2', $this->getJson("/api/ledger/old/$sno")->json('receiptHint.series.code'));
        $this->as($this->admin());
        $this->rpc('set_account_zone', ['p_source' => 'old', 'p_ref' => $sno, 'p_zone' => ''])->assertOk()->assertJsonPath('data.zone', null);
        $this->rpc('set_account_zone', ['p_source' => 'old', 'p_ref' => $sno, 'p_zone' => 'NOWHERE'])->assertStatus(422);
        $this->assertTrue((bool) DB::table('legacy_accounts')->where('sno', $sno)->value('zone_set_in_app'));
    }

    public function test_remarks(): void
    {
        $writer = $this->staff('staff', ['collect']);
        $this->as($writer);
        [$sno] = $this->openOldAccount();
        $id = $this->rpc('add_remark', ['p' => ['source' => 'old', 'ref_id' => $sno, 'installment_no' => 3, 'remark' => 'salary par dega',
            'promise_date' => now()->addDays(2)->toDateString()]])->assertOk()->json('data.id');
        $this->rpc('add_remark', ['p' => ['source' => 'old', 'ref_id' => $sno, 'remark' => 'x']])->assertStatus(422);
        $this->rpc('add_remark', ['p' => ['source' => 'old', 'ref_id' => $sno, 'remark' => 'ok ok', 'promise_date' => '2020-01-01']])->assertStatus(422);
        $mine = $this->rpc('remarks_list', ['p_status' => 'open'])->json('data');
        $this->assertSame($id, $mine[0]['id']);
        $this->assertFalse($mine[0]['paid_after']);
        $promised = $this->rpc('remarks_list', ['p_promise' => now()->addDays(2)->toDateString(), 'p_status' => 'open'])->json('data');
        $this->assertCount(1, $promised);

        $other = $this->staff('staff', ['collect']);
        $this->as($other);
        $this->assertSame([], $this->rpc('remarks_list')->json('data')); // only their own
        $this->rpc('delete_remark', ['p_id' => $id])->assertStatus(403);
        $this->as($writer);
        $this->rpc('delete_remark', ['p_id' => $id])->assertOk();
        $this->assertDatabaseHas('data_audit', ['action' => 'remark_deleted']);
    }

    public function test_assign_and_my_list(): void
    {
        $collector = $this->staff('staff', ['collect', 'view_accounts']);
        $boss = $this->staff('staff', ['assign', 'reports']);
        $this->as($boss);
        $c = $this->rpc('assign_candidates', ['p_day' => now()->toDateString(), 'p_q' => '', 'p_filter' => 'overdue'])->assertOk()->json('data');
        $this->assertNotEmpty($c);
        $this->assertTrue(collect($c)->every(fn ($r) => $r['arrears'] > 0 && ! $r['seized']));
        $pick = array_slice($c, 0, 2);
        $this->rpc('assign_collections', ['p_day' => now()->toDateString(), 'p_user' => $collector->id,
            'p_items' => array_map(fn ($r) => ['source' => $r['source'], 'ref_id' => $r['ref_id']], $pick), 'p_note' => ''])->assertOk();
        $this->as($collector);
        $list = $this->rpc('collection_list', ['p_day' => now()->toDateString(), 'p_user' => $collector->id])->assertOk()->json('data');
        $this->assertCount(2, $list);
        $this->assertSame((float) $pick[0]['arrears'], (float) collect($list)->firstWhere('ref_id', $pick[0]['ref_id'])['arrears']);
        // someone else's list is not open to a collection man
        $this->rpc('collection_list', ['p_day' => now()->toDateString(), 'p_user' => null])->assertStatus(403);
        $this->as($boss);
        $ids = array_column($this->rpc('collection_list', ['p_day' => now()->toDateString(), 'p_user' => null])->json('data'), 'id');
        $this->assertSame(count($ids), $this->rpc('unassign_collections', ['p_ids' => $ids])->json('data'));
    }
}

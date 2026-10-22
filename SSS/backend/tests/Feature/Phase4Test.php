<?php

namespace Tests\Feature;

use App\Services\AccountMath;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Phase 4: admin fixes, money adjustments, seize / release, users, settings, activity, notifications. */
class Phase4Test extends TestCase
{
    private function rpc(string $name, array $params = [])
    {
        return $this->postJson("/api/rpc/$name", $params);
    }

    /** A payment taken by the admin on an open old account: [payment id, sno, legacy id]. */
    private function paid(): array
    {
        $this->as($this->admin());
        [$sno, $emi, $id] = $this->openOldAccount();
        $rno = $this->freeReceipt();
        $this->postJson('/api/payments', $this->payment('old', $sno, $emi, $rno))->assertOk();

        return [(int) DB::table('payments')->where('series_id', 1)->where('receipt_no', $rno)->value('id'), $sno, $id];
    }

    public function test_edit_payment_amount_and_split(): void
    {
        [$pid, , $acct] = $this->paid();
        $p = DB::table('payments')->where('id', $pid)->first();
        $base = ['paid_amount' => '5000', 'paid_date' => $p->paid_date, 'payment_mode' => 'CASH', 'receipt_no' => (string) $p->receipt_no,
            'reference_no' => '', 'bank_name' => '', 'installments_covered' => 1];
        $this->rpc('admin_edit_payment', ['p_id' => $pid, 'p' => $base, 'p_reason' => ''])->assertStatus(422)->assertJsonPath('error.message', 'enter the reason');
        $this->rpc('admin_edit_payment', ['p_id' => $pid, 'p' => $base, 'p_reason' => 'typed wrong'])->assertOk();
        $this->assertSame('5000.00', DB::table('payments')->where('id', $pid)->value('paid_amount'));
        $this->assertSame(AccountMath::owed($acct, null), (int) round(DB::table('payments')->where('legacy_account_id', $acct)->orderByDesc('installment_no')->value('balance_after') * 100));
        $log = DB::table('data_audit')->where('action', 'payment_edited')->orderByDesc('id')->first();
        $this->assertArrayHasKey('paid_amount', json_decode($log->details, true)['changes']);

        $split = ['payment_mode' => 'SPLIT', 'parts' => [['mode' => 'CASH', 'amount' => '3000', 'bank_name' => '', 'reference_no' => ''],
            ['mode' => 'BANK', 'amount' => '2000', 'bank_name' => 'SBI', 'reference_no' => '']]] + $base;
        $this->rpc('admin_edit_payment', ['p_id' => $pid, 'p' => $split, 'p_reason' => 'paid partly online'])->assertOk();
        $this->assertSame('SPLIT', DB::table('payments')->where('id', $pid)->value('payment_mode'));
        $split['parts'][1]['amount'] = '1000';
        $this->rpc('admin_edit_payment', ['p_id' => $pid, 'p' => $split, 'p_reason' => 'x x x'])->assertStatus(422)
            ->assertJsonPath('error.message', 'the parts must add up to the EMI amount and the charges');
        $this->rpc('admin_edit_payment', ['p_id' => $pid, 'p' => $base, 'p_reason' => 'back to cash'])->assertOk();
        $this->rpc('admin_edit_payment', ['p_id' => $pid, 'p' => $base, 'p_reason' => 'again'])->assertStatus(422)->assertJsonPath('error.message', 'nothing was changed');
        $this->rpc('admin_edit_payment', ['p_id' => $pid, 'p' => ['receipt_no' => '188'] + $base, 'p_reason' => 'number'])->assertStatus(422); // used in the old software

        $this->as($this->staff('staff', ['collect', 'money']));
        $this->rpc('admin_edit_payment', ['p_id' => $pid, 'p' => $base, 'p_reason' => 'no power'])->assertStatus(403);
    }

    public function test_cancel_payment_recalculates(): void
    {
        [$pid, , $acct] = $this->paid();
        $before = AccountMath::owed($acct, null);
        $amt = (int) round(DB::table('payments')->where('id', $pid)->value('paid_amount') * 100);
        $this->rpc('admin_cancel_payment', ['p_id' => $pid, 'p_reason' => 'entered twice'])->assertOk();
        $this->assertDatabaseMissing('payments', ['id' => $pid]);
        $this->assertSame($before + $amt, AccountMath::owed($acct, null));
        $this->assertSame('payment_cancelled', DB::table('data_audit')->orderByDesc('id')->value('action'));
    }

    public function test_late_fee_discount_reschedule_close_and_reopen(): void
    {
        $this->as($this->staff('staff', ['money', 'view_accounts']));
        [$sno, , $acct] = $this->openOldAccount();
        $owed = AccountMath::owed($acct, null);
        $this->rpc('admin_adjust', ['p' => ['source' => 'old', 'ref_id' => $sno, 'kind' => 'penalty', 'amount' => '500', 'reason' => 'late']])->assertOk();
        $this->assertSame($owed + 50000, AccountMath::owed($acct, null));
        $this->rpc('admin_adjust', ['p' => ['source' => 'old', 'ref_id' => $sno, 'kind' => 'discount', 'amount' => (string) ($owed / 100 + 1000), 'reason' => 'too much']])
            ->assertStatus(422);
        $d = $this->rpc('admin_adjust', ['p' => ['source' => 'old', 'ref_id' => $sno, 'kind' => 'discount', 'amount' => '200', 'reason' => 'good customer']])->assertOk()->json('data');
        $this->assertEquals(($owed + 30000) / 100, $d['owed']);
        $this->rpc('admin_adjust', ['p' => ['source' => 'old', 'ref_id' => $sno, 'kind' => 'reschedule', 'new_emi' => '1000', 'next_due' => '2026-12-01', 'reason' => 'hard time']])
            ->assertOk();
        $row = collect($this->getJson("/api/legacy-accounts/$sno")->json('account.adjustments'))->firstWhere('kind', 'reschedule');
        $this->assertSame('1000.00', $row['new_emi']);
        $closeId = $this->rpc('admin_adjust', ['p' => ['source' => 'old', 'ref_id' => $sno, 'kind' => 'settle', 'reason' => 'settled']])->assertOk()->json('data.id');
        $this->assertTrue(AccountMath::legacySettled($acct));
        $this->assertSame(0, AccountMath::owed($acct, null));
        $this->as($this->admin())->getJson("/api/ledger/old/$sno")->assertStatus(404); // closed: no more payments
        $this->as($this->staff('staff', ['money', 'view_accounts']));
        $this->rpc('admin_adjust', ['p' => ['source' => 'old', 'ref_id' => $sno, 'kind' => 'penalty', 'amount' => '1', 'reason' => 'x x x']])->assertStatus(422);
        $this->rpc('admin_cancel_adjustment', ['p_id' => $closeId, 'p_reason' => 'paid by mistake'])->assertOk();
        $this->assertFalse(AccountMath::legacySettled($acct));
        $this->assertSame('reopened', DB::table('data_audit')->orderByDesc('id')->value('action'));
    }

    public function test_edit_and_delete_loan(): void
    {
        $this->as($this->staff('staff', ['new_loan', 'fix_entries', 'view_accounts']));
        $values = ['folio_no' => 'T'.Str::random(5), 'zone' => '', 'dealer' => '', 'loan_type' => 'CASH', 'borrower_name' => 'ram', 'borrower_father' => 'shyam',
            'borrower_mobile' => '9876543210', 'borrower_dob' => '', 'borrower_address' => 'dhamtari', 'guarantor_name' => '', 'guarantor_father' => '',
            'guarantor_mobile' => '', 'guarantor_address' => '', 'vehicle_condition' => 'NEW', 'sold_by' => '', 'vehicle_model' => 'splendor', 'vehicle_color' => '',
            'chassis_no' => '', 'engine_no' => '', 'make_year' => '', 'vehicle_no' => '', 'insurance_expiry' => '', 'agreement_date' => '2026-10-20',
            'installments' => '12', 'interval_months' => '1', 'finance_amount' => '50000', 'interest_rate' => '12', 'agreement_amount' => '', 'hp_amount' => ''];
        $id = $this->postJson('/api/loans', ['idempotencyKey' => (string) Str::uuid(), 'values' => $values])->assertOk()->json('id');
        $this->rpc('admin_edit_loan', ['p_loan' => $id, 'p' => ['finance_amount' => '60000'] + $values, 'p_reason' => 'more finance'])->assertOk()
            ->assertJsonPath('data.total_amount', 67200);
        $this->assertSame('5600.00', DB::table('loans')->where('id', $id)->value('emi_amount'));
        $this->rpc('admin_edit_loan', ['p_loan' => $id, 'p' => ['finance_amount' => '60000'] + $values, 'p_reason' => 'again'])->assertStatus(422)
            ->assertJsonPath('error.message', 'nothing was changed');
        $this->rpc('admin_delete_loan', ['p_loan' => $id, 'p_reason' => 'wrong entry', 'p_confirm' => 'yes'])->assertStatus(422);
        $this->rpc('admin_delete_loan', ['p_loan' => $id, 'p_reason' => 'wrong entry', 'p_confirm' => 'DELETE'])->assertOk();
        $this->assertDatabaseMissing('loans', ['id' => $id]);
        $this->assertSame('loan_deleted', DB::table('data_audit')->orderByDesc('id')->value('action'));
    }

    public function test_seize_and_release(): void
    {
        $this->as($this->staff('staff', ['seize', 'view_accounts']));
        [$sno] = $this->openOldAccount();
        $body = ['source' => 'old', 'ref_id' => $sno, 'seize' => true, 'action_date' => now()->toDateString(), 'remarks' => '', 'idempotency_key' => (string) Str::uuid()];
        $this->rpc('set_seized', ['p' => $body])->assertOk()->assertJsonPath('data.replayed', false);
        $this->rpc('set_seized', ['p' => $body])->assertOk()->assertJsonPath('data.replayed', true);
        $this->rpc('set_seized', ['p' => ['idempotency_key' => (string) Str::uuid()] + $body])->assertStatus(422)->assertJsonPath('error.message', 'already seized');
        $this->assertTrue((bool) collect($this->as($this->staff('staff', ['view_accounts']))->getJson('/api/accounts?source=old&ledger=all&q='.$sno)->json('rows'))
            ->firstWhere('ref_id', $sno)['seized']);
        $this->as($this->staff('staff', ['seize']));
        $this->rpc('set_seized', ['p' => ['seize' => false, 'remarks' => '', 'idempotency_key' => (string) Str::uuid()] + $body])->assertStatus(422)
            ->assertJsonPath('error.message', 'enter the reason for releasing');
        $this->rpc('set_seized', ['p' => ['seize' => false, 'remarks' => 'paid up', 'idempotency_key' => (string) Str::uuid()] + $body])->assertOk();
        $this->assertSame('release', DB::table('data_audit')->orderByDesc('id')->value('action'));
    }

    public function test_users(): void
    {
        $this->as($this->staff('staff', ['view_accounts']));
        $this->rpc('admin_list_users')->assertStatus(403);
        $admin = $this->admin();
        $this->as($admin);
        $id = $this->rpc('admin_create_user', ['p_email' => ' New@Test.Local ', 'p_name' => 'NEW MAN', 'p_password' => 'secret-123',
            'p_role' => 'staff', 'p_perms' => ['collect', 'nonsense']])->assertOk()->json('data');
        $u = DB::table('users')->where('id', $id)->first();
        $this->assertSame('new@test.local', $u->email);
        $this->assertSame(['collect', 'view_accounts'], json_decode($u->permissions, true));
        $this->rpc('admin_create_user', ['p_email' => 'new@test.local', 'p_name' => 'X', 'p_password' => 'secret-123', 'p_role' => 'staff', 'p_perms' => []])
            ->assertStatus(422)->assertJsonPath('error.code', '23505');
        $this->rpc('admin_update_user', ['p_user' => $admin->id, 'p_name' => 'ME', 'p_role' => 'staff', 'p_active' => true, 'p_perms' => []])->assertStatus(422);
        $this->rpc('admin_set_password', ['p_user' => $id, 'p_password' => 'short'])->assertStatus(422);
        $this->rpc('admin_set_password', ['p_user' => $id, 'p_password' => 'another-123'])->assertOk();
        $this->assertNotNull(DB::table('users')->where('id', $id)->value('force_logout_at'));
        $this->rpc('admin_archive_user', ['p_user' => $id, 'p_archive' => true])->assertOk();
        $this->assertFalse((bool) DB::table('users')->where('id', $id)->value('active'));
        $this->rpc('admin_update_user', ['p_user' => $id, 'p_name' => 'NEW MAN', 'p_role' => 'staff', 'p_active' => true, 'p_perms' => []])->assertStatus(422)
            ->assertJsonPath('error.message', 'this user is removed; restore them first');
        $this->rpc('admin_archive_user', ['p_user' => $id, 'p_archive' => false])->assertOk();
        $this->postJson('/api/logout');
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/login', ['email' => 'new@test.local', 'password' => 'another-123'])->assertStatus(403); // still switched off
    }

    public function test_settings_and_notifications(): void
    {
        Http::fake(['api.telegram.org/*' => Http::response(['ok' => true]), '*' => Http::response(['status' => 'success'])]);
        $this->as($this->admin());
        $this->rpc('save_notification_settings', ['p' => ['telegram_bot_token' => '123:SECRET-TOKEN-ABCD', 'telegram_group_id' => '-100', 'telegram_enabled' => true,
            'tg_on_payment' => true, 'review_above' => '50000', 'tg_summary_hour' => 25]])->assertStatus(422);
        $this->rpc('save_notification_settings', ['p' => ['telegram_bot_token' => '123:SECRET-TOKEN-ABCD', 'telegram_group_id' => '-100', 'telegram_enabled' => true,
            'tg_on_payment' => true, 'review_above' => '50000']])->assertOk();
        $s = $this->rpc('get_notification_settings')->assertOk()->json('data');
        $this->assertSame('••••ABCD', $s['telegram_bot_token']);
        $this->assertEquals(50000, $s['review_above']);
        // saving the masked value keeps the real token
        $this->rpc('save_notification_settings', ['p' => ['telegram_bot_token' => '••••ABCD']])->assertOk();
        $this->assertSame('123:SECRET-TOKEN-ABCD', DB::table('app_settings')->value('telegram_bot_token'));

        $id = $this->rpc('send_test_notification', ['p_channel' => 'telegram'])->assertOk()->json('data');
        $this->assertSame('sent', DB::table('notification_log')->where('id', $id)->value('status'));
        $this->rpc('send_test_notification', ['p_channel' => 'whatsapp', 'p_mobile' => '123'])->assertStatus(422);

        [$sno, $emi] = $this->openOldAccount();
        $this->postJson('/api/payments', $this->payment('old', $sno, $emi, $this->freeReceipt()))->assertOk();
        $log = DB::table('notification_log')->where('event', 'payment')->orderByDesc('id')->first();
        $this->assertStringStartsWith('💰 Payment received', $log->message);
        $this->assertSame('sent', $log->status);
        Http::assertSent(fn ($r) => str_contains($r->url(), '/bot123:SECRET-TOKEN-ABCD/sendMessage') && $r['chat_id'] === '-100');
        $this->getJson('/api/notification-log')->assertOk();
    }

    public function test_activity_log(): void
    {
        $this->as($this->staff('staff', ['view_accounts']));
        $this->getJson('/api/activity')->assertStatus(403);
        [$pid] = $this->paid();
        $this->as($this->staff('staff', ['activity']));
        $r = $this->getJson('/api/activity?actions=payment&from='.now()->toDateString())->assertOk()->json();
        $this->assertGreaterThan(0, $r['total']);
        $this->assertSame('payment', $r['rows'][0]['action']);
        $this->assertIsArray($r['rows'][0]['details']);
        $this->assertSame(0, $this->getJson('/api/activity?q=nobody-has-this-name')->json('total'));
    }
}

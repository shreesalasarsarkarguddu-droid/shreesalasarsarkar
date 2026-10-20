<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Phase 1: sign in, accounts, account pages, collecting payments, new loans. */
class Phase1Test extends TestCase
{
    public function test_sign_in_and_out(): void
    {
        $u = $this->staff('staff', ['view_accounts']);
        $this->postJson('/api/login', ['email' => $u->email, 'password' => 'wrong-password'])->assertStatus(422)->assertJson(['ok' => false]);
        $this->postJson('/api/login', ['email' => $u->email, 'password' => 'local-test-password'])->assertOk()
            ->assertJsonPath('user.full_name', 'TEST STAFF')->assertJsonPath('user.permissions', ['view_accounts']);
        $this->getJson('/api/me')->assertOk()->assertJsonPath('user.email', $u->email);
        $this->postJson('/api/logout')->assertOk();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/me')->assertStatus(401);
    }

    public function test_switched_off_login_is_refused(): void
    {
        $u = $this->staff('staff', ['view_accounts']);
        $u->forceFill(['active' => false])->save();
        $this->postJson('/api/login', ['email' => $u->email, 'password' => 'local-test-password'])->assertStatus(403);
    }

    public function test_old_supabase_password_hash_works(): void
    {
        // a bcrypt hash written as Supabase does ($2a$), turned into $2y$ by the data move
        $hash = password_hash('secret-1234', PASSWORD_BCRYPT, ['cost' => 4]);
        $u = $this->staff();
        DB::table('users')->where('id', $u->id)->update(['password' => '$2y$'.substr(str_replace('$2y$', '$2a$', $hash), 4)]);
        $this->postJson('/api/login', ['email' => $u->email, 'password' => 'secret-1234'])->assertOk();
    }

    public function test_permissions_are_checked_on_the_server(): void
    {
        $this->as($this->staff('staff', ['reports']))->getJson('/api/accounts')->assertStatus(403);
        $this->as($this->staff('staff', ['view_accounts']))->getJson('/api/payments/pending')->assertStatus(403);
        $this->as($this->staff('staff', ['view_accounts']))->postJson('/api/loans', [])->assertStatus(403);
    }

    public function test_accounts_list_filters_and_search(): void
    {
        $this->as($this->staff('staff', ['view_accounts']));
        $all = $this->getJson('/api/accounts?source=all&ledger=all')->assertOk()->json();
        $this->assertSame(DB::table('legacy_accounts')->count() + DB::table('loans')->count(), $all['total']);
        $this->assertCount(20, $all['rows']);
        $this->assertTrue($all['rows'][0]['ref_id'] >= $all['rows'][1]['ref_id'] || $all['rows'][0]['source'] === 'new');

        $pending = $this->getJson('/api/accounts?source=old&ledger=pending')->json();
        foreach ($pending['rows'] as $r) {
            $this->assertSame('pending', $r['ledger']);
            $this->assertSame('old', $r['source']);
            $this->assertIsBool($r['seized']);
        }
        $name = DB::table('legacy_accounts')->orderByDesc('sno')->value('borrower_name');
        $found = $this->getJson('/api/accounts?source=all&ledger=all&q='.urlencode(strtolower(explode(' ', $name)[0])))->json();
        $this->assertGreaterThan(0, $found['total']);
    }

    public function test_old_account_page_data(): void
    {
        $this->as($this->staff('staff', ['view_accounts']));
        [$sno, , $id] = $this->openOldAccount();
        $d = $this->getJson("/api/legacy-accounts/$sno")->assertOk()->json();
        $this->assertSame($sno, $d['account']['sno']);
        $this->assertSame(DB::table('legacy_payments')->where('account_id', $id)->count(), count($d['account']['legacy_payments']));
        $this->assertIsArray($d['account']['data_flags']);
        $this->assertArrayHasKey('zone', $d['zoneInfo']);
        $this->getJson('/api/legacy-accounts/99999999')->assertStatus(404)->assertJson(['ok' => false]);
        $this->getJson('/api/legacy-accounts/abc')->assertStatus(404);
    }

    public function test_times_are_sent_as_iso_with_india_offset(): void
    {
        $this->as($this->staff('staff', ['view_accounts']));
        $loan = DB::table('loans')->value('id');
        $d = $this->getJson("/api/loans/$loan")->assertOk()->json();
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?\+05:30$/', $d['loan']['created_at']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}$/', $d['loan']['agreement_date']);
    }

    public function test_admin_payment_is_posted_with_number_due_date_and_balance(): void
    {
        $this->as($this->admin());
        [$sno, $emi, $id] = $this->openOldAccount();
        $rno = $this->freeReceipt();
        $before = DB::table('payments')->where('legacy_account_id', $id)->count();
        $body = $this->payment('old', $sno, $emi, $rno);
        $r = $this->postJson('/api/payments', $body)->assertOk()->assertJson(['ok' => true, 'pending' => false, 'receiptNo' => $rno])->json();
        $this->assertGreaterThan(0, $r['installmentNo']);
        $p = DB::table('payments')->where('receipt_no', $rno)->first();
        $this->assertSame($before + 1, DB::table('payments')->where('legacy_account_id', $id)->count());
        $this->assertNotNull($p->due_date);
        $this->assertNull($p->receipt_book); // main book
        $log = DB::table('data_audit')->where('action', 'payment')->orderByDesc('id')->first();
        $this->assertSame($rno, json_decode($log->details, true)['receipt_no']);
        $this->assertSame('TEST ADMIN', $log->by_name);
        $this->assertStringStartsWith("SNO $sno · ", $log->subject);

        // the same save sent again (double tap) does not save twice
        $this->postJson('/api/payments', $body)->assertOk();
        $this->assertSame($before + 1, DB::table('payments')->where('legacy_account_id', $id)->count());

        // the receipt no. cannot be used again in the same book
        $this->postJson('/api/payments', $this->payment('old', $sno, $emi, $rno))->assertStatus(422)
            ->assertJsonPath('fieldErrors.receipt_no', "Receipt no. $rno is already used.");
    }

    public function test_receipt_numbers_are_unique_only_inside_a_book(): void
    {
        $this->as($this->admin());
        $nar = DB::table('legacy_accounts as a')->where('a.ledger', 'pending')->where('a.zone', 'NARHARPUR')->where('a.emi_amount', '>', 0)
            ->whereNotExists(fn ($q) => $q->from('adjustments as x')->whereColumn('x.legacy_account_id', 'a.id')->where('x.kind', 'settle')->whereNull('x.cancelled_at'))
            ->first(['a.sno', 'a.emi_amount']);
        $this->assertNotNull($nar, 'needs a NARHARPUR account in the data');
        // 188 is already used in the main book, but NARHARPUR-2 starts at 188
        $this->postJson('/api/payments', $this->payment('old', (int) $nar->sno, $nar->emi_amount, 188))->assertOk();
        $this->assertSame('NARHARPUR-2', DB::table('payments')->where('receipt_no', 188)->where('series_id', '<>', 1)->value('receipt_book'));
        [$sno, $emi] = $this->openOldAccount();
        $this->postJson('/api/payments', $this->payment('old', $sno, $emi, 188))->assertStatus(422);

        $hint = $this->getJson("/api/ledger/old/{$nar->sno}")->assertOk()->json('receiptHint');
        $this->assertSame('NARHARPUR-2', $hint['series']['code']);
        $this->assertSame(189, $hint['series']['next']);
    }

    public function test_collection_man_payment_waits_for_approval(): void
    {
        $this->as($this->staff('staff', ['view_accounts', 'collect']));
        [$sno, $emi] = $this->openOldAccount();
        $rno = $this->freeReceipt();
        $this->postJson('/api/payments', $this->payment('old', $sno, $emi, $rno))->assertOk()->assertJson(['pending' => true]);
        $this->assertDatabaseHas('pending_payments', ['receipt_no' => $rno, 'source' => 'old', 'ref_id' => $sno]);
        $this->assertDatabaseMissing('payments', ['receipt_no' => $rno, 'series_id' => 1]);
        $w = $this->getJson("/api/legacy-accounts/$sno")->json('waiting');
        $this->assertSame($rno, end($w)['receipt_no']);
        // a waiting number is taken too
        $this->postJson('/api/payments', $this->payment('old', $sno, $emi, $rno))->assertStatus(422);
    }

    public function test_split_payment(): void
    {
        $this->as($this->admin());
        [$sno] = $this->openOldAccount();
        $rno = $this->freeReceipt();
        $bad = $this->payment('old', $sno, '1000', $rno, ['payment_mode' => 'SPLIT', 'parts' => [
            ['mode' => 'CASH', 'amount' => '700', 'bank_name' => '', 'reference_no' => ''],
            ['mode' => 'BANK', 'amount' => '200', 'bank_name' => 'SBI', 'reference_no' => ''],
        ]]);
        $this->postJson('/api/payments', $bad)->assertStatus(422)->assertJsonPath('fieldErrors.parts', 'The parts must add up to the amount.');
        $bad['parts'][1]['amount'] = '300';
        $bad['parts'][1]['bank_name'] = '';
        $this->postJson('/api/payments', $bad)->assertStatus(422)->assertJsonPath('fieldErrors.parts', 'Enter the bank name for the bank part.');
        $bad['parts'][1]['bank_name'] = 'SBI';
        $this->postJson('/api/payments', $bad)->assertOk();
        $p = DB::table('payments')->where('receipt_no', $rno)->first();
        $this->assertSame('SPLIT', $p->payment_mode);
        $this->assertSame('1000.00', $p->paid_amount);
        $this->assertSame(['CASH', 'BANK'], array_column(json_decode($p->parts, true), 'mode'));
    }

    public function test_payment_rules(): void
    {
        $this->as($this->admin());
        [$sno, $emi] = $this->openOldAccount();
        $this->postJson('/api/payments', $this->payment('old', $sno, $emi, $this->freeReceipt(), ['paid_date' => now()->addDay()->toDateString()]))
            ->assertStatus(422);
        $this->postJson('/api/payments', $this->payment('old', $sno, '0', $this->freeReceipt()))->assertStatus(422);
        $this->postJson('/api/payments', $this->payment('old', $sno, $emi, $this->freeReceipt(), ['payment_mode' => 'CHEQUE']))
            ->assertStatus(422)->assertJsonPath('fieldErrors.reference_no', 'Enter the cheque number');
        $closed = DB::table('legacy_accounts')->where('ledger', 'closed')->value('sno');
        $this->postJson('/api/payments', $this->payment('old', (int) $closed, '100', $this->freeReceipt()))->assertStatus(404);
        $this->getJson("/api/ledger/old/$closed")->assertStatus(404);
    }

    public function test_receipt_book_rules(): void
    {
        $u = $this->staff('staff', ['view_accounts', 'collect']);
        $other = $this->staff('staff', ['collect']);
        DB::table('receipt_books')->insert(['user_id' => $other->id, 'from_no' => 870000000, 'to_no' => 870000099, 'issued_on' => now()->toDateString(),
            'series_id' => 1, 'created_by' => $other->id]);
        $this->as($u);
        [$sno, $emi] = $this->openOldAccount();
        $this->postJson('/api/payments', $this->payment('old', $sno, $emi, 870000005))->assertStatus(422)
            ->assertJsonPath('error', "Receipt no. 870000005 belongs to TEST STAFF's receipt book.");
        DB::table('receipt_books')->insert(['user_id' => $u->id, 'from_no' => 870000100, 'to_no' => 870000199, 'issued_on' => now()->toDateString(),
            'series_id' => 1, 'created_by' => $u->id]);
        $this->postJson('/api/payments', $this->payment('old', $sno, $emi, 870000500))->assertStatus(422)
            ->assertJsonPath('error', 'Receipt no. 870000500 is not in your receipt book (870000100–870000199).');
        $this->postJson('/api/payments', $this->payment('old', $sno, $emi, 870000100))->assertOk();
        $this->assertSame(870000101, $this->getJson("/api/ledger/old/$sno")->json('receiptHint.books.0.next'));
    }

    public function test_new_loan(): void
    {
        $this->as($this->staff('staff', ['new_loan', 'view_accounts']));
        $key = (string) Str::uuid();
        $values = [
            'folio_no' => 'test-'.Str::random(5), 'zone' => '', 'dealer' => 'satyom', 'loan_type' => 'CASH', 'borrower_name' => 'ram kumar',
            'borrower_father' => 'shyam', 'borrower_mobile' => '9876543210', 'borrower_dob' => '1990-05-04', 'borrower_address' => 'dhamtari',
            'guarantor_name' => '', 'guarantor_father' => '', 'guarantor_mobile' => '', 'guarantor_address' => '', 'vehicle_condition' => 'NEW',
            'sold_by' => '', 'vehicle_model' => 'splendor', 'vehicle_color' => '', 'chassis_no' => '', 'engine_no' => '', 'make_year' => '2026',
            'vehicle_no' => '', 'insurance_expiry' => '', 'agreement_date' => '2026-10-20', 'installments' => '12', 'interval_months' => '1',
            'finance_amount' => '100000', 'interest_rate' => '18', 'agreement_amount' => '1800', 'hp_amount' => '800',
        ];
        $bad = $this->postJson('/api/loans', ['idempotencyKey' => $key, 'values' => ['borrower_mobile' => '123'] + $values])->assertStatus(422)->json();
        $this->assertSame('Enter a valid 10-digit mobile number', $bad['fieldErrors']['borrower_mobile']);
        $id = $this->postJson('/api/loans', ['idempotencyKey' => $key, 'values' => $values])->assertOk()->json('id');
        $l = DB::table('loans')->where('id', $id)->first();
        $this->assertSame(['18000.00', '120600.00', '10050.00'], [$l->interest_amount, $l->total_amount, $l->emi_amount]);
        $this->assertSame('RAM KUMAR', DB::table('borrowers')->where('id', $l->borrower_id)->value('full_name'));
        $this->assertSame(strtoupper($values['folio_no']), $l->folio_no);
        // retry with the same key returns the same loan; another key with the same folio is refused
        $this->assertSame($id, $this->postJson('/api/loans', ['idempotencyKey' => $key, 'values' => $values])->json('id'));
        $this->postJson('/api/loans', ['idempotencyKey' => (string) Str::uuid(), 'values' => $values])->assertStatus(422)
            ->assertJsonPath('fieldErrors.folio_no', 'This folio number is already used');
        // it can take payments right away
        $this->as($this->admin())->postJson('/api/payments', $this->payment('new', $id, '10050', $this->freeReceipt()))->assertOk()
            ->assertJson(['installmentNo' => 1]);
        $this->assertSame('110550.00', DB::table('payments')->where('loan_id', $id)->value('balance_after'));
        $this->assertSame('2026-11-20', DB::table('payments')->where('loan_id', $id)->value('due_date'));
    }

    public function test_change_password(): void
    {
        $u = $this->staff();
        $this->as($u)->postJson('/api/password', ['current' => 'nope', 'next' => 'new-password-1'])->assertStatus(422);
        $this->postJson('/api/password', ['current' => 'local-test-password', 'next' => 'new-password-1'])->assertOk();
        $this->assertTrue(password_verify('new-password-1', DB::table('users')->where('id', $u->id)->value('password')));
    }
}

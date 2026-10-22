<?php

namespace Tests\Feature;

use App\Services\AccountMath;
use App\Services\Reports;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/** OD (delay), seize and other charges on the same receipt as an EMI payment (supabase/migrations/..._payment_charges.sql). */
class ChargesTest extends TestCase
{
    private function rpc(string $name, array $params = [])
    {
        return $this->postJson("/api/rpc/$name", $params);
    }

    /** A new loan whose first EMI fell due some weeks ago (nothing paid yet). */
    private function lateLoan(): int
    {
        $values = ['folio_no' => 'CH'.random_int(10000, 99999), 'zone' => '', 'dealer' => '', 'loan_type' => 'CASH', 'borrower_name' => 'charges test',
            'borrower_father' => 'x', 'borrower_mobile' => '9876543210', 'borrower_dob' => '', 'borrower_address' => 'x', 'guarantor_name' => '',
            'guarantor_father' => '', 'guarantor_mobile' => '', 'guarantor_address' => '', 'vehicle_condition' => 'NEW', 'sold_by' => '', 'vehicle_model' => 'x',
            'vehicle_color' => '', 'chassis_no' => '', 'engine_no' => '', 'make_year' => '', 'vehicle_no' => '', 'insurance_expiry' => '',
            'agreement_date' => now()->subDays(70)->toDateString(), 'installments' => '12', 'interval_months' => '1', 'finance_amount' => '12000',
            'interest_rate' => '12', 'agreement_amount' => '', 'hp_amount' => ''];

        return (int) $this->postJson('/api/loans', ['idempotencyKey' => (string) Str::uuid(), 'values' => $values])->assertOk()->json('id');
    }

    public function test_od_seize_and_other_on_one_receipt(): void
    {
        $this->as($admin = $this->admin());
        DB::table('app_settings')->where('id', 1)->update(['od_per_day' => 10]);
        $loan = $this->lateLoan();
        $from = AccountMath::odFrom('new', $loan);
        $days = AccountMath::days($from, now()->toDateString());
        $this->assertGreaterThan(0, $days);
        $od = $days * 10;

        // the payment window gets the OD start and rate
        $this->getJson("/api/ledger/new/$loan")->assertOk()
            ->assertJsonPath('charges.od_from', $from)->assertJsonPath('charges.od_rate', 10)->assertJsonPath('charges.admin', true);

        // split: the parts cover EMI + OD + seize + other
        $rno = $this->freeReceipt();
        $total = 1000 + $od + 500 + 200;
        $body = $this->payment('new', $loan, '1000', $rno, ['payment_mode' => 'SPLIT', 'od_amount' => (string) $od, 'seize_amount' => '500',
            'other_amount' => '200', 'other_note' => 'RC transfer', 'parts' => [
                ['mode' => 'CASH', 'amount' => (string) ($total - 300), 'bank_name' => '', 'reference_no' => ''],
                ['mode' => 'BANK', 'amount' => '300', 'bank_name' => 'BOB', 'reference_no' => ''],
            ]]);
        $this->postJson('/api/payments', ['parts' => [['mode' => 'CASH', 'amount' => '1000'], ['mode' => 'SBI', 'amount' => '1']]] + $body)
            ->assertStatus(422)->assertJsonPath('fieldErrors.parts', 'The parts must add up to the EMI amount and the charges.');
        $this->postJson('/api/payments', $body)->assertOk();

        $p = DB::table('payments')->where('loan_id', $loan)->sole();
        $this->assertSame(['1000.00', (string) $od.'.00', $days, '500.00', '200.00', 'RC transfer', ($od + 700).'.00'],
            [$p->paid_amount, $p->od_amount, (int) $p->od_days, $p->seize_amount, $p->other_amount, $p->other_note, $p->charges]);
        // only the EMI part lowers the balance
        $this->assertEquals((float) DB::table('loans')->where('id', $loan)->value('total_amount') - 1000, (float) $p->balance_after);

        // Day Book: the whole money received, with the EMI part and the charges
        $e = collect(Reports::dayBook(now()->toDateString(), now()->toDateString()))->firstWhere('receipt_no', $rno);
        $this->assertSame([number_format($total, 2, '.', ''), number_format($total - 300, 2, '.', ''), '300.00', '1000.00', '500.00', 'RC transfer'],
            [$e['debit'], $e['cash'], $e['bank'], $e['emi'], $e['seize'], $e['other_note']]);
    }

    public function test_only_the_admin_changes_the_od_and_old_screens_take_none(): void
    {
        $this->as($this->admin());
        $loan = $this->lateLoan();
        DB::table('app_settings')->where('id', 1)->update(['od_per_day' => 10, 'require_receipt_books' => false, 'restrict_to_assigned' => false]);

        // a screen that sends no od_amount: no OD
        $this->postJson('/api/payments', $this->payment('new', $loan, '500', $this->freeReceipt()))->assertOk();
        $this->assertSame('0.00', DB::table('payments')->where('loan_id', $loan)->value('charges'));

        // collector without "approve": OD as worked out (now from EMI #2), or refused; waits for approval with its charges
        $od = AccountMath::days(AccountMath::odFrom('new', $loan), now()->toDateString()) * 10;
        $this->assertGreaterThan(0, $od);
        $coll = $this->staff('staff', ['collect', 'view_accounts']);
        $this->as($coll);
        $rno = $this->freeReceipt();
        $this->postJson('/api/payments', $this->payment('new', $loan, '500', $rno, ['od_amount' => '1']))
            ->assertStatus(422)->assertJsonPath('fieldErrors.od_amount', 'Only the admin can change the OD amount.');
        $this->postJson('/api/payments', $this->payment('new', $loan, '500', $rno, ['other_amount' => '50']))
            ->assertStatus(422)->assertJsonPath('fieldErrors.other_note', 'Write what the other charge is for.');
        $this->postJson('/api/payments', $this->payment('new', $loan, '500', $rno, ['od_amount' => (string) $od, 'other_amount' => '50', 'other_note' => 'Paper']))
            ->assertOk()->assertJsonPath('pending', true);
        $w = DB::table('pending_payments')->where('receipt_no', $rno)->sole();
        $this->assertSame([(string) $od.'.00', ($od + 50).'.00'], [$w->od_amount, $w->charges]);

        // the approval list and the cash count show the whole money
        $this->as($this->admin());
        $row = collect($this->rpc('pending_approvals')->json('data'))->firstWhere('receipt_no', $rno);
        $this->assertEquals(500 + $od + 50, $row['paid_amount']);
        $cash = collect($this->rpc('cash_day', ['p_day' => now()->toDateString()])->json('data'))->firstWhere('user_id', $coll->id);
        $this->assertEquals(500 + $od + 50, $cash['cash']);
        $this->rpc('review_pending', ['p_ids' => [$w->id], 'p_approve' => true, 'p_note' => ''])->assertOk()->assertJsonPath('data.done', 1);
        $p = DB::table('payments')->where('receipt_no', $rno)->sole();
        $this->assertSame([(string) $od.'.00', '50.00', 'Paper', ($od + 50).'.00'], [$p->od_amount, $p->other_amount, $p->other_note, $p->charges]);

        // the admin may take less (or more) OD; editing a split keeps the charges
        $rno2 = $this->freeReceipt();
        $this->postJson('/api/payments', $this->payment('new', $loan, '500', $rno2, ['od_amount' => '0']))->assertOk();
        $this->assertSame('0.00', DB::table('payments')->where('receipt_no', $rno2)->value('od_amount'));
        $edit = ['paid_amount' => '500', 'paid_date' => now()->toDateString(), 'payment_mode' => 'SPLIT', 'receipt_no' => (string) $rno,
            'installments_covered' => 1, 'parts' => [['mode' => 'CASH', 'amount' => '400'], ['mode' => 'SBI', 'amount' => (string) (100 + $od + 50)]]];
        $this->rpc('admin_edit_payment', ['p_id' => $p->id, 'p' => $edit, 'p_reason' => 'paid partly online'])->assertOk();
        $this->assertSame(($od + 50).'.00', DB::table('payments')->where('id', $p->id)->value('charges'));
    }

    public function test_settings_keep_the_od_rate(): void
    {
        $this->as($this->admin());
        $this->rpc('save_notification_settings', ['p' => ['od_per_day' => '15']])->assertOk();
        $this->rpc('get_notification_settings')->assertOk()->assertJsonPath('data.od_per_day', 15);
    }
}

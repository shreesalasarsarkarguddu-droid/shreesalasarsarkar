<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Admin: delete a new loan completely (payments too) after the reason, the folio no. and the delete PIN. */
class PurgeLoanTest extends TestCase
{
    private function rpc(string $name, array $params = [])
    {
        return $this->postJson("/api/rpc/$name", $params);
    }

    public function test_delete_a_loan_with_its_payments(): void
    {
        $this->as($admin = $this->admin());
        $folio = 'PT'.random_int(10000, 99999);
        $values = ['folio_no' => $folio, 'zone' => '', 'dealer' => '', 'loan_type' => 'CASH', 'borrower_name' => 'purge test', 'borrower_father' => 'x',
            'borrower_mobile' => '9876543210', 'borrower_dob' => '', 'borrower_address' => 'x', 'guarantor_name' => '', 'guarantor_father' => '',
            'guarantor_mobile' => '', 'guarantor_address' => '', 'vehicle_condition' => 'NEW', 'sold_by' => '', 'vehicle_model' => 'x', 'vehicle_color' => '',
            'chassis_no' => '', 'engine_no' => '', 'make_year' => '', 'vehicle_no' => '', 'insurance_expiry' => '', 'agreement_date' => now()->toDateString(),
            'installments' => '12', 'interval_months' => '1', 'finance_amount' => '10000', 'interest_rate' => '12', 'agreement_amount' => '', 'hp_amount' => ''];
        $loan = $this->postJson('/api/loans', ['idempotencyKey' => (string) Str::uuid(), 'values' => $values])->assertOk()->json('id');
        $bid = DB::table('loans')->where('id', $loan)->value('borrower_id');
        $this->postJson('/api/payments', $this->payment('new', $loan, '933.33', $this->freeReceipt()))->assertOk();
        $this->postJson('/api/payments', $this->payment('new', $loan, '933.33', $this->freeReceipt()))->assertOk();
        DB::table('visit_remarks')->insert(['source' => 'new', 'ref_id' => $loan, 'remark' => 'will pay monday', 'created_by' => $admin->id, 'created_at' => now()]);
        $staff = $this->staff('staff', ['collect', 'fix_entries', 'view_accounts']);
        DB::table('collection_assignments')->insert(['day' => now()->toDateString(), 'user_id' => $staff->id, 'source' => 'new', 'ref_id' => $loan,
            'created_by' => $admin->id, 'created_at' => now()]);

        $ok = ['p_loan' => $loan, 'p_reason' => 'test entry', 'p_folio' => strtolower(" $folio "), 'p_pin' => '334455'];
        $this->as($staff);
        $this->rpc('admin_purge_loan', $ok)->assertStatus(403);
        $this->as($admin);
        $this->rpc('admin_purge_loan', ['p_folio' => 'X1'] + $ok)->assertStatus(422)->assertJsonPath('error.message', "type the folio number $folio to confirm");
        $this->rpc('admin_purge_loan', ['p_pin' => '111111'] + $ok)->assertStatus(422)->assertJsonPath('error.message', 'wrong PIN');
        $this->rpc('admin_purge_loan', ['p_reason' => ''] + $ok)->assertStatus(422)->assertJsonPath('error.message', 'enter the reason');
        $this->assertDatabaseHas('loans', ['id' => $loan]);

        $r = $this->rpc('admin_purge_loan', $ok)->assertOk()->json('data');
        $this->assertSame([2, 1866.66], [$r['payments'], $r['paid']]);
        $this->assertDatabaseMissing('loans', ['id' => $loan]);
        $this->assertDatabaseMissing('borrowers', ['id' => $bid]);
        $this->assertSame(0, DB::table('payments')->where('loan_id', $loan)->count());
        $this->assertSame(0, DB::table('visit_remarks')->where('source', 'new')->where('ref_id', $loan)->count());
        $this->assertSame(0, DB::table('collection_assignments')->where('source', 'new')->where('ref_id', $loan)->count());
        $this->assertSame($r['restore_point'], DB::table('restore_points')->max('id'));
        $log = DB::table('data_audit')->orderByDesc('id')->first();
        $this->assertSame('loan_purged', $log->action);
        $d = json_decode($log->details, true);
        $this->assertSame(['payments' => 2, 'waiting' => 0, 'adjustments' => 0, 'seizures' => 0, 'remarks' => 1, 'assignments' => 1], $d['counts']);
        $this->assertCount(2, $d['payments']);
        $this->getJson("/api/loans/$loan")->assertStatus(404);
    }
}

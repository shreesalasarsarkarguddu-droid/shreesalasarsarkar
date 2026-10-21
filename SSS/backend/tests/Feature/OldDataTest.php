<?php

namespace Tests\Feature;

use App\Services\AccountMath;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Admin edit of data from the old software: account details, receipts, cancel, and an import again keeping the changes. */
class OldDataTest extends TestCase
{
    private function rpc(string $name, array $params = [])
    {
        return $this->postJson("/api/rpc/$name", $params);
    }

    /** A pending old account with 3+ receipts and no app payments: [legacy id, sno]. */
    private function account(): array
    {
        $a = DB::table('legacy_accounts as a')->where('a.ledger', 'pending')->where('a.legacy_payments_count', '>=', 3)
            ->whereNotExists(fn ($q) => $q->from('payments as p')->whereColumn('p.legacy_account_id', 'a.id'))
            ->orderByDesc('a.sno')->first(['a.id', 'a.sno']);

        return [(int) $a->id, (int) $a->sno];
    }

    private function form(int $id): array
    {
        $a = (array) DB::table('legacy_accounts')->where('id', $id)->first();
        $out = [];
        foreach (['fno', 'borrower_name', 'borrower_father', 'borrower_address', 'borrower_mobile', 'borrower_mobile2', 'guarantor_name', 'guarantor_father',
            'guarantor_address', 'guarantor_mobile', 'guarantor_mobile2', 'finance_mode', 'vehicle_condition', 'vehicle_model', 'vehicle_variant', 'chassis_no',
            'engine_no', 'model_year', 'registration_no', 'agreement_date', 'tenure_months', 'interval_months', 'finance_amount', 'interest_amount',
            'agreement_amount', 'hp_amount', 'total_amount', 'emi_amount'] as $k) {
            $out[$k] = $a[$k] === null ? '' : (string) $a[$k];
        }
        // the old software sometimes has a mobile that is not 10 digits; the form asks for a valid one
        foreach (['borrower_mobile', 'borrower_mobile2', 'guarantor_mobile', 'guarantor_mobile2'] as $k) {
            if (! preg_match('/^(\d{10})?$/', $out[$k])) {
                $out[$k] = '';
            }
        }
        $out['tenure_months'] = $out['tenure_months'] ?: '12';
        $out['interval_months'] = $out['interval_months'] ?: '1';

        return $out;
    }

    private function runningBalanceIsRight(int $id): bool
    {
        $a = DB::table('legacy_accounts')->where('id', $id)->first();
        $left = (int) round($a->total_amount * 100);
        foreach (DB::table('legacy_payments')->where('account_id', $id)->where('ledger', $a->ledger)->orderBy('installment_no')->orderBy('id')->get() as $r) {
            $left -= (int) round($r->paid_amount * 100);
            if ((int) round($r->balance_after * 100) !== $left) {
                return false;
            }
        }

        return (int) round($a->legacy_paid * 100) === (int) round(DB::table('legacy_payments')->where('account_id', $id)->where('ledger', $a->ledger)->sum('paid_amount') * 100);
    }

    public function test_only_admin(): void
    {
        [$id, $sno] = $this->account();
        $rid = DB::table('legacy_payments')->where('account_id', $id)->value('id');
        $this->as($this->staff('staff', ['fix_entries', 'money', 'view_accounts']));
        $this->rpc('admin_edit_legacy_account', ['p_sno' => $sno, 'p' => $this->form($id), 'p_reason' => 'x x x'])->assertStatus(403);
        $this->rpc('admin_edit_legacy_payment', ['p_id' => $rid, 'p' => [], 'p_reason' => 'x x x'])->assertStatus(403);
        $this->rpc('admin_cancel_legacy_payment', ['p_id' => $rid, 'p_reason' => 'x x x'])->assertStatus(403);
    }

    public function test_edit_account_details_and_amounts(): void
    {
        $this->as($this->admin());
        [$id, $sno] = $this->account();
        $owed = AccountMath::owed($id, null);
        $p = $this->form($id);
        $this->rpc('admin_edit_legacy_account', ['p_sno' => $sno, 'p' => $p, 'p_reason' => ''])->assertStatus(422)->assertJsonPath('error.message', 'enter the reason');
        $this->rpc('admin_edit_legacy_account', ['p_sno' => $sno, 'p' => ['borrower_mobile' => '12345'] + $p, 'p_reason' => 'x x x'])->assertStatus(422)
            ->assertJsonPath('error.message', 'a mobile number must be 10 digits');
        $this->rpc('admin_edit_legacy_account', ['p_sno' => $sno, 'p' => ['total_amount' => '0'] + $p, 'p_reason' => 'x x x'])->assertStatus(422);

        $p['borrower_mobile'] = '9999999999';
        $p['total_amount'] = (string) (round((float) $p['total_amount'] + 1000, 2));
        $p['registration_no'] = 'cg05 ab 1234';
        $r = $this->rpc('admin_edit_legacy_account', ['p_sno' => $sno, 'p' => $p, 'p_reason' => 'mobile and total corrected'])->assertOk()->json('data');
        $this->assertEquals(($owed + 100000) / 100, $r['owed']);
        $a = DB::table('legacy_accounts')->where('id', $id)->first();
        $this->assertSame('9999999999', $a->borrower_mobile);
        $this->assertSame('CG05 AB 1234', $a->registration_no);
        $this->assertTrue((bool) $a->edited_in_app);
        $this->assertTrue($this->runningBalanceIsRight($id));
        $log = DB::table('data_audit')->orderByDesc('id')->first();
        $this->assertSame('old_account_edited', $log->action);
        $this->assertArrayHasKey('total_amount', json_decode($log->details, true)['changes']);
        $this->rpc('admin_edit_legacy_account', ['p_sno' => $sno, 'p' => $p, 'p_reason' => 'again'])->assertStatus(422)->assertJsonPath('error.message', 'nothing was changed');
        $this->assertTrue($this->getJson("/api/legacy-accounts/$sno")->assertOk()->json('account.edited_in_app'));
    }

    public function test_edit_and_cancel_receipts(): void
    {
        $this->as($admin = $this->admin());
        [$id, $sno] = $this->account();
        $owed = AccountMath::owed($id, null);
        $first = DB::table('legacy_payments')->where('account_id', $id)->orderBy('installment_no')->first();
        $p = ['paid_amount' => (string) round($first->paid_amount + 50, 2), 'paid_date' => $first->paid_date, 'payment_mode' => 'sbi',
            'receipt_no' => (string) ($first->receipt_no ?? ''), 'cheque_no' => ''];
        $this->rpc('admin_edit_legacy_payment', ['p_id' => $first->id, 'p' => ['paid_date' => '2999-01-01'] + $p, 'p_reason' => 'x x x'])->assertStatus(422)
            ->assertJsonPath('error.message', 'paid date cannot be in the future');
        $r = $this->rpc('admin_edit_legacy_payment', ['p_id' => $first->id, 'p' => $p, 'p_reason' => 'amount was 50 more'])->assertOk()->json('data');
        $this->assertEquals(($owed - 5000) / 100, $r['owed']);
        $row = DB::table('legacy_payments')->where('id', $first->id)->first();
        $this->assertSame(['SBI', 1], [$row->payment_mode, (int) $row->edited_in_app]);
        $this->assertTrue($this->runningBalanceIsRight($id));
        $this->assertSame('old_receipt_edited', DB::table('data_audit')->orderByDesc('id')->value('action'));

        // a receipt number already used in the same book
        $used = DB::table('legacy_payments')->where('series_id', $first->series_id)->whereNotNull('receipt_no')->where('id', '<>', $first->id)->value('receipt_no');
        $this->rpc('admin_edit_legacy_payment', ['p_id' => $first->id, 'p' => ['receipt_no' => (string) $used] + $p, 'p_reason' => 'x x x'])->assertStatus(422)
            ->assertJsonPath('error.message', "receipt no. $used is already used in this book");

        $last = DB::table('legacy_payments')->where('account_id', $id)->orderByDesc('installment_no')->first();
        $r = $this->rpc('admin_cancel_legacy_payment', ['p_id' => $last->id, 'p_reason' => 'entered twice'])->assertOk()->json('data');
        $this->assertEquals(($owed - 5000 + (int) round($last->paid_amount * 100)) / 100, $r['owed']);
        $this->assertDatabaseMissing('legacy_payments', ['id' => $last->id]);
        $this->assertDatabaseHas('legacy_receipts_removed', ['sno' => $sno, 'installment_no' => $last->installment_no, 'removed_by' => $admin->id]);
        $this->assertTrue($this->runningBalanceIsRight($id));
        $this->assertSame('old_receipt_cancelled', DB::table('data_audit')->orderByDesc('id')->value('action'));
    }

    public function test_import_again_keeps_what_was_changed_here(): void
    {
        $this->as($this->admin());
        [$id, $sno] = $this->account();
        // the account and its receipts as the old-software files have them
        $acc = (array) DB::table('legacy_accounts')->where('id', $id)->first();
        $fileAcc = ['_file' => 'P_ACCOUNT', 'data_flags' => json_decode($acc['data_flags'], true), 'raw' => json_decode($acc['raw'], true)]
            + array_diff_key($acc, array_flip(['id', 'search_text', 'legacy_paid', 'legacy_payments_count', 'legacy_last_paid', 'edited_in_app', 'zone_set_in_app',
                'import_batch_id', 'data_flags', 'raw']));
        $filePay = DB::table('legacy_payments')->where('account_id', $id)->where('ledger', 'pending')->orderBy('installment_no')->get()
            ->map(fn ($r) => ['_file' => 'P_INSMENT', 'data_flags' => json_decode($r->data_flags, true), 'raw' => json_decode($r->raw, true)]
                + array_diff_key((array) $r, array_flip(['id', 'account_id', 'series_id', 'receipt_book', 'edited_in_app', 'import_batch_id', 'data_flags', 'raw'])))->all();

        // change the account, one receipt and cancel another here
        $p = $this->form($id);
        $p['borrower_mobile'] = '9999999999';
        $this->rpc('admin_edit_legacy_account', ['p_sno' => $sno, 'p' => $p, 'p_reason' => 'mobile corrected'])->assertOk();
        $first = DB::table('legacy_payments')->where('account_id', $id)->orderBy('installment_no')->first();
        $this->rpc('admin_edit_legacy_payment', ['p_id' => $first->id, 'p' => ['paid_amount' => (string) round($first->paid_amount + 50, 2), 'paid_date' => $first->paid_date,
            'payment_mode' => 'CASH', 'receipt_no' => (string) ($first->receipt_no ?? ''), 'cheque_no' => ''], 'p_reason' => 'amount'])->assertOk();
        $last = DB::table('legacy_payments')->where('account_id', $id)->orderByDesc('installment_no')->first();
        $this->rpc('admin_cancel_legacy_payment', ['p_id' => $last->id, 'p_reason' => 'twice'])->assertOk();

        $batch = fn ($n) => ['source_file' => 'X.DAT', 'total' => $n, 'imported' => $n, 'skipped' => 0, 'flagged' => 0, 'notes' => []];
        $sum = fn ($rows, $k) => number_format(array_sum(array_map(fn ($r) => (float) $r[$k], $rows)), 2, '.', '');
        $job = $this->rpc('admin_import_begin', [
            'p_batches' => ['F_ACC' => $batch(0), 'P_ACCOUNT' => $batch(1), 'F_INSMENT' => $batch(0), 'P_INSMENT' => $batch(count($filePay))],
            'p_checks' => ['F_ACC' => ['rows' => 0, 'total' => '0'], 'P_ACCOUNT' => ['rows' => 1, 'total' => (string) $acc['total_amount']],
                'F_INSMENT' => ['rows' => 0, 'total' => '0'], 'P_INSMENT' => ['rows' => count($filePay), 'total' => $sum($filePay, 'paid_amount')]],
        ])->json('data');
        $this->rpc('admin_import_stage', ['p_job' => $job, 'p_kind' => 'acc', 'p_rows' => [$fileAcc]])->assertOk();
        $this->rpc('admin_import_stage', ['p_job' => $job, 'p_kind' => 'pay', 'p_rows' => $filePay])->assertOk();
        $pv = $this->rpc('admin_import_preview', ['p_job' => $job])->assertOk()->json('data');
        $this->assertSame([0, 0, 1], [$pv['accounts']['changed'], $pv['accounts']['same'], $pv['accounts']['kept']]);
        $this->assertSame([1, 1], [$pv['receipts']['kept_edited'], $pv['receipts']['kept_cancelled']]);

        $this->rpc('admin_import_commit', ['p_job' => $job, 'p_confirm' => 'IMPORT', 'p_password' => 'local-test-password'])->assertOk()
            ->assertJsonPath('data.kept_accounts', 1)->assertJsonPath('data.kept_receipts', 2);
        $this->assertSame('9999999999', DB::table('legacy_accounts')->where('id', $id)->value('borrower_mobile'));
        $this->assertSame(round($first->paid_amount + 50, 2), (float) DB::table('legacy_payments')->where('id', $first->id)->value('paid_amount'));
        $this->assertSame(0, DB::table('legacy_payments')->where('sno', $sno)->where('installment_no', $last->installment_no)->count());
        $this->assertSame(count($filePay) - 1, DB::table('legacy_payments')->where('account_id', $id)->count());
    }
}

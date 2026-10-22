<?php

namespace Tests\Feature;

use App\Services\Backup;
use App\Services\DataStore;
use App\Services\ZipWriter;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Phase 5: restore points, delete, restore, backup zip, restore from a backup file, import from the old software. */
class Phase5Test extends TestCase
{
    private const PW = 'local-test-password';

    private function rpc(string $name, array $params = [])
    {
        return $this->postJson("/api/rpc/$name", $params);
    }

    public function test_restore_point_delete_and_restore(): void
    {
        $this->as($this->staff('staff', ['view_accounts']));
        $this->rpc('admin_data_overview')->assertStatus(403);
        $this->as($this->admin());
        $before = DataStore::counts();
        $this->assertGreaterThan(1000, $before['legacy_accounts']);

        $rp = $this->rpc('admin_create_restore_point')->assertOk()->json('data');
        $o = $this->rpc('admin_data_overview')->assertOk()->json('data');
        $this->assertSame($rp, $o['restore_points'][0]['id']);
        $this->assertEquals($before, $o['restore_points'][0]['counts']);
        $this->assertSame($before['legacy_payments'], DB::table('rp_legacy_payments')->where('rp_id', $rp)->count());

        $this->rpc('admin_delete_data', ['p_scope' => 'old', 'p_confirm' => 'DELETE', 'p_password' => 'wrong'])->assertStatus(422)
            ->assertJsonPath('error.message', 'your password is incorrect');
        $this->rpc('admin_delete_data', ['p_scope' => 'old', 'p_confirm' => 'delete', 'p_password' => self::PW])->assertStatus(422);
        $d = $this->rpc('admin_delete_data', ['p_scope' => 'old', 'p_confirm' => 'DELETE', 'p_password' => self::PW])->assertOk()->json('data');
        $this->assertSame(0, DB::table('legacy_accounts')->count());
        $this->assertSame(0, DB::table('legacy_payments')->count());
        $this->assertSame($before['loans'], DB::table('loans')->count());

        $r = $this->rpc('admin_restore', ['p_point' => $d['restore_point'], 'p_confirm' => 'RESTORE', 'p_password' => self::PW])->assertOk()->json('data');
        $this->assertEquals($before, DataStore::counts());
        $this->assertGreaterThan($d['restore_point'], $r['saved_before_restore']);
        $this->assertSame(0, (int) DB::table('rp_legacy_accounts')->where('rp_id', $r['saved_before_restore'])->count()); // the emptied state
        // search_text is generated again from the restored rows
        $this->assertNotEmpty(DB::table('legacy_accounts')->whereNotNull('search_text')->value('search_text'));
        $this->assertLessThanOrEqual(DataStore::KEEP, DB::table('restore_points')->count());
        $this->assertSame(['restore', 'delete', 'restore_point'], DB::table('data_audit')->orderByDesc('id')->limit(3)->pluck('action')->all());
    }

    public function test_backup_zip_download(): void
    {
        $this->as($this->staff('staff', ['view_accounts']));
        $this->get('/api/backup')->assertStatus(403);
        $this->as($this->staff('staff', ['backup']));
        $r = $this->get('/api/backup')->assertOk()->assertHeader('Content-Type', 'application/zip');
        $zip = $r->getContent();
        $this->assertStringStartsWith("PK\x03\x04", $zip);
        // the end record lists all 17 files (16 tables + README)
        $end = substr($zip, strrpos($zip, "PK\x05\x06"));
        $this->assertSame(count(Backup::tables()) + 1, unpack('v', substr($end, 10, 2))[1]);

        $enc = Backup::encrypt('hello backup', 'pass-1');
        $this->assertStringStartsWith('Salted__', $enc);
        $this->assertSame('hello backup', Backup::decrypt($enc, 'pass-1'));
        $this->assertNull(Backup::decrypt($enc, 'wrong'));

        $z = new ZipWriter;
        $z->add('a.txt', str_repeat('abc', 100));
        $b = $z->bytes();
        $this->assertSame(str_repeat('abc', 100), gzinflate(substr($b, 30 + 5, unpack('V', substr($b, 18, 4))[1])));
    }

    public function test_restore_from_backup_file(): void
    {
        $this->as($admin = $this->admin());
        // what the page sends: every CSV cell as text ("" for empty)
        $text = fn ($r) => array_map(fn ($v) => $v === null ? '' : (string) $v, (array) $r);
        $job = $this->rpc('admin_backup_begin', ['p_file' => 'salasar-backup.zip', 'p_taken' => 'Backup taken today'])->assertOk()->json('data');
        $this->rpc('admin_backup_stage', ['p_job' => $job, 'p_tbl' => 'users', 'p_rows' => [['id' => 'x']]])->assertStatus(422);
        foreach (DataStore::tables() as $t) {
            $rows = DB::table($t)->orderBy('id')->get()->map($text)->all();
            if ($t === 'zones' && $rows) {
                $rows[0]['old_column'] = 'x';
            }
            foreach (array_chunk($rows, 5000) as $chunk) {
                $this->rpc('admin_backup_stage', ['p_job' => $job, 'p_tbl' => $t, 'p_rows' => $chunk])->assertOk();
            }
        }
        $want = DataStore::counts();
        $pv = $this->rpc('admin_backup_preview', ['p_job' => $job])->assertOk()->json('data');
        $this->assertTrue($pv['has_accounts']);
        $this->assertSame($want['legacy_payments'], collect($pv['tables'])->firstWhere('table', 'legacy_payments')['in_backup']);
        if ($want['zones']) {
            $this->assertSame(['old_column'], collect($pv['tables'])->firstWhere('table', 'zones')['ignored_columns']);
        }

        // things done after the backup are undone by restoring it
        $pid = DB::table('payments')->value('id');
        DB::table('payments')->where('id', $pid)->delete();
        $paid = DB::table('legacy_accounts')->where('sno', DB::table('legacy_accounts')->max('sno'))->value('legacy_paid');
        DB::table('legacy_accounts')->update(['legacy_paid' => 0]);

        $this->rpc('admin_backup_commit', ['p_job' => $job, 'p_confirm' => 'RESTORE', 'p_password' => 'nope'])->assertStatus(422);
        $res = $this->rpc('admin_backup_commit', ['p_job' => $job, 'p_confirm' => 'RESTORE', 'p_password' => self::PW])->assertOk()->json('data');
        $this->assertEquals($want, DataStore::counts());
        $this->assertTrue(DB::table('payments')->where('id', $pid)->exists());
        $this->assertSame($paid, DB::table('legacy_accounts')->where('sno', DB::table('legacy_accounts')->max('sno'))->value('legacy_paid'));
        $this->assertSame('restore_file', DB::table('data_audit')->orderByDesc('id')->value('action'));
        $this->assertSame($res['saved_before_restore'], DB::table('restore_points')->max('id'));
        $this->rpc('admin_backup_commit', ['p_job' => $job, 'p_confirm' => 'RESTORE', 'p_password' => self::PW])->assertStatus(422)
            ->assertJsonPath('error.message', 'this backup was already restored');
        $this->assertNotNull($admin);
    }

    public function test_old_app_backup_values_are_converted(): void
    {
        $admin = (string) DB::table('users')->value('id');
        $people = [$admin => true];
        $r = DataStore::convert('payments', ['created_at' => '2026-10-20 06:23:00.5+00', 'created_by' => '00000000-1111-2222-3333-444444444444',
            'parts' => '', 'reference_no' => '', 'paid_date' => '2026-10-20T00:00:00'], $admin, $people);
        $this->assertSame('2026-10-20 11:53:00.500000', $r['created_at']);
        $this->assertSame($admin, $r['created_by']);
        $this->assertNull($r['parts']);
        $this->assertSame('2026-10-20', $r['paid_date']);
        $a = DataStore::convert('legacy_accounts', ['data_flags' => '{mobile_missing,"fno shared"}', 'seized' => 't', 'raw' => '{"A": 1}',
            'zone_set_in_app' => 'false', 'agreement_date' => ''], $admin, $people);
        $this->assertSame('["mobile_missing","fno shared"]', $a['data_flags']);
        $this->assertSame(1, $a['seized']);
        $this->assertSame(0, $a['zone_set_in_app']);
        $this->assertSame('{"A": 1}', $a['raw']);
        $this->assertNull($a['agreement_date']);
        $this->assertSame('[]', DataStore::convert('legacy_payments', ['data_flags' => '{}'], $admin, $people)['data_flags']);
        $t = DataStore::convert('zones', ['created_at' => '2026-10-20T06:23:00.000Z'], $admin, $people);
        $this->assertSame('2026-10-20 11:53:00.000000', $t['created_at']);
    }

    public function test_import_from_old_software(): void
    {
        $this->as($this->admin());
        $e = DB::table('legacy_accounts')->where('ledger', 'pending')->orderByDesc('sno')->first();
        $s = DB::table('legacy_accounts')->where('ledger', 'pending')->where('seized', 1)->orderBy('sno')->first(); // unchanged, seized = true in the file
        $newSno = (int) DB::table('legacy_accounts')->max('sno') + 1000;
        $acc = function (array $base, string $file, string $ledger) {
            $row = ['_file' => $file, 'ledger' => $ledger, 'recovery' => 'OK', 'data_flags' => [], 'raw' => ['SNO' => $base['sno']]];
            foreach (['sno', 'fno', 'fcode', 'borrower_name', 'borrower_father', 'borrower_address', 'borrower_mobile', 'borrower_mobile2', 'guarantor_name',
                'guarantor_father', 'guarantor_address', 'guarantor_mobile', 'guarantor_mobile2', 'finance_mode', 'zone', 'vehicle_condition', 'vehicle_model',
                'vehicle_variant', 'chassis_no', 'engine_no', 'model_year', 'registration_no', 'agreement_date', 'tenure_months', 'interval_months',
                'finance_amount', 'interest_amount', 'agreement_amount', 'hp_amount', 'total_amount', 'emi_amount', 'seized'] as $k) {
                $row[$k] = $base[$k] ?? null;
            }

            return $row;
        };
        $changed = $acc(['borrower_mobile' => '9999999999'] + (array) $e, 'P_ACCOUNT', 'pending');
        $changed['seized'] = $e->seized === null ? null : (bool) $e->seized;
        $same = $acc((array) $s, 'P_ACCOUNT', 'pending');
        $same['seized'] = true;
        $same['data_flags'] = json_decode($s->data_flags, true);
        $fresh = $acc(['sno' => $newSno, 'fno' => $newSno, 'borrower_name' => 'NEW TEST', 'finance_amount' => '1000.00', 'interest_amount' => '100.00',
            'agreement_amount' => '0.00', 'hp_amount' => '0.00', 'total_amount' => '1100.00', 'emi_amount' => '110.00', 'tenure_months' => 10,
            'interval_months' => 1, 'agreement_date' => '2026-01-01'], 'F_ACC', 'closed');
        $pay = fn ($sno, $file, $ledger, $no, $amt) => ['_file' => $file, 'ledger' => $ledger, 'sno' => $sno, 'installment_no' => $no, 'due_amount' => $amt,
            'due_date' => '2026-02-01', 'paid_amount' => $amt, 'paid_date' => '2026-02-0'.$no, 'balance_after' => '0.00', 'delay_days' => 0,
            'payment_mode' => 'CASH', 'cheque_no' => null, 'receipt_no' => 990000 + $no, 'data_flags' => [], 'raw' => ['INO' => $no]];
        $pays = [$pay($newSno, 'F_INSMENT', 'closed', 1, '550.00'), $pay($newSno, 'F_INSMENT', 'closed', 2, '550.00'), $pay($e->sno, 'P_INSMENT', 'pending', 1, '10.00')];
        $batch = fn ($f, $n) => ['source_file' => "$f.DAT", 'total' => $n, 'imported' => $n, 'skipped' => 0, 'flagged' => 0, 'notes' => ['skipped' => []]];
        $checks = ['F_ACC' => ['rows' => 1, 'total' => '1100'], 'P_ACCOUNT' => ['rows' => 2, 'total' => \App\Support\Money::str(\App\Support\Money::paise($e->total_amount) + \App\Support\Money::paise($s->total_amount))],
            'F_INSMENT' => ['rows' => 2, 'total' => '1100.00'], 'P_INSMENT' => ['rows' => 1, 'total' => '10']];
        $batches = ['F_ACC' => $batch('F_ACCOUNT', 1), 'P_ACCOUNT' => $batch('P_ACCOUNT', 2), 'F_INSMENT' => $batch('F_INSMENT', 2), 'P_INSMENT' => $batch('P_INSMENT', 1)];
        $paidBefore = DB::table('legacy_payments')->whereIn('sno', [$e->sno, $s->sno])->count();
        $sPaid = DB::table('legacy_payments')->where('sno', $s->sno)->count();
        $others = DB::table('legacy_payments')->whereNotIn('sno', [$e->sno, $s->sno])->count();

        $job = $this->rpc('admin_import_begin', ['p_batches' => $batches, 'p_checks' => $checks])->assertOk()->json('data');
        $this->rpc('admin_import_stage', ['p_job' => $job, 'p_kind' => 'acc', 'p_rows' => [$changed, $fresh, $same]])->assertOk()->assertJsonPath('data', 3);
        $this->rpc('admin_import_stage', ['p_job' => $job, 'p_kind' => 'pay', 'p_rows' => $pays])->assertOk();
        $pv = $this->rpc('admin_import_preview', ['p_job' => $job])->assertOk()->json('data');
        $this->assertSame(['in_files' => 3, 'new' => 1, 'changed' => 1, 'same' => 1, 'kept' => 0, 'moved' => 0],
            array_intersect_key($pv['accounts'], array_flip(['in_files', 'new', 'changed', 'same', 'kept', 'moved'])));
        $this->assertSame(['sno' => (int) $e->sno, 'name' => $e->borrower_name], $pv['accounts']['examples_changed'][0]);
        $this->assertSame(3, $pv['receipts']['in_files']);
        $this->assertSame($paidBefore, $pv['receipts']['now_for_these_accounts']);
        $this->assertSame([], $pv['duplicate_snos']);

        $this->rpc('admin_import_commit', ['p_job' => $job, 'p_confirm' => 'IMPORT', 'p_password' => self::PW])->assertOk()
            ->assertJsonPath('data.accounts', 3)->assertJsonPath('data.receipts', 3);
        $this->assertSame('9999999999', DB::table('legacy_accounts')->where('sno', $e->sno)->value('borrower_mobile'));
        $this->assertSame($e->zone, DB::table('legacy_accounts')->where('sno', $e->sno)->value('zone'));
        $this->assertSame(1, DB::table('legacy_payments')->where('sno', $e->sno)->count());
        $this->assertSame($others + 2, DB::table('legacy_payments')->whereNotIn('sno', [$e->sno, $s->sno])->count());
        $this->assertSame(0, DB::table('legacy_payments')->where('sno', $s->sno)->count()); // in the files with no receipts: its $sPaid old ones go
        $n = DB::table('legacy_accounts')->where('sno', $newSno)->first();
        $this->assertSame('1100.00', $n->legacy_paid);
        $this->assertSame(2, (int) $n->legacy_payments_count);
        $this->assertNotNull(DB::table('legacy_payments')->where('sno', $newSno)->value('series_id'));
        $this->assertSame('import', DB::table('data_audit')->orderByDesc('id')->value('action'));
    }

    public function test_import_totals_must_match(): void
    {
        $this->as($this->admin());
        $sno = (int) DB::table('legacy_accounts')->max('sno') + 2000;
        $a = ['_file' => 'F_ACC', 'ledger' => 'closed', 'sno' => $sno, 'fno' => $sno, 'borrower_name' => 'X', 'total_amount' => '100.00', 'finance_amount' => '100.00',
            'interest_amount' => '0.00', 'agreement_amount' => '0.00', 'hp_amount' => '0.00', 'emi_amount' => '10.00', 'tenure_months' => 10, 'interval_months' => 1,
            'data_flags' => [], 'recovery' => 'OK', 'raw' => []];
        $b = ['source_file' => 'F.DAT', 'total' => 1, 'imported' => 1, 'skipped' => 0, 'flagged' => 0, 'notes' => []];
        $checks = ['F_ACC' => ['rows' => 1, 'total' => '999'], 'P_ACCOUNT' => ['rows' => 0, 'total' => '0'], 'F_INSMENT' => ['rows' => 0, 'total' => '0'],
            'P_INSMENT' => ['rows' => 0, 'total' => '0']];
        $job = $this->rpc('admin_import_begin', ['p_batches' => ['F_ACC' => $b, 'P_ACCOUNT' => $b, 'F_INSMENT' => $b, 'P_INSMENT' => $b], 'p_checks' => $checks])->json('data');
        $this->rpc('admin_import_stage', ['p_job' => $job, 'p_kind' => 'acc', 'p_rows' => [$a, $a]])->assertOk();
        $this->assertSame([$sno], $this->rpc('admin_import_preview', ['p_job' => $job])->json('data.duplicate_snos'));
        $this->rpc('admin_import_commit', ['p_job' => $job, 'p_confirm' => 'IMPORT', 'p_password' => self::PW])->assertStatus(422)
            ->assertJsonPath('error.message', 'the files contain the same SNO twice; fix the files first');

        $job = $this->rpc('admin_import_begin', ['p_batches' => ['F_ACC' => $b, 'P_ACCOUNT' => $b, 'F_INSMENT' => $b, 'P_INSMENT' => $b], 'p_checks' => $checks])->json('data');
        $this->rpc('admin_import_stage', ['p_job' => $job, 'p_kind' => 'acc', 'p_rows' => [$a]])->assertOk();
        $this->rpc('admin_import_preview', ['p_job' => $job])->assertOk();
        $points = DB::table('restore_points')->count();
        $this->rpc('admin_import_commit', ['p_job' => $job, 'p_confirm' => 'IMPORT', 'p_password' => self::PW])->assertStatus(422)
            ->assertJsonPath('error.message', 'check failed, nothing was imported: F_ACC: accounts or total payable do not match the file');
        $this->assertFalse(DB::table('legacy_accounts')->where('sno', $sno)->exists());
        $this->assertSame($points, DB::table('restore_points')->count()); // the whole call was rolled back
    }
}

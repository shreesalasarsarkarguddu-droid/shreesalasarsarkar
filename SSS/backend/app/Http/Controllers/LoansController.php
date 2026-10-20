<?php

namespace App\Http\Controllers;

use App\Services\LoanRules;
use App\Support\Audit;
use App\Support\Money;
use App\Support\Perm;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** New loans (public.create_loan). Editing / deleting a loan comes with the admin fixes. */
class LoansController extends Controller
{
    /** POST /api/loans { idempotencyKey, values } -> { ok, id } | { ok: false, error, fieldErrors } */
    public function store(Request $request)
    {
        $u = Perm::need('new_loan');
        $key = (string) $request->input('idempotencyKey');
        if (! preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $key)) {
            return $this->fail('Invalid request. Reload the page and try again.');
        }
        if ($id = DB::table('loans')->where('idempotency_key', $key)->value('id')) {
            return $this->ok(['id' => (int) $id]);
        }
        [$v, $errors] = LoanRules::validate((array) $request->input('values', []));
        if ($errors) {
            return $this->fail('Please fix the highlighted fields.', $errors);
        }
        if (DB::table('loans')->where('folio_no', $v['folio_no'])->exists()) {
            return $this->fail('This folio number is already used.', ['folio_no' => 'This folio number is already used']);
        }

        $amt = LoanRules::amounts($v['finance_amount'], $v['interest_rate'], $v['installments'], $v['interval_months'], $v['agreement_amount'], $v['hp_amount']);
        try {
            $id = DB::transaction(function () use ($u, $v, $key, $amt) {
                $bid = DB::table('borrowers')->insertGetId([
                    'full_name' => $v['borrower_name'], 'father_name' => $v['borrower_father'], 'mobile' => $v['borrower_mobile'],
                    'date_of_birth' => $v['borrower_dob'], 'address' => $v['borrower_address'], 'created_by' => $u->id,
                ]);
                $id = DB::table('loans')->insertGetId([
                    'folio_no' => $v['folio_no'], 'zone' => $v['zone'], 'dealer' => $v['dealer'], 'loan_type' => $v['loan_type'], 'borrower_id' => $bid,
                    'guarantor_name' => $v['guarantor_name'], 'guarantor_father' => $v['guarantor_father'], 'guarantor_mobile' => $v['guarantor_mobile'],
                    'guarantor_address' => $v['guarantor_address'], 'vehicle_condition' => $v['vehicle_condition'], 'sold_by' => $v['sold_by'],
                    'vehicle_model' => $v['vehicle_model'], 'vehicle_color' => $v['vehicle_color'], 'chassis_no' => $v['chassis_no'],
                    'engine_no' => $v['engine_no'], 'make_year' => $v['make_year'], 'vehicle_no' => $v['vehicle_no'],
                    'insurance_expiry' => $v['insurance_expiry'], 'agreement_date' => $v['agreement_date'], 'installments' => $v['installments'],
                    'interval_months' => $v['interval_months'], 'finance_amount' => Money::dec($v['finance_amount']), 'interest_rate' => $v['interest_rate'],
                    'agreement_amount' => Money::dec($v['agreement_amount']), 'hp_amount' => Money::dec($v['hp_amount']),
                    'interest_amount' => Money::str($amt['interest']), 'total_amount' => Money::str($amt['total']), 'emi_amount' => Money::str($amt['emi']),
                    'idempotency_key' => $key, 'created_by' => $u->id,
                ]);
                Audit::log('new_loan', "Folio {$v['folio_no']} · {$v['borrower_name']}", ['source' => 'new', 'ref_id' => $id], [
                    'finance' => (float) Money::str(Money::paise($v['finance_amount'])), 'total' => (float) Money::str($amt['total']),
                    'emi' => (float) Money::str($amt['emi']), 'emis' => $v['installments'],
                ]);

                return $id;
            });
        } catch (UniqueConstraintViolationException) {
            if ($id = DB::table('loans')->where('idempotency_key', $key)->value('id')) {
                return $this->ok(['id' => (int) $id]);
            }

            return $this->fail('This folio number is already used.', ['folio_no' => 'This folio number is already used']);
        }

        \App\Services\Notify::loan($id);

        return $this->ok(['id' => $id]);
    }
}

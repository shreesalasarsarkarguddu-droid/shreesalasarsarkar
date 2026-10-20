<?php

namespace App\Services;

use App\Support\Money;

/**
 * The New Loan form rules (src/lib/loan.ts loanSchema): trimmed, upper-cased text, Indian mobiles, real dates,
 * money with up to 2 decimals. validate() returns [clean values, field errors].
 */
final class LoanRules
{
    public const FIELDS = ['folio_no', 'zone', 'dealer', 'loan_type', 'borrower_name', 'borrower_father', 'borrower_mobile', 'borrower_dob',
        'borrower_address', 'guarantor_name', 'guarantor_father', 'guarantor_mobile', 'guarantor_address', 'vehicle_condition', 'sold_by',
        'vehicle_model', 'vehicle_color', 'chassis_no', 'engine_no', 'make_year', 'vehicle_no', 'insurance_expiry', 'agreement_date',
        'installments', 'interval_months', 'finance_amount', 'interest_rate', 'agreement_amount', 'hp_amount'];

    public static function validate(array $in): array
    {
        $v = [];
        $e = [];
        $s = fn ($k) => trim((string) ($in[$k] ?? ''));
        $req = function ($k, $label, $max = 120) use ($s, &$v, &$e) {
            $x = $s($k);
            if ($x === '') {
                $e[$k] = "Enter $label";
            } elseif (mb_strlen($x) > $max) {
                $e[$k] = ucfirst($label).' is too long';
            } else {
                $v[$k] = mb_strtoupper($x);
            }
        };
        $opt = function ($k, $max = 250) use ($s, &$v, &$e) {
            $x = $s($k);
            if (mb_strlen($x) > $max) {
                $e[$k] = 'Too long';
            } else {
                $v[$k] = $x === '' ? null : mb_strtoupper($x);
            }
        };
        $mobile = function ($k, $required) use ($s, &$v, &$e) {
            $x = $s($k);
            if ($x === '' && ! $required) {
                $v[$k] = null;
            } elseif (! preg_match('/^[6-9]\d{9}$/', $x)) {
                $e[$k] = 'Enter a valid 10-digit mobile number';
            } else {
                $v[$k] = $x;
            }
        };
        $date = function ($k, ?string $requiredLabel) use ($s, &$v, &$e) {
            $x = $s($k);
            if ($x === '' && $requiredLabel === null) {
                $v[$k] = null;
            } elseif (! self::realDate($x)) {
                $e[$k] = $requiredLabel ? "Enter $requiredLabel" : 'Enter a valid date';
            } else {
                $v[$k] = $x;
            }
        };
        $money = function ($k, ?string $requiredLabel) use ($s, &$v, &$e) {
            $x = $s($k);
            if ($x === '' && $requiredLabel === null) {
                $v[$k] = '0';
            } elseif (! preg_match('/^\d{1,10}(\.\d{1,2})?$/', $x)) {
                $e[$k] = $requiredLabel ? "Enter $requiredLabel (numbers only, up to 2 decimals)" : 'Numbers only, up to 2 decimals';
            } elseif ($requiredLabel && Money::paise($x) <= 0) {
                $e[$k] = ucfirst($requiredLabel).' must be more than 0';
            } else {
                $v[$k] = $x;
            }
        };
        $int = function ($k, $label, $min, $max) use ($s, &$v, &$e) {
            $x = $s($k);
            if (! preg_match('/^\d{1,3}$/', $x)) {
                $e[$k] = "Enter $label";
            } elseif ((int) $x < $min || (int) $x > $max) {
                $e[$k] = ucfirst($label)." must be $min–$max";
            } else {
                $v[$k] = (int) $x;
            }
        };

        $req('folio_no', 'folio no.', 30);
        $opt('zone', 60);
        $opt('dealer', 80);
        in_array($s('loan_type'), ['CASH', 'BANK'], true) ? $v['loan_type'] = $s('loan_type') : $e['loan_type'] = 'Choose loan type';
        $req('borrower_name', 'full name');
        $req('borrower_father', "father's name");
        $mobile('borrower_mobile', true);
        $date('borrower_dob', null);
        $req('borrower_address', 'address', 300);
        $opt('guarantor_name', 120);
        $opt('guarantor_father', 120);
        $mobile('guarantor_mobile', false);
        $opt('guarantor_address', 300);

        in_array($s('vehicle_condition'), ['NEW', 'USED'], true) ? $v['vehicle_condition'] = $s('vehicle_condition') : $e['vehicle_condition'] = 'Choose new or used';
        $opt('sold_by', 80);
        $req('vehicle_model', 'model', 60);
        $opt('vehicle_color', 40);
        $opt('chassis_no', 40);
        $opt('engine_no', 40);
        $year = $s('make_year');
        $maxYear = (int) date('Y') + 1;
        if ($year === '') {
            $v['make_year'] = null;
        } elseif (! preg_match('/^\d{4}$/', $year) || (int) $year < 1980 || (int) $year > $maxYear) {
            $e['make_year'] = "Year must be 1980–$maxYear";
        } else {
            $v['make_year'] = (int) $year;
        }
        $opt('vehicle_no', 20);
        $date('insurance_expiry', null);

        $date('agreement_date', 'agreement date');
        $int('installments', 'number of installments', 1, 360);
        $int('interval_months', 'interval', 1, 12);
        $money('finance_amount', 'finance amount');
        $rate = $s('interest_rate');
        if (! preg_match('/^\d{1,3}(\.\d{1,2})?$/', $rate)) {
            $e['interest_rate'] = 'Enter interest rate % (up to 2 decimals)';
        } elseif ((float) $rate > 100) {
            $e['interest_rate'] = 'Rate must be 100% or less';
        } else {
            $v['interest_rate'] = $rate;
        }
        $money('agreement_amount', null);
        $money('hp_amount', null);

        return [$v, $e];
    }

    public static function realDate(string $v): bool
    {
        if (! preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m)) {
            return false;
        }

        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    }

    /**
     * Interest, total and EMI (public.loan_amounts): interest = round(principal × rate × months / 1200) to whole rupees,
     * total = principal + interest + agreement + hp, EMI = total / installments rounded up to whole rupees. Paise in, paise out.
     */
    public static function amounts(string $principal, string $rate, int $installments, int $interval, string $agreement, string $hp): array
    {
        $p = Money::paise($principal);
        $r = (int) round(((float) $rate) * 100); // rate in hundredths of a percent
        $months = $installments * $interval;
        // interest rupees = round(p/100 × r/100 × months / 1200) = round(p × r × months / 12_000_000) rupees
        $num = $p * $r * $months;
        $den = 12000000;
        $interestRupees = intdiv(2 * $num + $den, 2 * $den);
        $interest = $interestRupees * 100;
        $total = $p + $interest + Money::paise($agreement) + Money::paise($hp);
        $emiRupees = intdiv($total + $installments * 100 - 1, $installments * 100); // ceil(total / installments) in rupees

        return ['interest' => $interest, 'total' => $total, 'emi' => $emiRupees * 100];
    }
}

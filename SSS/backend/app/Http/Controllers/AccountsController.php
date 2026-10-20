<?php

namespace App\Http\Controllers;

use App\Services\AccountData;
use App\Services\AccountQueries;
use App\Support\Perm;
use Illuminate\Http\Request;

/** Accounts list, one old account, one new loan. */
class AccountsController extends Controller
{
    /** GET /api/accounts?q&ledger=pending|closed|all&source=new|old|all&page — 20 per page, newest first. */
    public function index(Request $request)
    {
        Perm::need('view_accounts');
        $q = mb_substr(trim((string) $request->query('q', '')), 0, 60);
        $ledger = in_array($request->query('ledger'), ['pending', 'closed', 'all'], true) ? $request->query('ledger') : 'all';
        $source = in_array($request->query('source'), ['new', 'old', 'all'], true) ? $request->query('source') : 'all';
        $page = max(1, (int) $request->query('page', 1));
        $size = 20;

        $query = AccountQueries::all();
        if ($ledger !== 'all') {
            $query->where('ledger', $ledger);
        }
        if ($source !== 'all') {
            $query->where('source', $source);
        }
        AccountQueries::search($query, $q);
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('sort_key')->offset(($page - 1) * $size)->limit($size)
            ->get(['source', 'ref_id', 'folio', 'ledger', 'borrower_name', 'borrower_father', 'borrower_mobile', 'registration_no', 'vehicle_model',
                'tenure_months', 'payments_count', 'seized', 'total_amount', 'emi_amount', 'total_paid', 'balance'])
            ->map(fn ($r) => AccountData::clean($r, [], ['seized']))->all();

        return response()->json(['rows' => $rows, 'total' => $total]);
    }

    /** GET /api/legacy-accounts/{sno} */
    public function legacy(Request $request, $sno)
    {
        $u = Perm::need('view_accounts');
        $sno = $this->id($sno);
        $a = AccountData::legacy($sno);
        abort_unless($a !== null, 404);

        return response()->json([
            'account' => $a,
            'waiting' => AccountData::waiting('old', $sno),
            'remarks' => AccountData::remarks('old', $sno, $u),
            'zoneInfo' => AccountData::zoneInfo('old', $sno, $u),
        ]);
    }

    /** GET /api/loans/{id} */
    public function loan(Request $request, $id)
    {
        $u = Perm::need('view_accounts');
        $id = $this->id($id);
        $l = AccountData::loan($id);
        abort_unless($l !== null, 404);

        return response()->json([
            'loan' => $l,
            'waiting' => AccountData::waiting('new', $id),
            'remarks' => AccountData::remarks('new', $id, $u),
            'zoneInfo' => AccountData::zoneInfo('new', $id, $u),
        ]);
    }
}

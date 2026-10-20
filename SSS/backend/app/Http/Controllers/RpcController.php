<?php

namespace App\Http\Controllers;

use App\Rpc\RpcError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/rpc/{name}: the old database functions the screens call by name (supabase.rpc), with the same parameters.
 * Answers { ok: true, data } or { ok: false, error: { code, message } } (code = the old Postgres error code).
 */
class RpcController extends Controller
{
    /** name => [class, method]; each method takes the parameters array and returns the data. */
    private const FUNCTIONS = [
        'staff_names' => [\App\Rpc\Staff::class, 'names'],
        'assign_collections' => [\App\Rpc\Collections::class, 'assign'],
        'unassign_collections' => [\App\Rpc\Collections::class, 'unassign'],
        'assign_candidates' => [\App\Rpc\Collections::class, 'candidates'],
        'collection_list' => [\App\Rpc\Collections::class, 'list'],
        'pending_approvals' => [\App\Rpc\Approvals::class, 'list'],
        'review_pending' => [\App\Rpc\Approvals::class, 'review'],
        'review_payment' => [\App\Rpc\Approvals::class, 'reviewOne'],
        'cash_day' => [\App\Rpc\Cash::class, 'day'],
        'cash_receive' => [\App\Rpc\Cash::class, 'receive'],
        'receipt_book_status' => [\App\Rpc\Books::class, 'status'],
        'admin_receipt_book' => [\App\Rpc\Books::class, 'book'],
        'zone_status' => [\App\Rpc\Books::class, 'zones'],
        'admin_zone' => [\App\Rpc\Books::class, 'zone'],
        'main_book_status' => [\App\Rpc\Books::class, 'main'],
        'admin_main_book' => [\App\Rpc\Books::class, 'newMain'],
        'add_remark' => [\App\Rpc\Remarks::class, 'add'],
        'delete_remark' => [\App\Rpc\Remarks::class, 'delete'],
        'remarks_list' => [\App\Rpc\Remarks::class, 'list'],
        'set_account_zone' => [\App\Rpc\Remarks::class, 'setZone'],
    ];

    public function call(Request $request, string $name)
    {
        $fn = self::FUNCTIONS[$name] ?? null;
        if ($fn === null) {
            return response()->json(['ok' => false, 'error' => ['code' => 'P0002', 'message' => 'this works after the next update of the new system']], 404);
        }
        try {
            $data = DB::transaction(fn () => app($fn[0])->{$fn[1]}($request->all(), $request->user()));
        } catch (RpcError $e) {
            return response()->json(['ok' => false, 'error' => ['code' => $e->pgCode, 'message' => $e->getMessage()]], $e->pgCode === '42501' ? 403 : 422);
        }

        return response()->json(['ok' => true, 'data' => $data]);
    }
}

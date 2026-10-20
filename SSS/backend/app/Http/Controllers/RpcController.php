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
    private const FUNCTIONS = [];

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

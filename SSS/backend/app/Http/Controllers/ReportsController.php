<?php

namespace App\Http\Controllers;

use App\Services\DueReport;
use App\Services\Reports;
use App\Support\Perm;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Reports: due installments / finance details (due report), Day Book, Seized Vehicles, Dashboard, staff performance. */
class ReportsController extends Controller
{
    private function day(?string $v, ?string $fallback = null): string
    {
        return is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) && checkdate((int) substr($v, 5, 2), (int) substr($v, 8, 2), (int) substr($v, 0, 4))
            ? $v : ($fallback ?? now()->toDateString());
    }

    /** GET /api/reports/due?asof=YYYY-MM-DD — every open account (public.due_report). */
    public function due(Request $request)
    {
        Perm::need('reports');

        return response()->json(DueReport::run($this->day($request->query('asof'))));
    }

    /** GET /api/reports/day-book?from&to — at most 93 days. */
    public function dayBook(Request $request)
    {
        Perm::need('reports');
        $from = $this->day($request->query('from'));
        $to = $this->day($request->query('to'), $from);
        if ($to < $from || (strtotime($to) - strtotime($from)) / 86400 > 93) {
            return $this->fail('Choose a period of 93 days or less.');
        }

        return response()->json(['entries' => Reports::dayBook($from, $to), 'opening' => Reports::dayBookOpening($from)]);
    }

    /** GET /api/reports/seized?status=pending|closed|all&q — newest seizure first, at most 1000. */
    public function seized(Request $request)
    {
        Perm::need('reports');
        $status = in_array($request->query('status'), ['pending', 'closed', 'all'], true) ? $request->query('status') : 'pending';
        $q = mb_strtolower(trim((string) $request->query('q', '')));
        $rows = array_values(array_filter(Reports::seized(), fn ($r) => ($status === 'all' || $r['ledger'] === $status)
            && ($q === '' || str_contains($r['search_text'], $q))));

        return response()->json(array_slice($rows, 0, 1000));
    }

    /** GET /api/dashboard — today's numbers (kept for 60 seconds). */
    public function dashboard()
    {
        $u = Perm::need('reports');
        if (! Perm::can($u, 'view_accounts')) {
            return $this->fail('Your login is not allowed to do this.', [], 403);
        }

        return response()->json(Reports::dashboard(now()->toDateString()));
    }

    /** GET /api/staff-performance?from&to */
    public function staff(Request $request)
    {
        Perm::need('cash');
        $from = $this->day($request->query('from'));

        return response()->json(Reports::staffPerformance($from, $this->day($request->query('to'), $from)));
    }

    /** GET /api/assignments?day — who has which account on that day's collection lists. */
    public function assignments(Request $request)
    {
        $u = Perm::need('reports');
        $q = DB::table('collection_assignments')->where('day', $this->day($request->query('day')));
        if (! Perm::can($u, 'assign')) {
            $q->where('user_id', $u->id);
        }

        return response()->json($q->limit(5000)->get(['source', 'ref_id', 'user_id']));
    }
}

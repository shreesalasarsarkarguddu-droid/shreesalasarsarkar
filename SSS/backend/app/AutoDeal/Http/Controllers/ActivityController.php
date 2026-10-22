<?php

namespace App\AutoDeal\Http\Controllers;

use App\AutoDeal\Models\ActivityLog;
use App\AutoDeal\Models\Vehicle;
use App\Models\User;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** Owner-only audit trail. */
class ActivityController extends Controller
{
    public const AREAS = [
        'vehicle' => 'Stock',
        'sale' => 'Sales & payments',
        'staff' => 'Staff yards',
        'branch' => 'Branches',
        'export' => 'Exports',
    ];

    public function index(Request $request): Response
    {
        $filters = $request->only('user', 'area', 'from', 'to');

        $logs = ActivityLog::query()
            ->with('user:id,full_name')
            ->when($filters['user'] ?? null, fn ($q, $v) => $q->where('user_id', $v))
            ->when($filters['area'] ?? null, fn ($q, $v) => $q->where('action', 'like', $v.'.%'))
            ->when($filters['from'] ?? null, fn ($q, $v) => $q->where('created_at', '>=', $v))
            ->when($filters['to'] ?? null, fn ($q, $v) => $q->where('created_at', '<', date('Y-m-d', strtotime($v.' +1 day'))))
            ->latest('id')
            ->simplePaginate(50)
            ->withQueryString()
            ->through(fn (ActivityLog $log) => [
                ...$log->only('id', 'action', 'description', 'changes', 'ip', 'created_at'),
                'user' => $log->user?->full_name,
                // Link back to the vehicle when there is one (deleted vehicles have no page).
                'vehicle_id' => $log->subject_type === (new Vehicle)->getMorphClass() ? $log->subject_id : null,
            ]);

        return Inertia::render('Activity/Index', [
            'logs' => $logs,
            'filters' => (object) $filters,
            'users' => User::whereIn('id', ActivityLog::query()->distinct()->select('user_id'))->orderBy('full_name')->get(['id', 'full_name as name']),
            'areas' => self::AREAS,
        ]);
    }
}

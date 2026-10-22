<?php

namespace App\Http\Controllers;

use App\Support\Perm;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Activity log, the notification log and the backup download. */
class AdminController extends Controller
{
    /**
     * GET /api/activity?who&actions=a,b&from&to&q&page — newest first, 50 a page.
     * from / to are days (India time); q searches the subject.
     */
    public function activity(Request $request)
    {
        Perm::need('activity');
        $size = 50;
        $page = max(1, (int) $request->query('page', 1));
        $q = DB::table('data_audit');
        $who = (string) $request->query('who', '');
        if (preg_match('/^[0-9a-f-]{36}$/', $who)) {
            $q->where('by_user', $who);
        }
        $actions = array_values(array_filter(explode(',', (string) $request->query('actions', '')), fn ($a) => preg_match('/^[a-z_]{1,40}$/', $a)));
        if ($actions) {
            $q->whereIn('action', $actions);
        }
        foreach (['from' => '>=', 'to' => '<='] as $k => $op) {
            $d = (string) $request->query($k, '');
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
                $q->whereRaw("date(at) $op ?", [$d]);
            }
        }
        $text = trim((string) $request->query('q', ''));
        if ($text !== '') {
            $q->where('subject', 'like', '%'.addcslashes(mb_substr($text, 0, 60), '%_\\').'%');
        }
        $total = (clone $q)->count();
        $rows = $q->orderByDesc('id')->offset(($page - 1) * $size)->limit($size)->get(['id', 'at', 'by_name', 'action', 'subject', 'ref', 'details'])
            ->map(fn ($r) => ['id' => $r->id, 'at' => $r->at, 'by_name' => $r->by_name, 'action' => $r->action, 'subject' => $r->subject,
                'ref' => $r->ref === null ? null : json_decode($r->ref, true), 'details' => json_decode($r->details, true) ?? []])->all();

        return response()->json(['rows' => $rows, 'total' => $total]);
    }

    /** GET /api/notification-log — the latest 30 Telegram / WhatsApp messages (admin). */
    public function notificationLog()
    {
        Perm::needAdmin();

        return response()->json(DB::table('notification_log')->orderByDesc('id')->limit(30)
            ->get(['id', 'channel', 'event', 'recipient', 'message', 'status', 'detail', 'created_at']));
    }

    /** GET /api/backup — every table as CSV, zipped (people with the "backup" power). */
    public function backup()
    {
        Perm::need('backup');
        set_time_limit(300);
        $bytes = \App\Services\Backup::zip();

        return response($bytes, 200, [
            'Content-Type' => 'application/zip',
            'Content-Disposition' => 'attachment; filename="salasar-backup-'.now()->format('Y-m-d').'.zip"',
            'Cache-Control' => 'no-store',
        ]);
    }

    /** GET /api/backup/autodeal-files — Auto Deal's vehicle photos and KYC documents, zipped (people with the "backup" power). */
    public function backupAutodealFiles()
    {
        Perm::need('backup');
        abort_unless(\App\AutoDeal\Support\Module::installed(), 404);
        set_time_limit(300);
        $tmp = tempnam(sys_get_temp_dir(), 'adf');
        \App\Services\Backup::filesZip($tmp);

        return response()->download($tmp, 'autodeal-files-'.now()->format('Y-m-d').'.zip', ['Content-Type' => 'application/zip', 'Cache-Control' => 'no-store'])
            ->deleteFileAfterSend();
    }
}

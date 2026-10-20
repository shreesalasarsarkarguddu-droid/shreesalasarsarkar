<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/** The activity log (data_audit), same rows as app_private.log in the old app. */
final class Audit
{
    public static function log(string $action, ?string $subject, ?array $ref, array $details, ?string $userId = null, ?string $at = null): void
    {
        $u = $userId === null ? auth()->user() : null;
        $uid = $userId ?? $u?->id;
        $name = $u?->full_name ?? ($uid ? DB::table('users')->where('id', $uid)->value('full_name') : null);
        DB::table('data_audit')->insert([
            'at' => $at ?? now()->format('Y-m-d H:i:s.u'),
            'by_user' => $uid,
            'by_name' => $name,
            'action' => $action,
            'subject' => $subject,
            'ref' => $ref === null ? null : json_encode($ref, JSON_UNESCAPED_UNICODE),
            'details' => json_encode((object) $details, JSON_UNESCAPED_UNICODE),
        ]);
    }

    /** "SNO 2700 · OMKAR DHRUW" / "Folio TARUN101 · TARUN" and the ref for links (app_private.acct_ref). */
    public static function acctRef(?int $legacyId, ?int $loanId): array
    {
        if ($legacyId) {
            $a = DB::table('legacy_accounts')->where('id', $legacyId)->first(['sno', 'borrower_name']);

            return ['subject' => $a ? "SNO {$a->sno} · {$a->borrower_name}" : null, 'source' => 'old', 'ref_id' => $a?->sno];
        }
        $l = DB::table('loans as l')->join('borrowers as b', 'b.id', '=', 'l.borrower_id')->where('l.id', $loanId)->first(['l.folio_no', 'b.full_name']);

        return ['subject' => $l ? "Folio {$l->folio_no} · {$l->full_name}" : null, 'source' => 'new', 'ref_id' => $loanId];
    }

    public static function staffName(?string $uid): ?string
    {
        return $uid ? DB::table('users')->where('id', $uid)->value('full_name') : null;
    }
}

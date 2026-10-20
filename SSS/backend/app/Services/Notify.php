<?php

namespace App\Services;

use App\Rpc\Approvals;
use App\Support\Audit;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Throwable;

use function Illuminate\Support\defer;

/**
 * Telegram (staff group) and WhatsApp (customers) messages, like the old app_private.tg_send / wa_send / on_* functions.
 * Each message is written to notification_log first ("queued") and sent after the answer has gone to the browser,
 * so a slow Telegram never slows a payment. A failure never blocks the action that caused it.
 */
final class Notify
{
    private static function settings(): object
    {
        return DB::table('app_settings')->where('id', 1)->first();
    }

    /** Send a Telegram text to the staff group (app_private.tg_send). Returns the log id, or null when off / already sent. */
    public static function telegram(string $text, string $event, ?string $dedupe = null, bool $force = false): ?int
    {
        try {
            $s = self::settings();
            if ((! $s->telegram_enabled && ! $force) || ! $s->telegram_bot_token || ! $s->telegram_group_id) {
                return null;
            }
            if ($dedupe !== null && DB::table('notification_log')->where('dedupe_key', $dedupe)->exists()) {
                return null;
            }
            $id = DB::table('notification_log')->insertGetId(['channel' => 'telegram', 'event' => $event, 'recipient' => 'staff group',
                'message' => $text, 'dedupe_key' => $dedupe]);
            self::later($id, fn () => Http::timeout(15)->asJson()->post("https://api.telegram.org/bot{$s->telegram_bot_token}/sendMessage",
                ['chat_id' => $s->telegram_group_id, 'text' => mb_substr($text, 0, 4000), 'disable_web_page_preview' => true]),
                fn ($json) => ($json['ok'] ?? false) === true);

            return $id;
        } catch (Throwable $e) {
            report($e);

            return null;
        }
    }

    /** "91XXXXXXXXXX" from the first mobile number, or null (app_private.wa_number). */
    public static function waNumber(?string $m): ?string
    {
        $d = preg_replace('/\D/', '', explode(',', (string) $m)[0]);

        return match (true) {
            (bool) preg_match('/^[6-9]\d{9}$/', $d) => "91$d",
            (bool) preg_match('/^0[6-9]\d{9}$/', $d) => '91'.substr($d, 1),
            (bool) preg_match('/^91[6-9]\d{9}$/', $d) => $d,
            default => null,
        };
    }

    /** Send a WhatsApp text to a customer (app_private.wa_send). */
    public static function whatsapp(?string $mobile, string $text, string $event, ?string $dedupe = null, bool $force = false): ?int
    {
        try {
            $s = self::settings();
            $num = self::waNumber($mobile);
            if ((! $s->whatsapp_enabled && ! $force) || ! $s->whatsapp_host || ! $s->whatsapp_api_key || ! $num) {
                return null;
            }
            if ($dedupe !== null && DB::table('notification_log')->where('dedupe_key', $dedupe)->exists()) {
                return null;
            }
            $id = DB::table('notification_log')->insertGetId(['channel' => 'whatsapp', 'event' => $event, 'recipient' => $num, 'message' => $text,
                'dedupe_key' => $dedupe]);
            $host = preg_replace('#^https?://|/+$#', '', $s->whatsapp_host);
            self::later($id, fn () => Http::timeout(15)->asJson()->withHeaders(['X-API-KEY' => $s->whatsapp_api_key])
                ->post("https://$host/wapp/api/send/json", ['mobile' => $num, 'msg' => $text]),
                fn ($json) => in_array(strtolower((string) ($json['status'] ?? '')), ['success', 'ok'], true));

            return $id;
        } catch (Throwable $e) {
            report($e);

            return null;
        }
    }

    /** Send after the response; record sent / failed with the reply (app_private.refresh_log). */
    private static function later(int $id, callable $send, callable $ok): void
    {
        defer(function () use ($id, $send, $ok) {
            try {
                $res = $send();
                $json = $res->json() ?? [];
                DB::table('notification_log')->where('id', $id)->update([
                    'status' => $res->successful() && $ok($json) ? 'sent' : 'failed', 'detail' => mb_substr($res->body(), 0, 300),
                ]);
            } catch (Throwable $e) {
                DB::table('notification_log')->where('id', $id)->update(['status' => 'failed', 'detail' => mb_substr($e->getMessage(), 0, 300)]);
            }
        });
    }

    /** {name} {folio} ... in a template (app_private.fill). */
    public static function fill(string $tpl, array $vals): string
    {
        foreach ($vals as $k => $v) {
            $tpl = str_replace('{'.$k.'}', (string) ($v ?? ''), $tpl);
        }

        return $tpl;
    }

    /** A Telegram text for an event when its switch is on (app_private.tg_quiet). setting: payment | new_loan | seizure */
    public static function text(string $setting, string $text, string $event): void
    {
        $s = self::settings();
        $on = match ($setting) {
            'payment' => $s->tg_on_payment, 'new_loan' => $s->tg_on_new_loan, 'seizure' => $s->tg_on_seizure, default => false,
        };
        if ($on) {
            self::telegram($text, $event);
        }
    }

    /** A new payment: Telegram to the staff group + WhatsApp receipt to the customer (app_private.on_payment). */
    public static function payment(int $id): void
    {
        try {
            $p = DB::table('payments')->where('id', $id)->first();
            $s = self::settings();
            if ($p->legacy_account_id) {
                $a = DB::table('legacy_accounts')->where('id', $p->legacy_account_id)->first(['borrower_name', 'fno', 'borrower_mobile']);
                [$name, $folio, $mobile] = [$a->borrower_name, (string) $a->fno, $a->borrower_mobile];
            } else {
                $l = DB::table('loans as l')->join('borrowers as b', 'b.id', '=', 'l.borrower_id')->where('l.id', $p->loan_id)->first(['b.full_name', 'l.folio_no', 'b.mobile']);
                [$name, $folio, $mobile] = [$l->full_name, $l->folio_no, $l->mobile];
            }
            $rcpt = ($p->receipt_book ? "{$p->receipt_book}/" : '').$p->receipt_no;
            if ($s->tg_on_payment) {
                self::telegram("💰 Payment received\n".($name ?? '?').' · Folio '.($folio ?? '?')."\n"
                    .Money::inr(Money::paise($p->paid_amount)).' · '.Approvals::modeText($p->payment_mode, $p->bank_name, $p->parts)." · Rcpt $rcpt"
                    .($p->installments_covered > 1 ? " · {$p->installments_covered} EMIs" : '')."\n"
                    .'Balance '.Money::inr(Money::paise($p->balance_after))."\nBy ".(Audit::staffName($p->created_by) ?? '—'), 'payment', "tg-pay-$id");
            }
            if ($s->wa_receipt) {
                self::whatsapp($mobile, self::fill($s->wa_receipt_template, ['name' => $name, 'folio' => $folio, 'amount' => Money::inr(Money::paise($p->paid_amount)),
                    'date' => date('d/m/Y', strtotime($p->paid_date)), 'receipt' => $rcpt, 'balance' => Money::inr(Money::paise($p->balance_after)),
                    'business' => $s->business_name]), 'receipt', "wa-pay-$id");
            }
        } catch (Throwable $e) {
            report($e); // never block the payment
        }
    }

    /** A new loan (app_private.on_new_loan). */
    public static function loan(int $id): void
    {
        try {
            if (! self::settings()->tg_on_new_loan) {
                return;
            }
            $l = DB::table('loans as l')->join('borrowers as b', 'b.id', '=', 'l.borrower_id')->where('l.id', $id)->first(['l.*', 'b.full_name', 'b.mobile']);
            self::telegram("🆕 New loan\n".($l->full_name ?? '?')." · Folio {$l->folio_no}".($l->mobile ? " · {$l->mobile}" : '')."\n"
                .'Finance '.Money::inr(Money::paise($l->finance_amount)).' · Total '.Money::inr(Money::paise($l->total_amount))."\n"
                .'EMI '.Money::inr(Money::paise($l->emi_amount))." × {$l->installments}\n"
                .($l->vehicle_model ?? '').($l->vehicle_no ? " · {$l->vehicle_no}" : '')."\nBy ".(Audit::staffName($l->created_by) ?? '—'), 'new_loan', "tg-loan-$id");
        } catch (Throwable $e) {
            report($e);
        }
    }

    /** A vehicle seized / released (app_private.on_seizure). */
    public static function seizure(int $id): void
    {
        try {
            if (! self::settings()->tg_on_seizure) {
                return;
            }
            $e = DB::table('seizures')->where('id', $id)->first();
            if ($e->legacy_account_id) {
                $a = DB::table('legacy_accounts')->where('id', $e->legacy_account_id)->first(['borrower_name', 'fno']);
                [$name, $folio] = [$a->borrower_name, (string) $a->fno];
            } else {
                $l = DB::table('loans as l')->join('borrowers as b', 'b.id', '=', 'l.borrower_id')->where('l.id', $e->loan_id)->first(['b.full_name', 'l.folio_no']);
                [$name, $folio] = [$l->full_name, $l->folio_no];
            }
            self::telegram(($e->action === 'seize' ? '🚨 Vehicle seized' : '✅ Vehicle released')."\n".($name ?? '?').' · Folio '.($folio ?? '?')."\n"
                .'Date '.date('d/m/Y', strtotime($e->action_date)).($e->remarks ? "\n{$e->remarks}" : '')."\nBy ".(Audit::staffName($e->created_by) ?? '—'),
                $e->action, "tg-seize-$id");
        } catch (Throwable $e) {
            report($e);
        }
    }

    /** The evening summary to the staff group (app_private.daily_summary). */
    public static function dailySummary(string $day, ?string $dedupe, bool $force = false): ?int
    {
        $pays = DB::table('payments')->where('paid_date', $day)->get(['paid_amount', 'payment_mode', 'parts']);
        $sum = 0;
        $modes = [];
        foreach ($pays as $p) {
            $sum += Money::paise($p->paid_amount);
            foreach (['CASH', 'CHEQUE', 'SBI', 'BANK'] as $m) {
                $part = $p->payment_mode === 'SPLIT'
                    ? array_sum(array_map(fn ($x) => ($x['mode'] ?? '') === $m ? Money::paise((string) $x['amount']) : 0, json_decode((string) $p->parts, true) ?? []))
                    : ($p->payment_mode === $m ? Money::paise($p->paid_amount) : 0);
                $modes[$m] = ($modes[$m] ?? 0) + $part;
            }
        }
        $modes = array_filter($modes);
        ksort($modes);
        $loans = DB::table('loans')->where('agreement_date', $day);
        $nLoans = (clone $loans)->count();
        $loanSum = Money::paise((string) $loans->sum('finance_amount'));
        $seized = DB::table('seizures')->where('action_date', $day)->where('action', 'seize')->count();
        $released = DB::table('seizures')->where('action_date', $day)->where('action', 'release')->count();
        $due = array_filter(DueReport::run($day), fn ($d) => $d['next_due'] === $day && ! $d['seized']);
        $dueSum = array_sum(array_map(fn ($d) => Money::paise($d['emi']), $due));
        $name = self::settings()->business_name;

        return self::telegram("📊 $name — ".date('d/m/Y', strtotime($day))."\n\n"
            .'💰 Collected: '.Money::inr($sum).' ('.count($pays).' receipts)'
            .($modes ? "\n    ".implode(' · ', array_map(fn ($m, $v) => "$m ".Money::inr($v), array_keys($modes), $modes)) : '')."\n"
            ."🆕 New loans: $nLoans".($loanSum ? ' · '.Money::inr($loanSum) : '')."\n"
            ."🚨 Seized: $seized · ✅ Released: $released\n"
            .'📅 EMIs due today: '.count($due).' · '.Money::inr($dueSum), 'daily_summary', $dedupe, $force);
    }

    /** WhatsApp reminders for EMIs due in N days (app_private.due_reminders). */
    public static function dueReminders(string $day): int
    {
        $s = self::settings();
        $target = date('Y-m-d', strtotime("$day +{$s->wa_reminder_days_before} days"));
        $n = 0;
        foreach (array_slice(array_values(array_filter(DueReport::run($day), fn ($d) => $d['next_due'] === $target && ! $d['seized'] && self::waNumber($d['mobile']))), 0, 300) as $d) {
            if (self::whatsapp($d['mobile'], self::fill($s->wa_reminder_template, ['name' => $d['borrower_name'], 'folio' => $d['folio'],
                'emi' => Money::inr(Money::paise($d['emi'])), 'due_date' => date('d/m/Y', strtotime($d['next_due'])), 'balance' => Money::inr(Money::paise($d['balance'])),
                'arrears' => Money::inr(Money::paise($d['arrears'])), 'business' => $s->business_name]), 'due_reminder', "wa-due-{$d['source']}-{$d['ref_id']}-{$d['next_due']}") !== null) {
                $n++;
            }
        }

        return $n;
    }

    /** Every hour (cron): the evening summary and the due reminders at their hours (app_private.run_hourly). */
    public static function hourly(): void
    {
        $s = self::settings();
        $day = now()->toDateString();
        $hour = (int) now()->format('G');
        if ($s->telegram_enabled && $s->tg_daily_summary && $hour === (int) $s->tg_summary_hour) {
            self::dailySummary($day, "tg-summary-$day");
        }
        if ($s->whatsapp_enabled && $s->wa_due_reminder && $hour === (int) $s->wa_reminder_hour) {
            self::dueReminders($day);
        }
    }
}

<?php

namespace App\Rpc;

use App\Models\User;
use App\Services\Notify;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/** Business name, Telegram, WhatsApp and staff-control settings (admin only). */
class Settings
{
    private const BOOLS = ['telegram_enabled', 'tg_on_payment', 'tg_on_new_loan', 'tg_on_seizure', 'tg_daily_summary', 'whatsapp_enabled', 'wa_receipt',
        'wa_due_reminder', 'require_receipt_books', 'restrict_to_assigned'];

    private static function admin(User $u): void
    {
        if (! $u->isAdmin()) {
            throw RpcError::notAllowed('only admin');
        }
    }

    /** public.get_notification_settings(): the keys are shown only as ••••1234. */
    public function get(array $p, User $u): array
    {
        self::admin($u);
        $s = (array) DB::table('app_settings')->where('id', 1)->first();
        foreach (self::BOOLS as $k) {
            $s[$k] = (bool) $s[$k];
        }
        $s['review_above'] = (float) $s['review_above'];
        $s['telegram_bot_token'] = $s['telegram_bot_token'] ? '••••'.substr($s['telegram_bot_token'], -4) : '';
        $s['whatsapp_api_key'] = $s['whatsapp_api_key'] ? '••••'.substr($s['whatsapp_api_key'], -4) : '';

        return $s;
    }

    /** public.save_notification_settings(p): only the fields given change; a ••••-masked key keeps the saved one. */
    public function save(array $in, User $u): ?bool
    {
        self::admin($u);
        $p = $in['p'] ?? [];
        $s = DB::table('app_settings')->where('id', 1)->first();
        $has = fn ($k) => array_key_exists($k, $p) && $p[$k] !== null;
        $row = [];
        foreach (self::BOOLS as $k) {
            $row[$k] = $has($k) ? (bool) $p[$k] : (bool) $s->$k;
        }
        foreach (['tg_summary_hour' => [0, 23], 'wa_reminder_days_before' => [0, 10], 'wa_reminder_hour' => [0, 23], 'review_backdate_days' => [0, 365]] as $k => [$min, $max]) {
            if ($has($k) && $p[$k] !== '') {
                $v = (int) $p[$k];
                if ($v < $min || $v > $max) {
                    throw RpcError::bad("$k must be $min-$max");
                }
                $row[$k] = $v;
            }
        }
        foreach (['telegram_group_id', 'whatsapp_host'] as $k) {
            if (array_key_exists($k, $p)) {
                $row[$k] = trim((string) $p[$k]) ?: null;
            }
        }
        foreach (['telegram_bot_token', 'whatsapp_api_key'] as $k) {
            if (array_key_exists($k, $p) && ! str_starts_with((string) $p[$k], '••••')) {
                $row[$k] = trim((string) $p[$k]) ?: null;
            }
        }
        foreach (['business_name', 'wa_receipt_template', 'wa_reminder_template'] as $k) {
            if (trim((string) ($p[$k] ?? '')) !== '') {
                $row[$k] = trim((string) $p[$k]);
            }
        }
        if ($has('review_above') && $p['review_above'] !== '') {
            $row['review_above'] = Money::dec((string) $p['review_above']);
        }
        $row['updated_at'] = now()->format('Y-m-d H:i:s.u');
        $row['updated_by'] = $u->id;
        DB::table('app_settings')->where('id', 1)->update($row);

        return null;
    }

    /** public.send_test_notification(p_channel, p_mobile): telegram | whatsapp | summary (works while the switch is off). */
    public function test(array $p, User $u): ?int
    {
        self::admin($u);
        $s = DB::table('app_settings')->where('id', 1)->first();
        $txt = "🧪 Test from {$s->business_name}\nNotifications are working.\n".now()->format('d/m/Y h:i A');
        switch ($p['p_channel'] ?? '') {
            case 'telegram':
                if (! $s->telegram_bot_token || ! $s->telegram_group_id) {
                    throw RpcError::bad('save the bot token and group id first');
                }

                return Notify::telegram($txt, 'test', null, true);
            case 'whatsapp':
                if (! $s->whatsapp_host || ! $s->whatsapp_api_key) {
                    throw RpcError::bad('save the WhatsApp host and API key first');
                }
                if (! Notify::waNumber($p['p_mobile'] ?? null)) {
                    throw RpcError::bad('enter a valid 10-digit mobile number');
                }

                return Notify::whatsapp($p['p_mobile'], $txt, 'test', null, true);
            case 'summary':
                if (! $s->telegram_bot_token || ! $s->telegram_group_id) {
                    throw RpcError::bad('save the bot token and group id first');
                }
                $id = Notify::dailySummary(now()->toDateString(), null);
                if ($id === null) {
                    throw RpcError::bad('turn Telegram on first');
                }

                return $id;
            default:
                throw RpcError::bad('bad channel');
        }
    }

    /** public.notification_result(p_id): sent / failed / queued and the reply. */
    public function result(array $p, User $u): array
    {
        self::admin($u);
        $r = DB::table('notification_log')->where('id', (int) ($p['p_id'] ?? 0))->first();

        return ['status' => $r?->status, 'detail' => $r?->detail];
    }

    /** public.refresh_notification_log(): statuses are written as each message is sent; nothing to do. */
    public function refresh(array $p, User $u): ?bool
    {
        self::admin($u);

        return null;
    }
}

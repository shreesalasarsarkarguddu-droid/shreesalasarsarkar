<?php

namespace App\Services;

/**
 * Telegram / WhatsApp messages (payments, new loans, seizures, cash, daily summary, reminders).
 * Filled in with Phase 4 (Settings + notifications); until then nothing is sent.
 */
final class Notify
{
    public static function payment(int $paymentId): void
    {
        // Phase 4
    }

    /** A Telegram text for an event, when the setting for it is on (app_private.tg_quiet). */
    public static function text(string $setting, string $text, string $event): void
    {
        // Phase 4
    }
}

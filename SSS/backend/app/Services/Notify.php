<?php

namespace App\Services;

/**
 * Telegram / WhatsApp messages (payments, new loans, seizures, daily summary, reminders).
 * Filled in with Phase 4 (Settings + notifications); until then nothing is sent.
 */
final class Notify
{
    public static function payment(int $paymentId): void
    {
        // Phase 4
    }
}

<?php

// Auto Deal (used-vehicle stock and sales, /autodeal). See App\AutoDeal\Support\Module.

return [
    // false: Auto Deal is hidden (menu, screens) but nothing is deleted. Run `php artisan route:clear` after changing it.
    'enabled' => (bool) env('AUTODEAL_ENABLED', true),

    // SSS sign-in page for someone not signed in (default: the first FRONTEND_URL + /login, or this site's /login)
    'login_url' => env('AUTODEAL_LOGIN_URL'),

    // Printed on receipts / agreements and shown in the Auto Deal header.
    'business_name' => env('DEALER_NAME', 'Shree Salasar Sarkar · Auto Deal'),
    'business_address' => env('DEALER_ADDRESS', ''),
    'business_phone' => env('DEALER_PHONE', ''),
    'business_gstin' => env('DEALER_GSTIN', ''),

    // Upload limits (KB). The phone compresses photos to ~300 KB, so these are safety nets.
    'max_photo_kb' => (int) env('MAX_PHOTO_KB', 4096),
    'max_document_kb' => (int) env('MAX_DOCUMENT_KB', 5120),
    'max_photos' => 12,

    // Public catalogue at /autodeal/catalogue (only vehicles the owner marks as listed).
    'catalogue_enabled' => (bool) env('CATALOGUE_ENABLED', true),
];

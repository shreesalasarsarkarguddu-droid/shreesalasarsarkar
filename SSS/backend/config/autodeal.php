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

    // Every stored image (vehicle photos, ID proofs, sale papers) is at most this size: the phone shrinks it first and
    // the server shrinks it again (GD) if a bigger one arrives. PDFs are kept as they are.
    'image_kb' => (int) env('AUTODEAL_IMAGE_KB', 200),

    // Largest file accepted before shrinking (KB).
    'max_photo_kb' => (int) env('MAX_PHOTO_KB', 8192),
    'max_document_kb' => (int) env('MAX_DOCUMENT_KB', 5120),
    'max_photos' => 12,

    // Vehicle photos on Cloudinary when set: CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
    // (Cloudinary dashboard -> API Keys). Not set: photos stay on this server (storage/app/public/autodeal).
    // ID proofs and sale papers always stay on this server (private).
    'cloudinary_url' => env('CLOUDINARY_URL', ''),
    'cloudinary_folder' => env('CLOUDINARY_FOLDER', 'autodeal'),

    // Public catalogue at /autodeal/catalogue (only vehicles the owner marks as listed).
    'catalogue_enabled' => (bool) env('CATALOGUE_ENABLED', true),
];

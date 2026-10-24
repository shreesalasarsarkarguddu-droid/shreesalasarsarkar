<?php

namespace App\AutoDeal\Http\Controllers;

use App\AutoDeal\Models\ActivityLog;
use App\AutoDeal\Support\Shop;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** Owner-only: the shop's contact details for the public catalogue and receipts. */
class ShopController extends Controller
{
    public function edit(): Response
    {
        return Inertia::render('Shop/Edit', ['shop' => Shop::saved(), 'fallback' => [
            'name' => config('autodeal.business_name'), 'address' => config('autodeal.business_address'), 'phone' => config('autodeal.business_phone'),
        ]]);
    }

    public function update(Request $request): RedirectResponse
    {
        $phone = ['nullable', 'regex:/^[0-9+ -]{10,15}$/'];
        $data = $request->validate([
            'shop_name' => ['nullable', 'string', 'max:120'],
            'tagline' => ['nullable', 'string', 'max:160'],
            'address' => ['nullable', 'string', 'max:255'],
            'phone' => $phone,
            'phone2' => $phone,
            'whatsapp' => $phone,
            'email' => ['nullable', 'email', 'max:120'],
            'gstin' => ['nullable', 'string', 'max:20'],
            'map_url' => ['nullable', 'url:https', 'max:500'],
            'hours' => ['nullable', 'string', 'max:120'],
            'about' => ['nullable', 'string', 'max:2000'],
        ], [
            'phone.regex' => 'Enter a 10-digit mobile number.',
            'phone2.regex' => 'Enter a 10-digit mobile number.',
            'whatsapp.regex' => 'Enter a 10-digit mobile number.',
            'map_url.url' => 'Paste the Google Maps link (starts with https://).',
        ]);
        $before = Shop::saved();
        Shop::save($data);
        $after = Shop::saved();
        $changes = [];
        foreach (Shop::FIELDS as $f) {
            if ($before[$f] !== $after[$f]) {
                $changes[$f] = [$before[$f], $after[$f]];
            }
        }
        if ($changes) {
            ActivityLog::record('shop.updated', null, 'Updated the shop details', $changes);
        }

        return back()->with('success', 'Shop details saved. Customers see them on the public catalogue.');
    }
}

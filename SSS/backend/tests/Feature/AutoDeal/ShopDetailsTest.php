<?php

namespace Tests\Feature\AutoDeal;

use App\AutoDeal\Models\Vehicle;
use App\AutoDeal\Support\Shop;
use App\Services\Backup;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;

/** Account → Shop details: owner only; shown on the public catalogue and printed on receipts; in the backups. */
class ShopDetailsTest extends AutoDealTestCase
{
    private array $shop = [
        'shop_name' => 'Salasar Auto Deal', 'tagline' => 'Used bikes with papers', 'address' => 'Main Road, Dhamtari 493773',
        'phone' => '9876543210', 'phone2' => '9123456780', 'whatsapp' => '', 'email' => 'shop@example.com', 'gstin' => '22ABCDE1234F1Z5',
        'map_url' => 'https://maps.app.goo.gl/abc', 'hours' => 'Mon–Sat 9:30 AM – 7:30 PM', 'about' => 'Finance help available.',
    ];

    public function test_owner_saves_the_shop_details_and_customers_see_them(): void
    {
        $this->signedIn($this->dealerStaff())->get('/autodeal/shop')->assertForbidden();
        $this->put('/autodeal/shop', $this->shop)->assertForbidden();

        $this->signedIn($this->dealerOwner());
        $this->put('/autodeal/shop', ['phone' => '12', 'map_url' => 'not a link'] + $this->shop)->assertSessionHasErrors(['phone', 'map_url']);
        $this->put('/autodeal/shop', $this->shop)->assertSessionHasNoErrors()->assertRedirect();
        $this->get('/autodeal/shop')->assertInertia(fn (Assert $p) => $p->component('Shop/Edit')->where('shop.email', 'shop@example.com'));
        $this->assertSame('shop.updated', DB::table('ad_activity_logs')->latest('id')->value('action'));

        // public catalogue: no login; WhatsApp falls back to the first mobile; GSTIN stays off it
        $this->app['auth']->forgetGuards();
        $this->get('/autodeal/catalogue')->assertOk()->assertInertia(fn (Assert $p) => $p
            ->where('dealer.name', 'Salasar Auto Deal')->where('dealer.phone2', '9123456780')->where('dealer.whatsapp', '9876543210')
            ->where('dealer.email', 'shop@example.com')->where('dealer.map_url', 'https://maps.app.goo.gl/abc')->missing('dealer.gstin'));

        // the details are in the backup zip (ad_settings)
        $this->assertContains('ad_settings', Backup::tables());
    }

    public function test_receipts_print_the_shop_details(): void
    {
        $this->signedIn($this->dealerOwner())->put('/autodeal/shop', $this->shop);
        $this->post('/autodeal/vehicles', [
            'intake_type' => 'customer_buy', 'company_name' => 'Hero', 'model_name' => 'HF Deluxe', 'model_year' => 2023, 'color' => 'Black',
            'registration_number' => 'CG05AP8294',
            'chassis_number' => 'MBLHAR0000001', 'engine_number' => 'HA10E0000001', 'purchase_price' => 40000,
            'intake_date' => now()->toDateString(), 'seller' => ['name' => 'Ramesh', 'phone' => '9876543210'],
        ])->assertSessionHasNoErrors();
        $html = $this->get(route('autodeal.receipts.purchase', Vehicle::sole()))->assertOk()->getContent();
        foreach (['Salasar Auto Deal', 'Main Road, Dhamtari 493773', '9876543210, 9123456780', 'shop@example.com', '22ABCDE1234F1Z5'] as $text) {
            $this->assertStringContainsString($text, $html);
        }
        $this->assertSame('Salasar Auto Deal', Shop::get()['name']);
    }
}

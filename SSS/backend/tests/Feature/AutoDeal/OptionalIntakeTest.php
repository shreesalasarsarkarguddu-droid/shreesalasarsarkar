<?php

namespace Tests\Feature\AutoDeal;

use App\AutoDeal\Models\Vehicle;
use Inertia\Testing\AssertableInertia as Assert;

/** Intake: company, model, registration no., colour and purchase price are needed; the rest and the seller are optional. */
class OptionalIntakeTest extends AutoDealTestCase
{
    private function minimal(array $extra = []): array
    {
        return array_replace_recursive([
            'intake_type' => 'customer_buy', 'company_name' => 'Hero', 'model_name' => 'HF Deluxe', 'registration_number' => 'cg05 ap 8294',
            'color' => 'Black', 'purchase_price' => 45000,
        ], $extra);
    }

    public function test_only_the_five_fields_are_needed(): void
    {
        $this->signedIn($this->dealerOwner());
        $this->post('/autodeal/vehicles', ['intake_type' => 'customer_buy'])
            ->assertSessionHasErrors(['company_name', 'model_name', 'registration_number', 'color', 'purchase_price'])
            ->assertSessionDoesntHaveErrors(['model_year', 'chassis_number', 'engine_number', 'intake_date', 'seller.name', 'seller.phone']);

        $this->post('/autodeal/vehicles', $this->minimal(['source' => '  Shree Hero   Showroom, Dhamtari ']))->assertSessionHasNoErrors()->assertRedirect();
        $v = Vehicle::sole();
        $this->assertSame(['CG05AP8294', 'Shree Hero Showroom, Dhamtari', null, null, null, null, now()->toDateString()],
            [$v->registration_number, $v->source, $v->model_year, $v->chassis_number, $v->engine_number, $v->seller_id, $v->intake_date->toDateString()]);
        $this->assertSame('Hero HF Deluxe', $v->title);

        // the page, the purchase receipt and the stock list work without them
        $this->get(route('autodeal.vehicles.show', $v))->assertOk()->assertInertia(fn (Assert $p) => $p->where('vehicle.seller', null)->where('vehicle.source', 'Shree Hero Showroom, Dhamtari'));
        $this->get(route('autodeal.receipts.purchase', $v))->assertOk()->assertSee('Shree Hero Showroom, Dhamtari');
        $this->get('/autodeal/vehicles?q=showroom')->assertInertia(fn (Assert $p) => $p->has('vehicles', 1));
        $this->get(route('autodeal.vehicles.create'))->assertInertia(fn (Assert $p) => $p->where('sources', ['Shree Hero Showroom, Dhamtari']));
        $this->get('/autodeal/reports')->assertInertia(fn (Assert $p) => $p->where('sources.0.source', 'Shree Hero Showroom, Dhamtari')->where('sources.0.units', 1));
    }

    public function test_seller_is_optional_but_needs_a_name_once_anything_is_given(): void
    {
        $this->signedIn($this->dealerOwner());
        $this->post('/autodeal/vehicles', $this->minimal(['seller' => ['phone' => '9876543210']]))->assertSessionHasErrors('seller.name');
        $this->post('/autodeal/vehicles', $this->minimal(['seller' => ['name' => 'Ramesh', 'phone' => '']]))->assertSessionHasNoErrors();
        $v = Vehicle::with('seller')->sole();
        $this->assertSame(['Ramesh', null], [$v->seller->name, $v->seller->phone]);
        // a seized vehicle has no source
        $this->post('/autodeal/vehicles', $this->minimal(['intake_type' => 'seized', 'registration_number' => 'CG04XY0001', 'source' => 'Showroom']))->assertSessionHasNoErrors();
        $this->assertNull(Vehicle::where('registration_number', 'CG04XY0001')->value('source'));
    }

    public function test_a_registration_is_in_stock_only_once(): void
    {
        $this->signedIn($this->dealerOwner());
        $this->post('/autodeal/vehicles', $this->minimal())->assertSessionHasNoErrors();
        $this->post('/autodeal/vehicles', $this->minimal(['registration_number' => 'CG05AP8294']))
            ->assertSessionHasErrors(['registration_number' => 'Hero HF Deluxe with this registration is already in stock.']);
        // sold: the same vehicle may be bought back
        Vehicle::sole()->update(['status' => 'sold']);
        $this->post('/autodeal/vehicles', $this->minimal())->assertSessionHasNoErrors();
        $this->assertSame(2, Vehicle::count());
    }
}

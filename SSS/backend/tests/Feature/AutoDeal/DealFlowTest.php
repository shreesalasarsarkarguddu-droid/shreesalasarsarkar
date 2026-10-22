<?php

namespace Tests\Feature\AutoDeal;

use App\AutoDeal\Models\Sale;
use App\AutoDeal\Models\Vehicle;
use App\AutoDeal\Support\Module;
use App\Models\User;
use Illuminate\Support\Facades\Storage;
use Inertia\Testing\AssertableInertia as Assert;

/** Intake → search → sale → payments → cancel → reports → receipts, on the SSS login. */
class DealFlowTest extends AutoDealTestCase
{
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = $this->dealerOwner();
    }

    private function intakePayload(array $overrides = []): array
    {
        return array_replace_recursive([
            'intake_type' => 'seized',
            'company_name' => 'Maruti Suzuki',
            'model_name' => 'Swift',
            'variant' => 'VXi',
            'model_year' => 2019,
            'color' => 'White',
            'registration_number' => 'cg 04 ab 1234',
            'chassis_number' => 'ma3 ewdc1s00123456',
            'engine_number' => 'k12mn1234567',
            'purchase_price' => 350000,
            'expected_price' => 420000,
            'intake_date' => now()->subDays(10)->toDateString(),
            'seller' => ['name' => 'Shriram Finance', 'phone' => '+91 98765-43210', 'address' => 'Raipur', 'id_proof_type' => 'other'],
        ], $overrides);
    }

    public function test_not_signed_in_goes_to_the_sss_sign_in_page(): void
    {
        $this->get('/autodeal/vehicles')->assertRedirect(Module::loginUrl());
        $this->assertStringEndsWith('/login', Module::loginUrl());
    }

    public function test_only_people_with_the_autodeal_permission(): void
    {
        $this->signedIn($this->staff('staff', ['view_accounts', 'collect']))->get('/autodeal/vehicles')->assertForbidden();
        $this->signedIn($this->dealerStaff())->get('/autodeal/vehicles')->assertOk()
            ->assertInertia(fn (Assert $p) => $p->component('Vehicles/Index')->where('auth.can.owner', false)->where('auth.user.role', 'staff'));
        $this->signedIn($this->user)->get('/autodeal/vehicles')
            ->assertInertia(fn (Assert $p) => $p->where('auth.can.owner', true)->where('auth.user.name', $this->user->full_name));
        $this->get('/autodeal')->assertRedirect('/autodeal/vehicles');
    }

    public function test_intake_creates_vehicle_seller_and_files(): void
    {
        $payload = $this->intakePayload() + [
            'seller_id_proof' => $this->jpeg('aadhaar.jpg'),
            'photos' => [['file' => $this->jpeg(), 'type' => 'front']],
        ];

        $this->signedIn($this->user)->post('/autodeal/vehicles', $payload)->assertSessionHasNoErrors()->assertRedirect();

        $vehicle = Vehicle::with('seller', 'photos')->sole();
        $this->assertSame('in_stock', $vehicle->status);
        $this->assertSame('MA3EWDC1S00123456', $vehicle->chassis_number);
        $this->assertSame('CG04AB1234', $vehicle->registration_number);
        $this->assertSame('9876543210', $vehicle->seller->phone);
        $this->assertSame($this->user->id, $vehicle->created_by);
        $this->assertStringStartsWith('autodeal/kyc/sellers/', $vehicle->seller->id_proof_path);
        Storage::disk('local')->assertExists($vehicle->seller->id_proof_path);
        Storage::disk('public')->assertExists($vehicle->photos->first()->file_path);

        // KYC file is only reachable through the signed-in route.
        $this->get(route('autodeal.files.seller', $vehicle->seller))->assertOk();
    }

    public function test_duplicate_chassis_is_rejected(): void
    {
        $this->signedIn($this->user)->post('/autodeal/vehicles', $this->intakePayload());
        $this->post('/autodeal/vehicles', $this->intakePayload())->assertSessionHasErrors('chassis_number');
        $this->assertSame(1, Vehicle::count());
    }

    public function test_dashboard_search_and_summary(): void
    {
        $this->signedIn($this->user)->post('/autodeal/vehicles', $this->intakePayload());

        $this->get('/autodeal/vehicles?q=123456')->assertInertia(fn (Assert $p) => $p
            ->component('Vehicles/Index')
            ->has('vehicles', 1));
        $this->get('/autodeal/vehicles?q=nomatch')->assertInertia(fn (Assert $p) => $p->has('vehicles', 0));
        $this->get('/autodeal/vehicles?intake_type=customer_buy')->assertInertia(fn (Assert $p) => $p->has('vehicles', 0));
    }

    public function test_sale_marks_vehicle_sold_and_tracks_balance(): void
    {
        $this->signedIn($this->user)->post('/autodeal/vehicles', $this->intakePayload());
        $vehicle = Vehicle::sole();

        $this->post(route('autodeal.sales.store', $vehicle), [
            'buyer' => ['name' => 'Ramesh Sahu', 'phone' => '9123456780', 'address' => 'Dhamtari', 'id_proof_type' => 'aadhaar'],
            'selling_price' => 410000,
            'sale_date' => now()->toDateString(),
            'payment_mode' => 'upi',
            'paid_amount' => 300000,
            'documents' => [$this->jpeg('agreement.jpg')],
        ])->assertSessionHasNoErrors()->assertRedirect(route('autodeal.vehicles.show', $vehicle));

        $sale = Sale::sole();
        $this->assertSame('sold', $vehicle->fresh()->status);
        $this->assertSame('partial', $sale->payment_status);
        $this->assertEquals(110000, $sale->balance_amount);
        $this->assertEquals(60000, $sale->profit);

        // Cannot be sold twice.
        $this->post(route('autodeal.sales.store', $vehicle), [
            'buyer' => ['name' => 'Other', 'phone' => '9000000000'],
            'selling_price' => 1, 'sale_date' => now()->toDateString(), 'payment_mode' => 'cash', 'paid_amount' => 1,
        ])->assertSessionHasErrors('selling_price');

        // Down payment is the first history row.
        $this->assertEquals([300000], $sale->payments()->pluck('amount')->map(fn ($a) => (float) $a)->all());

        // Over-paying is rejected; a follow-up instalment settles the balance.
        $this->post(route('autodeal.sales.payments.store', $sale), ['amount' => 200000, 'paid_on' => now()->toDateString(), 'mode' => 'cash'])
            ->assertSessionHasErrors('amount');
        $this->post(route('autodeal.sales.payments.store', $sale), ['amount' => 110000, 'paid_on' => now()->toDateString(), 'mode' => 'upi', 'reference' => 'UTR123'])
            ->assertSessionHasNoErrors();
        $sale->refresh();
        $this->assertSame('paid', $sale->payment_status);
        $this->assertEquals(0, $sale->balance_amount);
        $this->assertSame(2, $sale->payments()->count());

        // Cancelling puts it back in stock.
        $this->delete(route('autodeal.sales.destroy', $sale))->assertRedirect();
        $this->assertSame('in_stock', $vehicle->fresh()->status);
        $this->assertSame(0, Sale::count());
    }

    public function test_multi_word_search_cover_photo_and_archived_tab(): void
    {
        $this->signedIn($this->user)->post('/autodeal/vehicles', $this->intakePayload() + [
            'photos' => [['file' => $this->jpeg(), 'type' => 'interior']],
        ]);
        $this->post('/autodeal/vehicles', $this->intakePayload([
            'company_name' => 'Hyundai', 'model_name' => 'Creta', 'chassis_number' => 'MALCRETA00000001', 'engine_number' => 'G4FG000001',
        ]));

        $this->get('/autodeal/vehicles?q=suzuki+2019')->assertInertia(fn (Assert $p) => $p
            ->has('vehicles', 1)
            ->where('vehicles.0.model_name', 'Swift')
            // Root-relative URL, so photos survive www/non-www and domain changes.
            ->where('vehicles.0.cover_photo.url', fn ($url) => str_starts_with($url, '/storage/autodeal/vehicles/')));
        $this->get('/autodeal/vehicles?q=swift+2018')->assertInertia(fn (Assert $p) => $p->has('vehicles', 0));

        $creta = Vehicle::where('model_name', 'Creta')->sole();
        $this->patch(route('autodeal.vehicles.status', $creta), ['status' => 'archived']);
        $this->get('/autodeal/vehicles')->assertInertia(fn (Assert $p) => $p->has('vehicles', 1));
        $this->get('/autodeal/vehicles?status=archived')->assertInertia(fn (Assert $p) => $p->has('vehicles', 1)->where('vehicles.0.model_name', 'Creta'));
    }

    public function test_reloading_a_load_more_url_restarts_the_list(): void
    {
        $this->signedIn($this->user)->get('/autodeal/vehicles?page=2&status=sold')->assertRedirect('/autodeal/vehicles?status=sold');
        // The actual "Load more" request (an Inertia partial reload) is served normally.
        $manifest = public_path('autodeal-build/manifest.json');
        $this->get('/autodeal/vehicles?page=2', [
            'X-Inertia' => 'true',
            'X-Inertia-Version' => is_file($manifest) ? hash_file('xxh128', $manifest) : '',
            'X-Inertia-Partial-Data' => 'vehicles,nextPage',
            'X-Inertia-Partial-Component' => 'Vehicles/Index',
        ])->assertOk()->assertJsonPath('component', 'Vehicles/Index');
    }

    public function test_deleted_vehicle_can_be_restored_and_blocks_its_chassis(): void
    {
        $this->signedIn($this->user)->post('/autodeal/vehicles', $this->intakePayload());
        $vehicle = Vehicle::sole();
        $this->delete(route('autodeal.vehicles.destroy', $vehicle))->assertRedirect(route('autodeal.vehicles.index'));

        $this->get('/autodeal/vehicles?status=deleted')->assertInertia(fn (Assert $p) => $p->has('vehicles', 1));
        $this->post('/autodeal/vehicles', $this->intakePayload())
            ->assertSessionHasErrors(['chassis_number' => 'This chassis belongs to a deleted vehicle (2019 Maruti Suzuki Swift VXi). Restore it from the “Deleted” tab instead.']);

        $this->post(route('autodeal.vehicles.restore', $vehicle))->assertRedirect(route('autodeal.vehicles.show', $vehicle));
        $this->assertFalse($vehicle->fresh()->trashed());
    }

    public function test_friendly_error_page_when_debug_is_off(): void
    {
        config(['app.debug' => false]);
        $this->signedIn($this->user)->get('/autodeal/vehicles/999999')
            ->assertNotFound()
            ->assertInertia(fn (Assert $p) => $p->component('Error')->where('status', 404));
        // SSS's API keeps its JSON errors
        $this->getJson('/api/legacy-accounts/abc')->assertNotFound()->assertJsonPath('ok', false);
    }

    public function test_reports_and_receipts_render(): void
    {
        $this->signedIn($this->user)->post('/autodeal/vehicles', $this->intakePayload());
        $vehicle = Vehicle::sole();
        $this->post(route('autodeal.sales.store', $vehicle), [
            'buyer' => ['name' => 'Ramesh Sahu', 'phone' => '9123456780'],
            'selling_price' => 400000, 'sale_date' => now()->toDateString(), 'payment_mode' => 'cash', 'paid_amount' => 400000,
        ]);

        $this->get('/autodeal/reports')->assertInertia(fn (Assert $p) => $p
            ->component('Reports/Index')
            ->where('ledger.sale_units', 1)
            ->where('ledger.profit', 50000)
            ->has('monthly', 12)
            ->has('intakeSplit', 1));

        $this->get(route('autodeal.receipts.purchase', $vehicle))->assertOk()->assertSee($vehicle->chassis_number);
        $this->get(route('autodeal.receipts.sale', Sale::sole()).'?download=1')
            ->assertOk()
            ->assertHeader('content-type', 'application/pdf');
    }
}

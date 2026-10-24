<?php

namespace Tests\Feature\AutoDeal;

use App\AutoDeal\Models\ActivityLog;
use App\AutoDeal\Models\Branch;
use App\AutoDeal\Models\Sale;
use App\AutoDeal\Models\Vehicle;
use App\Models\User;
use App\Services\Backup;
use App\Services\DataStore;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;

/** Roles (SSS admin = owner), yards, activity log, price hints, exports, SSS backups, public catalogue. */
class OwnerFeaturesTest extends AutoDealTestCase
{
    private User $owner;

    private Branch $main;

    private Branch $raipur;

    protected function setUp(): void
    {
        parent::setUp();
        $this->main = Branch::firstWhere('name', 'Main Yard');
        $this->raipur = Branch::create(['name' => 'Raipur Yard', 'phone' => '9811111111', 'address' => 'GE Road, Raipur']);
        $this->owner = $this->dealerOwner();
    }

    private function intake(User $as, array $overrides = []): Vehicle
    {
        static $n = 0;
        $n++;
        $this->signedIn($as)->post('/autodeal/vehicles', array_replace_recursive([
            'intake_type' => 'customer_buy', 'company_name' => 'Maruti Suzuki', 'model_name' => 'Swift', 'variant' => 'VXi',
            'model_year' => 2019, 'color' => 'White', 'registration_number' => 'CG04AB12'.str_pad($n, 2, '0', STR_PAD_LEFT),
            'chassis_number' => 'MA3TEST'.str_pad($n, 10, '0', STR_PAD_LEFT), 'engine_number' => 'K12M'.str_pad($n, 6, '0', STR_PAD_LEFT),
            'purchase_price' => 300000, 'expected_price' => 360000, 'intake_date' => now()->subDays(20)->toDateString(),
            'seller' => ['name' => 'Ravi Kumar', 'phone' => '98765432'.str_pad($n, 2, '0', STR_PAD_LEFT)],
        ], $overrides))->assertSessionHasNoErrors();

        return Vehicle::latest('id')->first();
    }

    private function sell(Vehicle $v, float $price, float $paid, ?User $as = null): Sale
    {
        $this->signedIn($as ?? $this->owner)->post(route('autodeal.sales.store', $v), [
            'buyer' => ['name' => 'Buyer '.$v->id, 'phone' => '91234567'.str_pad($v->id % 100, 2, '0', STR_PAD_LEFT)],
            'selling_price' => $price, 'sale_date' => now()->toDateString(), 'payment_mode' => 'cash', 'paid_amount' => $paid,
        ])->assertSessionHasNoErrors();

        return $v->sale()->first();
    }

    // ---------------------------------------------------------------- roles

    public function test_staff_never_receive_cost_or_profit(): void
    {
        $staff = $this->dealerStaff();
        $v = $this->intake($staff, ['purchase_price' => 250000]);
        $this->assertEquals(250000, $v->purchase_price); // staff can enter it at intake…

        $this->signedIn($staff)->get('/autodeal/vehicles')->assertInertia(fn (Assert $p) => $p
            ->missing('vehicles.0.purchase_price')
            ->where('auth.can.owner', false)
            ->loadDeferredProps(fn (Assert $p) => $p->where('summary.stock_cost', null)->where('summary.stock_value', null)));

        $this->get(route('autodeal.vehicles.show', $v))->assertInertia(fn (Assert $p) => $p
            ->missing('vehicle.purchase_price')->where('vehicle.profit', null)->where('activity', []));
        $this->get(route('autodeal.vehicles.edit', $v))->assertInertia(fn (Assert $p) => $p->missing('vehicle.purchase_price'));

        // …but can't change it afterwards, even by posting the field.
        $this->put(route('autodeal.vehicles.update', $v), [...$this->payloadFrom($v), 'purchase_price' => 1])->assertSessionHasNoErrors();
        $this->assertEquals(250000, $v->fresh()->purchase_price);

        $sale = $this->sell($v, 300000, 300000, $staff);
        $this->signedIn($staff)->get('/autodeal/sales')->assertInertia(fn (Assert $p) => $p
            ->where('sales.data.0.profit', null)->missing('sales.data.0.vehicle.purchase_price'));
        $this->assertStringNotContainsString('profit', strtolower(session('success')));

        foreach ([['get', '/autodeal/reports'], ['get', '/autodeal/exports/sales'], ['get', '/autodeal/activity'], ['get', '/autodeal/branches'],
            ['delete', route('autodeal.sales.destroy', $sale)], ['post', route('autodeal.vehicles.listing', $v)], ['post', '/autodeal/branches']] as [$m, $url]) {
            $this->{$m}($url)->assertForbidden();
        }
    }

    public function test_staff_cannot_delete_and_owner_can(): void
    {
        $staff = $this->dealerStaff();
        $v = $this->intake($this->owner);

        $this->signedIn($staff)->delete(route('autodeal.vehicles.destroy', $v))->assertForbidden();
        $this->assertFalse($v->fresh()->trashed());
        $this->signedIn($this->owner)->delete(route('autodeal.vehicles.destroy', $v))->assertRedirect();
        $this->assertTrue($v->fresh()->trashed());
    }

    public function test_purchase_receipt_only_for_owner_or_the_staff_who_did_the_intake(): void
    {
        $staffA = $this->dealerStaff();
        $staffB = $this->dealerStaff();
        $v = $this->intake($staffA);

        $this->signedIn($staffA)->get(route('autodeal.receipts.purchase', $v))->assertOk();
        $this->signedIn($staffB)->get(route('autodeal.receipts.purchase', $v))->assertForbidden();
        $this->signedIn($this->owner)->get(route('autodeal.receipts.purchase', $v))->assertOk();
    }

    public function test_owner_limits_staff_to_a_yard(): void
    {
        $staff = $this->dealerStaff();
        $notDealer = $this->staff('staff', ['view_accounts']);
        $this->signedIn($this->owner)->get('/autodeal/account')->assertInertia(fn (Assert $p) => $p
            ->component('Account/Index')
            ->where('users', fn ($rows) => collect($rows)->contains(fn ($u) => $u['id'] === $staff->id && $u['role'] === 'staff')
                && ! collect($rows)->contains('id', $notDealer->id)));

        $this->put(route('autodeal.account.users.update', $staff), ['branch_id' => $this->raipur->id])->assertSessionHas('success');
        $this->assertDatabaseHas('ad_branch_user', ['user_id' => $staff->id, 'branch_id' => $this->raipur->id]);
        $this->assertSame($this->raipur->id, $staff->fresh()->dealerBranch());
        $this->assertDatabaseHas('ad_activity_logs', ['action' => 'staff.yard']);
        $this->put(route('autodeal.account.users.update', $staff), ['branch_id' => null]);
        $this->assertDatabaseMissing('ad_branch_user', ['user_id' => $staff->id]);

        // admins are never limited; people without Auto Deal can't be given a yard
        $this->put(route('autodeal.account.users.update', $this->owner), ['branch_id' => $this->raipur->id])->assertNotFound();
        $this->put(route('autodeal.account.users.update', $notDealer), ['branch_id' => $this->raipur->id])->assertNotFound();
        $this->signedIn($staff)->put(route('autodeal.account.users.update', $staff), ['branch_id' => null])->assertForbidden();
    }

    // ------------------------------------------------------------- branches

    public function test_branch_staff_only_see_their_branch_and_transfers_are_recorded(): void
    {
        $atMain = $this->intake($this->owner, ['branch_id' => $this->main->id]);
        $raipurStaff = $this->dealerStaff($this->raipur->id);

        // Intake by branch staff always lands in their branch, whatever they post.
        $atRaipur = $this->intake($raipurStaff, ['branch_id' => $this->main->id]);
        $this->assertSame($this->raipur->id, (int) $atRaipur->branch_id);

        $this->signedIn($raipurStaff)->get('/autodeal/vehicles')->assertInertia(fn (Assert $p) => $p->has('vehicles', 1)->where('vehicles.0.id', $atRaipur->id));
        $this->get(route('autodeal.vehicles.show', $atMain))->assertNotFound();
        $this->post(route('autodeal.sales.store', $atMain), [])->assertNotFound();

        // Owner filters by branch.
        $this->signedIn($this->owner)->get('/autodeal/vehicles?branch='.$this->main->id)->assertInertia(fn (Assert $p) => $p->has('vehicles', 1)->where('vehicles.0.id', $atMain->id));

        // Raipur staff transfer their car to Main – and lose sight of it.
        $this->signedIn($raipurStaff)->post(route('autodeal.vehicles.transfer', $atRaipur), [
            'to_branch_id' => $this->main->id, 'transferred_on' => now()->toDateString(), 'note' => 'Showroom display',
        ])->assertRedirect(route('autodeal.vehicles.index'));
        $this->assertSame($this->main->id, (int) $atRaipur->fresh()->branch_id);
        $this->assertDatabaseHas('ad_vehicle_transfers', ['vehicle_id' => $atRaipur->id, 'from_branch_id' => $this->raipur->id, 'to_branch_id' => $this->main->id,
            'user_id' => $raipurStaff->id]);
        $this->get(route('autodeal.vehicles.show', $atRaipur))->assertNotFound();

        // Same-branch transfer is rejected.
        $this->signedIn($this->owner)->post(route('autodeal.vehicles.transfer', $atRaipur), ['to_branch_id' => $this->main->id, 'transferred_on' => now()->toDateString()])
            ->assertSessionHasErrors('to_branch_id');

        // Branch with unsold stock can't be closed.
        $this->put(route('autodeal.branches.update', $this->main), ['name' => 'Main Yard', 'is_active' => false])->assertSessionHas('error');

        // Reports filter by branch.
        $this->sell($atMain, 350000, 350000);
        $this->get('/autodeal/reports?branch='.$this->raipur->id)->assertInertia(fn (Assert $p) => $p->where('ledger.sale_units', 0));
        $this->get('/autodeal/reports?branch='.$this->main->id)->assertInertia(fn (Assert $p) => $p->where('ledger.sale_units', 1)->where('ledger.profit', 50000));
    }

    public function test_yards_full_crud(): void
    {
        $this->signedIn($this->owner);

        // Create (+ validation)
        $this->post('/autodeal/branches', ['name' => 'Bhilai Yard', 'address' => 'Nehru Nagar', 'phone' => '9822222222'])->assertSessionHas('success');
        $this->post('/autodeal/branches', ['name' => 'Bhilai Yard'])->assertSessionHasErrors('name');
        $this->post('/autodeal/branches', ['name' => 'Durg', 'phone' => '12345'])->assertSessionHasErrors('phone');
        $bhilai = Branch::firstWhere('name', 'Bhilai Yard');

        // Read
        $this->get('/autodeal/branches')->assertInertia(fn (Assert $p) => $p
            ->component('Branches/Index')
            ->has('branches', 3)
            ->where('branches', fn ($rows) => collect($rows)->firstWhere('name', 'Bhilai Yard')['deletable'] === true));

        // Update
        $this->put(route('autodeal.branches.update', $bhilai), ['name' => 'Bhilai Showroom', 'phone' => '9833333333'])->assertSessionHas('success');
        $this->assertSame('Bhilai Showroom', $bhilai->fresh()->name);

        // Close + reopen
        $this->put(route('autodeal.branches.update', $bhilai), ['name' => 'Bhilai Showroom', 'is_active' => false])->assertSessionHas('success');
        $this->assertFalse($bhilai->fresh()->is_active);
        $this->put(route('autodeal.branches.update', $bhilai), ['name' => 'Bhilai Showroom', 'is_active' => true]);
        $this->assertTrue($bhilai->fresh()->is_active);

        // A yard with vehicle history can't be deleted (only closed)…
        $this->intake($this->owner, ['branch_id' => $this->raipur->id]);
        $this->delete(route('autodeal.branches.destroy', $this->raipur))->assertSessionHas('error');
        $this->assertModelExists($this->raipur);

        // …an empty one can; staff limited to it fall back to all yards.
        $staff = $this->dealerStaff($bhilai->id);
        $this->delete(route('autodeal.branches.destroy', $bhilai))->assertSessionHas('success');
        $this->assertModelMissing($bhilai);
        $this->assertNull($staff->fresh()->dealerBranch());
        $this->assertDatabaseHas('ad_activity_logs', ['action' => 'branch.deleted']);

        // Staff can't manage yards.
        $this->signedIn($this->dealerStaff())->get('/autodeal/branches')->assertForbidden();
        $this->delete(route('autodeal.branches.destroy', $this->main))->assertForbidden();
    }

    public function test_last_open_yard_cannot_be_closed_or_deleted(): void
    {
        $this->raipur->delete();
        $this->signedIn($this->owner)
            ->put(route('autodeal.branches.update', $this->main), ['name' => 'Main Yard', 'is_active' => false])->assertSessionHas('error');
        $this->delete(route('autodeal.branches.destroy', $this->main))->assertSessionHas('error');
        $this->assertTrue($this->main->fresh()->is_active);
    }

    // --------------------------------------------------------- activity log

    public function test_activity_log_records_who_did_what_with_diffs(): void
    {
        $v = $this->intake($this->owner);
        $this->put(route('autodeal.vehicles.update', $v), [...$this->payloadFrom($v), 'purchase_price' => 320000, 'color' => 'Red']);
        $sale = $this->sell($v, 400000, 100000);
        $this->post(route('autodeal.sales.payments.store', $sale), ['amount' => 50000, 'paid_on' => now()->toDateString(), 'mode' => 'upi']);

        $actions = ActivityLog::orderBy('id')->pluck('action')->all();
        $this->assertSame(['vehicle.created', 'vehicle.updated', 'sale.created', 'sale.payment'], $actions);

        $edit = ActivityLog::where('action', 'vehicle.updated')->sole();
        $this->assertSame($this->owner->id, $edit->user_id);
        $this->assertSame('ad_vehicle', $edit->subject_type);
        $this->assertEquals(['300000.00', 320000], $edit->changes['purchase_price']);
        $this->assertSame(['White', 'Red'], $edit->changes['color']);
        $this->assertArrayNotHasKey('updated_at', $edit->changes);

        $this->get('/autodeal/activity?area=sale')->assertInertia(fn (Assert $p) => $p->has('logs.data', 2)->where('logs.data.0.vehicle_id', $v->id)
            ->where('logs.data.0.user', $this->owner->full_name));
        $this->get(route('autodeal.vehicles.show', $v))->assertInertia(fn (Assert $p) => $p->has('activity', 4)->where('activity.0.user.full_name', $this->owner->full_name));
    }

    // ---------------------------------------------------------- price hints

    public function test_price_hint_from_past_sales(): void
    {
        foreach ([[300000, 360000], [280000, 340000]] as $i => [$cost, $price]) {
            $v = $this->intake($this->owner, ['purchase_price' => $cost, 'model_year' => 2019 + $i]);
            $this->sell($v, $price, $price);
        }

        $this->signedIn($this->owner)->getJson('/autodeal/price-hint?company=Maruti+Suzuki&model=Swift&year=2019')
            ->assertOk()
            ->assertJson(['count' => 2, 'scope' => 'similar year', 'avg_price' => 350000, 'avg_cost' => 290000, 'avg_profit' => 60000, 'avg_margin' => 17.1]);

        $this->signedIn($this->dealerStaff())->getJson('/autodeal/price-hint?company=Maruti+Suzuki&model=Swift&year=2019')
            ->assertOk()->assertJsonPath('avg_price', 350000)->assertJsonMissingPath('avg_cost')->assertJsonMissingPath('avg_margin');

        $this->getJson('/autodeal/price-hint?company=Tata&model=Nexon')->assertJson(['count' => 0]);
    }

    // -------------------------------------------------------------- exports

    public function test_csv_exports(): void
    {
        $v = $this->intake($this->owner, ['seller' => ['name' => '=HYPERLINK("http://evil")']]);
        $sold = $this->intake($this->owner, ['branch_id' => $this->raipur->id]);
        $this->sell($sold, 380000, 300000);

        $csv = $this->signedIn($this->owner)->get('/autodeal/exports/stock')->assertOk()->assertHeader('content-type', 'text/csv; charset=UTF-8')->streamedContent();
        $this->assertStringStartsWith("\xEF\xBB\xBF", $csv);
        $rows = array_map('str_getcsv', explode("\n", trim(substr($csv, 3))));
        $this->assertSame('Branch', $rows[0][0]);
        $this->assertCount(2, $rows); // header + the one unsold vehicle
        $this->assertSame($v->chassis_number, $rows[1][12]); // after the Source column
        $this->assertStringStartsWith("'=", $rows[1][17]); // formula injection neutralised

        $sales = $this->get('/autodeal/exports/sales?branch='.$this->raipur->id)->streamedContent();
        $this->assertStringContainsString('80000.00', $sales); // profit column
        $this->assertStringContainsString($sold->chassis_number, $sales);
        $this->assertStringNotContainsString($sold->chassis_number, $this->get('/autodeal/exports/sales?branch='.$this->main->id)->streamedContent());

        $dues = $this->get('/autodeal/exports/dues')->streamedContent();
        $this->assertStringContainsString('80000.00', $dues); // balance due
        $this->get('/autodeal/exports/payments?from='.now()->toDateString())->assertOk();
        $this->get('/autodeal/exports/nope')->assertNotFound();
        $this->assertDatabaseHas('ad_activity_logs', ['action' => 'export.stock']);
    }

    // ------------------------------------------------------ SSS backup + restore points

    public function test_sss_backups_include_auto_deal(): void
    {
        $v = $this->intake($this->owner, ['seller_id_proof' => $this->jpeg('aadhaar.jpg'), 'photos' => [['file' => $this->jpeg(), 'type' => 'front']]]);

        // the tables go into the backup zip and into restore points
        $this->assertContains('ad_vehicles', Backup::tables());
        $this->assertContains('ad_sales', DataStore::tables());
        $zip = Backup::zip();
        foreach (['ad_vehicles.csv', 'ad_sales.csv', 'ad_branch_user.csv', 'legacy_accounts.csv'] as $f) {
            $this->assertStringContainsString($f, $zip);
        }
        $rp = DataStore::makePoint('test');
        $this->assertSame(1, DB::table('rp_ad_vehicles')->where('rp_id', $rp)->where('id', $v->id)->count());

        // the photos and KYC documents: their own zip (on the server every night, and from Settings → Data)
        $path = tempnam(sys_get_temp_dir(), 'adf');
        try {
            $this->assertSame(2, Backup::filesZip($path));
            $bytes = file_get_contents($path);
            $this->assertStringStartsWith("PK\x03\x04", $bytes);
            $this->assertStringContainsString('private/autodeal/kyc/sellers/', $bytes);
            $this->assertStringContainsString('public/autodeal/vehicles/'.$v->id.'/', $bytes);
        } finally {
            @unlink($path);
        }
        $this->signedIn($this->dealerStaff())->get('/api/backup/autodeal-files')->assertForbidden();
    }

    // ------------------------------------------------------- public catalogue

    public function test_public_catalogue_shows_only_listed_available_vehicles_without_private_data(): void
    {
        $listed = $this->intake($this->owner, ['branch_id' => $this->raipur->id, 'photos' => [
            ['file' => $this->jpeg(), 'type' => 'front'], ['file' => $this->jpeg('rc.jpg'), 'type' => 'document'], ['file' => $this->jpeg('ch.jpg'), 'type' => 'chassis'],
        ]]);
        $hidden = $this->intake($this->owner);
        $this->signedIn($this->owner)->post(route('autodeal.vehicles.listing', $listed))->assertSessionHas('success');
        auth()->logout();

        $this->get('/autodeal/catalogue')->assertOk()->assertInertia(fn (Assert $p) => $p
            ->component('Catalogue/Index')
            ->has('vehicles', 1)
            ->where('vehicles.0.id', $listed->id)
            ->where('vehicles.0.price', 360000)
            ->where('vehicles.0.registration', fn ($r) => str_contains($r, '••'))
            ->missing('vehicles.0.purchase_price')
            ->missing('vehicles.0.chassis_number')
            ->missing('vehicles.0.engine_number'));

        $page = $this->get(route('autodeal.catalogue.show', $listed))->assertOk();
        $page->assertInertia(fn (Assert $p) => $p->has('vehicle.photos', 1)->where('vehicle.photos.0.type', 'front')->where('vehicle.branch.phone', '9811111111'));
        $page->assertSee('og:title', false)->assertSee('2019 Maruti Suzuki Swift VXi', false);
        $this->assertStringNotContainsString($listed->chassis_number, $page->getContent());

        $this->get(route('autodeal.catalogue.show', $hidden))->assertNotFound();
        $this->get('/autodeal/catalogue?q=chassis')->assertInertia(fn (Assert $p) => $p->has('vehicles', 0));
        $this->get('/autodeal/catalogue?q='.substr($listed->chassis_number, -6))->assertInertia(fn (Assert $p) => $p->has('vehicles', 0)); // no chassis probing

        // Sold vehicles drop off automatically.
        $this->sell($listed, 350000, 350000);
        auth()->logout();
        $this->get(route('autodeal.catalogue.show', $listed))->assertNotFound();
    }

    // ------------------------------------------------------------------

    private function payloadFrom(Vehicle $v): array
    {
        $v->load('seller');

        return [
            ...$v->only(['intake_type', 'company_name', 'model_name', 'variant', 'model_year', 'color', 'registration_number',
                'chassis_number', 'engine_number', 'expected_price', 'remarks']),
            'purchase_price' => (float) $v->purchase_price,
            'intake_date' => $v->intake_date->toDateString(),
            'seller' => $v->seller->only(['name', 'phone', 'address', 'id_proof_type']),
        ];
    }
}

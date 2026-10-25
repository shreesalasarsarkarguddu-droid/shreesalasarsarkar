<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\SiteSwitch;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Site on / off: while off nobody (admins too) gets a page or the API, except the power admin at /power. */
class SiteSwitchTest extends TestCase
{
    private function power(): User
    {
        $u = $this->admin();
        $u->forceFill(['is_poweradmin' => true, 'password' => 'power-admin-test-1'])->save();

        return $u;
    }

    protected function tearDown(): void
    {
        SiteSwitch::forget();
        parent::tearDown();
    }

    public function test_off_closes_everything_except_the_power_page(): void
    {
        $admin = $this->admin();
        $power = $this->power();
        SiteSwitch::set(true, 'Back at 6 PM', $power);

        $this->as($admin);
        $this->getJson('/api/me')->assertStatus(503)->assertJson(['site_off' => true, 'error' => 'Back at 6 PM']);
        $this->postJson('/api/rpc/admin_list_users')->assertStatus(503);
        $this->get('/accounts')->assertStatus(503)->assertSee('Back at 6 PM');
        $this->get('/autodeal/catalogue')->assertStatus(503);
        $this->get('/autodeal/vehicles', ['X-Inertia' => 'true'])->assertStatus(409)->assertHeader('X-Inertia-Location');
        $this->get('/power')->assertOk()->assertSee('Only the power admin can sign in here.');

        // the power admin still uses everything
        $this->as($power);
        $this->getJson('/api/me')->assertOk();
        $this->assertSame('site_off', DB::table('data_audit')->orderByDesc('id')->value('action'));
    }

    public function test_power_page_sign_in_and_switch(): void
    {
        $admin = $this->admin();
        $admin->forceFill(['password' => 'plain-admin-pass-1'])->save();
        $power = $this->power();

        $this->post('/power/login', ['email' => $admin->email, 'password' => 'plain-admin-pass-1'])->assertSessionHasErrors('email');
        $this->assertGuest('web');
        $this->post('/power/login', ['email' => $power->email, 'password' => 'power-admin-test-1'])->assertRedirect('/power');
        $this->get('/power')->assertSee('Site is ON');

        $this->post('/power/toggle', ['off' => 1, 'message' => 'Data update tonight'])->assertRedirect('/power');
        SiteSwitch::forget();
        $this->assertTrue(SiteSwitch::isOff());
        $this->get('/power')->assertSee('Site is OFF');
        $this->post('/power/toggle', ['off' => 0])->assertRedirect('/power');
        SiteSwitch::forget();
        $this->assertFalse(SiteSwitch::isOff());

        // admins cannot switch it, see or change the power admin
        $this->post('/power/logout')->assertRedirect('/power');
        $this->as($admin);
        $this->post('/power/toggle', ['off' => 1])->assertForbidden();
        $ids = collect($this->postJson('/api/rpc/admin_list_users')->assertOk()->json('data'))->pluck('user_id');
        $this->assertNotContains($power->id, $ids);
        $this->postJson('/api/rpc/admin_archive_user', ['p_user' => $power->id, 'p_archive' => true])->assertStatus(403);
        $this->postJson('/api/rpc/admin_set_password', ['p_user' => $power->id, 'p_password' => 'x-new-password-9'])->assertStatus(403);
    }

    public function test_terminal_commands(): void
    {
        $this->artisan('site:off', ['message' => 'Closed'])->assertSuccessful();
        SiteSwitch::forget();
        $this->assertTrue(SiteSwitch::isOff());
        $this->artisan('site:on')->assertSuccessful();
        SiteSwitch::forget();
        $this->assertFalse(SiteSwitch::isOff());
        $u = $this->admin();
        $this->artisan('site:poweradmin', ['email' => $u->email])->assertSuccessful();
        $this->assertTrue((bool) DB::table('users')->where('id', $u->id)->value('is_poweradmin'));
    }
}

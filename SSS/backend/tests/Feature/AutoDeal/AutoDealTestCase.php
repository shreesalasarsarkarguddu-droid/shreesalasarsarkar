<?php

namespace Tests\Feature\AutoDeal;

use App\AutoDeal\Support\Module;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Auto Deal tests run on the local database like the rest (inside a transaction that is rolled back). Its tables are
 * emptied first, inside that transaction, so every test starts from the fresh-install state (one "Main Yard").
 */
abstract class AutoDealTestCase extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Storage::fake('local');
        $this->withoutVite();
        Schema::disableForeignKeyConstraints();
        foreach (array_reverse(Module::TABLES) as $t) {
            DB::table($t)->delete();
        }
        Schema::enableForeignKeyConstraints();
        DB::table('ad_branches')->insert(['name' => 'Main Yard', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
    }

    /** An SSS admin: the Auto Deal owner. */
    protected function dealerOwner(): User
    {
        return $this->admin();
    }

    /** SSS staff with the "Auto Deal" permission, optionally limited to one yard. */
    protected function dealerStaff(?int $branchId = null): User
    {
        $u = $this->staff('staff', ['view_accounts', 'autodeal']);
        if ($branchId) {
            DB::table('ad_branch_user')->insert(['user_id' => $u->id, 'branch_id' => $branchId, 'created_at' => now(), 'updated_at' => now()]);
        }

        return $u;
    }

    /** Signed in like the browser: the session cookie of the SSS login (web guard). */
    protected function signedIn(User $u): static
    {
        $this->app['auth']->forgetGuards();

        return $this->actingAs($u, 'web');
    }

    /** A real 1×1 JPEG – UploadedFile::fake()->image() needs GD, which shared hosts/XAMPP may lack. */
    protected function jpeg(string $name = 'photo.jpg'): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'jpg');
        file_put_contents($path, base64_decode('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='));

        return new UploadedFile($path, $name, 'image/jpeg', null, true);
    }
}

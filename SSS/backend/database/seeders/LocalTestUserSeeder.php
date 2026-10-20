<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

/**
 * Logins for trying the app on this computer only: php artisan db:seed --class=LocalTestUserSeeder
 *   admin@sss.test     / local-test-admin      (admin)
 *   collector@sss.test / local-test-collector  (collection man: view accounts, collect, reports)
 * Refuses to run outside APP_ENV=local.
 */
class LocalTestUserSeeder extends Seeder
{
    public function run(): void
    {
        if (! app()->environment('local')) {
            $this->command?->error('Only on a local copy (APP_ENV=local).');

            return;
        }
        User::updateOrCreate(['email' => 'admin@sss.test'], [
            'password' => 'local-test-admin', 'full_name' => 'LOCAL ADMIN', 'role' => 'admin', 'active' => true, 'permissions' => [],
        ]);
        User::updateOrCreate(['email' => 'collector@sss.test'], [
            'password' => 'local-test-collector', 'full_name' => 'LOCAL COLLECTOR', 'role' => 'staff', 'active' => true,
            'permissions' => ['view_accounts', 'collect', 'reports'],
        ]);
    }
}

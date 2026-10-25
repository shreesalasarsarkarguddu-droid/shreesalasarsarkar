<?php

use App\Models\User;
use App\Services\Backup;
use App\Services\Notify;
use App\Support\SiteSwitch;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Emergency switch from the server's terminal (works when nobody can sign in at /power)
Artisan::command('site:on', function () {
    SiteSwitch::set(false, null, null);
    $this->info('The site is ON.');
})->purpose('Switch the whole site on');

Artisan::command('site:off {message? : What everyone sees}', function (?string $message = null) {
    SiteSwitch::set(true, $message, null);
    $this->warn('The site is OFF. Only the power admin can open it (at /power). Turn it on with: php artisan site:on');
})->purpose('Switch the whole site off');

// The power admin: signs in at /power and switches the site. Not shown on the Users page; admins cannot change it.
Artisan::command('site:poweradmin {email}', function (string $email) {
    $email = mb_strtolower(trim($email));
    $u = User::where('email', $email)->first();
    if (! $u) {
        $name = $this->ask('Name', 'Power Admin');
        $password = $this->secret('Password (12+ characters)');
        if (mb_strlen((string) $password) < 12 || $password !== $this->secret('Password again')) {
            return $this->error('The passwords are shorter than 12 characters or do not match. Nothing was saved.');
        }
        $u = User::create(['email' => $email, 'password' => $password, 'full_name' => $name, 'role' => 'admin', 'active' => true, 'permissions' => []]);
    }
    $u->forceFill(['is_poweradmin' => true, 'role' => 'admin', 'active' => true, 'archived_at' => null])->save();
    $this->info("{$u->email} is the power admin. Sign in at /power.");
})->purpose('Make (or create) the power admin login');

// The hosting's cron runs the scheduler every minute:  * * * * * php /path/to/artisan schedule:run
Schedule::call(fn () => Notify::hourly())->hourly()->name('notifications')->withoutOverlapping();
Schedule::call(fn () => Backup::nightly())->dailyAt('22:00')->name('backup')->withoutOverlapping();

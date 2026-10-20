<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// The hosting's cron runs the scheduler every minute:  * * * * * php /path/to/artisan schedule:run
Illuminate\Support\Facades\Schedule::call(fn () => App\Services\Notify::hourly())->hourly()->name('notifications')->withoutOverlapping();
Illuminate\Support\Facades\Schedule::call(fn () => App\Services\Backup::nightly())->dailyAt('22:00')->name('backup')->withoutOverlapping();

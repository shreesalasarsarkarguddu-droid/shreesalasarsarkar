<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Site on / off (supabase/migrations/..._site_switch.sql): while off, every page and the API show "site closed" to
 * everyone (admins too) except the power admin, who switches it at /power. Scheduled jobs (nightly backup) keep running.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', fn (Blueprint $t) => $t->boolean('is_poweradmin')->default(false));
        Schema::table('app_settings', function (Blueprint $t) {
            $t->boolean('site_off')->default(false);
            $t->string('site_off_message', 500)->nullable();
            $t->dateTime('site_off_changed_at', 6)->nullable();
            $t->uuid('site_off_changed_by')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('app_settings', fn (Blueprint $t) => $t->dropColumn(['site_off', 'site_off_message', 'site_off_changed_at', 'site_off_changed_by']));
        Schema::table('users', fn (Blueprint $t) => $t->dropColumn('is_poweradmin'));
    }
};

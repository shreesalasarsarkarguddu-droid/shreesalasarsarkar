<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Every collector may change the OD on a payment while this is on (supabase/migrations/..._collectors_change_od.sql);
 * a changed OD is written to the activity log.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('app_settings', fn (Blueprint $t) => $t->boolean('collectors_change_od')->default(true));
    }

    public function down(): void
    {
        Schema::table('app_settings', fn (Blueprint $t) => $t->dropColumn('collectors_change_od'));
    }
};

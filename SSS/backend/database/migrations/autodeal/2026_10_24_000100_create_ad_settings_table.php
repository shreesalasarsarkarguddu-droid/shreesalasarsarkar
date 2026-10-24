<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Auto Deal: the shop's contact details (one row), shown on the public catalogue and on receipts. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ad_settings', function (Blueprint $t) {
            $t->id();
            $t->string('shop_name', 120)->nullable();
            $t->string('tagline', 160)->nullable();
            $t->string('address', 255)->nullable();
            $t->string('phone', 15)->nullable();
            $t->string('phone2', 15)->nullable();
            $t->string('whatsapp', 15)->nullable();
            $t->string('email', 120)->nullable();
            $t->string('gstin', 20)->nullable();
            $t->string('map_url', 500)->nullable();
            $t->string('hours', 120)->nullable();
            $t->text('about')->nullable();
            $t->timestamps();
        });
        // restore-point copy (see 2026_10_21_000100_create_data_safety_tables)
        DB::statement('create table `rp_ad_settings` as select * from `ad_settings` where 1 = 0');
        DB::statement('alter table `rp_ad_settings` add `rp_id` bigint unsigned not null first, add index (`rp_id`)');
    }

    public function down(): void
    {
        Schema::dropIfExists('rp_ad_settings');
        Schema::dropIfExists('ad_settings');
    }
};

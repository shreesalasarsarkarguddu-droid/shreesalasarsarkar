<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Intake: only company, model, registration no., colour and purchase price are needed now. Model year, chassis, engine
 * and the seller may be left empty; a direct purchase can say where the vehicle came from (source / showroom).
 * The restore-point copies (rp_*) follow (CREATE TABLE AS kept their NOT NULLs).
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['ad_vehicles', 'rp_ad_vehicles'] as $table) {
            Schema::table($table, function (Blueprint $t) use ($table) {
                $t->unsignedSmallInteger('model_year')->nullable()->change();
                $t->string('chassis_number', 32)->nullable()->change();
                $t->string('engine_number', 32)->nullable()->change();
                $t->unsignedBigInteger('seller_id')->nullable()->change();
                $t->string('source', 120)->nullable()->after('intake_type');
                if ($table === 'ad_vehicles') {
                    $t->index('source');
                }
            });
        }
        foreach (['ad_sellers', 'rp_ad_sellers'] as $table) {
            Schema::table($table, fn (Blueprint $t) => $t->string('phone', 15)->nullable()->change());
        }
    }

    public function down(): void
    {
        foreach (['ad_vehicles', 'rp_ad_vehicles'] as $table) {
            Schema::table($table, function (Blueprint $t) use ($table) {
                if ($table === 'ad_vehicles') {
                    $t->dropIndex(['source']);
                }
                $t->dropColumn('source');
            });
        }
    }
};

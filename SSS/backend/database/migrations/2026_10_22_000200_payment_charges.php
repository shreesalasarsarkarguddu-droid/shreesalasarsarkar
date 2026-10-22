<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Charges on the same receipt as an EMI payment (supabase/migrations/..._payment_charges.sql): OD (delay), seize charge,
 * other with a note. paid_amount stays the EMI part; money received = paid_amount + charges. OD rate in app_settings.
 */
return new class extends Migration
{
    private const TABLES = ['payments', 'pending_payments', 'rp_payments', 'rp_pending_payments'];

    public function up(): void
    {
        Schema::table('app_settings', fn (Blueprint $t) => $t->decimal('od_per_day', 10, 2)->default(10));
        // the restore-point copies (rp_<table>) get every new column of their table too
        foreach (self::TABLES as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->decimal('od_amount', 14, 2)->default(0);
                $t->integer('od_days')->default(0);
                $t->decimal('seize_amount', 14, 2)->default(0);
                $t->decimal('other_amount', 14, 2)->default(0);
                $t->string('other_note', 100)->nullable();
                $t->decimal('charges', 14, 2)->default(0);
            });
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $table) {
            Schema::table($table, fn (Blueprint $t) => $t->dropColumn(['od_amount', 'od_days', 'seize_amount', 'other_amount', 'other_note', 'charges']));
        }
        Schema::table('app_settings', fn (Blueprint $t) => $t->dropColumn('od_per_day'));
    }
};

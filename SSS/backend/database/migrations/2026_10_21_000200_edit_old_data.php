<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Admin can edit data from the old software (supabase/migrations/..._edit_old_data.sql): accounts and receipts changed
 * in the app are marked, and receipts cancelled in the app are remembered, so an import of the files again keeps them.
 */
return new class extends Migration
{
    public function up(): void
    {
        // the restore-point copies (rp_<table>) get every new column of their table too
        foreach (['legacy_accounts', 'legacy_payments', 'rp_legacy_accounts', 'rp_legacy_payments'] as $t) {
            Schema::table($t, fn (Blueprint $b) => $b->boolean('edited_in_app')->default(false));
        }
        Schema::create('legacy_receipts_removed', function (Blueprint $t) {
            $t->enum('ledger', ['pending', 'closed']);
            $t->integer('sno');
            $t->integer('installment_no');
            $t->dateTime('removed_at', 6)->useCurrent();
            $t->uuid('removed_by')->nullable();
            $t->primary(['ledger', 'sno', 'installment_no']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('legacy_receipts_removed');
        foreach (['legacy_accounts', 'legacy_payments', 'rp_legacy_accounts', 'rp_legacy_payments'] as $t) {
            Schema::table($t, fn (Blueprint $b) => $b->dropColumn('edited_in_app'));
        }
    }
};

<?php

use App\Services\DataStore;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Restore points and uploads waiting for confirmation (the old app_private.restore_points / rpN_* / backup_jobs / import_jobs).
 *
 * MySQL commits on every CREATE / DROP TABLE, so a restore point is not a new table each time: every data table has one copy
 * table rp_<table> (same columns, no keys, plus rp_id) made here once, and saving / restoring / pruning are plain inserts and
 * deletes inside one transaction. A migration that adds a column to a data table must add it to rp_<table> too.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('restore_points', function (Blueprint $t) {
            $t->id();
            $t->dateTime('created_at', 6)->useCurrent();
            $t->foreignUuid('created_by')->nullable();
            $t->string('by_name', 120)->nullable();
            $t->string('reason', 200);
            $t->json('counts');
        });
        foreach (DataStore::TABLES as $table) {
            DB::statement("create table `rp_$table` as select * from `$table` where 1 = 0");
            DB::statement("alter table `rp_$table` add `rp_id` bigint unsigned not null first, add index (`rp_id`)");
        }

        // a backup file being restored, or old-software files being imported: rows wait here until the admin confirms
        Schema::create('staging_jobs', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->enum('kind', ['backup', 'import']);
            $t->foreignUuid('created_by');
            $t->string('file_name', 200)->nullable();
            $t->string('taken', 300)->nullable();
            $t->json('batches')->nullable();
            $t->json('checks')->nullable();
            $t->json('preview')->nullable();
            $t->enum('status', ['staged', 'done'])->default('staged');
            $t->dateTime('created_at', 6)->useCurrent();
        });
        Schema::create('staging_rows', function (Blueprint $t) {
            $t->id();
            $t->uuid('job');
            $t->string('tbl', 40);
            $t->integer('n');
            $t->longText('row');
            $t->index(['job', 'tbl', 'n']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('staging_rows');
        Schema::dropIfExists('staging_jobs');
        foreach (DataStore::TABLES as $table) {
            Schema::dropIfExists("rp_$table");
        }
        Schema::dropIfExists('restore_points');
    }
};

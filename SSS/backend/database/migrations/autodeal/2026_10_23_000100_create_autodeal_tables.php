<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Auto Deal: used-vehicle stock, sales and payments, as the ad_* tables. People are SSS logins (users.id, a UUID).
 * Every table also gets its restore-point copy rp_<table> (see 2026_10_21_000100_create_data_safety_tables).
 */
return new class extends Migration
{
    private const TABLES = ['ad_branches', 'ad_sellers', 'ad_buyers', 'ad_vehicles', 'ad_vehicle_photos', 'ad_vehicle_transfers', 'ad_sales',
        'ad_sale_documents', 'ad_sale_payments', 'ad_branch_user', 'ad_activity_logs'];

    public function up(): void
    {
        Schema::create('ad_branches', function (Blueprint $t) {
            $t->id();
            $t->string('name', 80)->unique();
            $t->string('address', 255)->nullable();
            $t->string('phone', 15)->nullable();
            $t->boolean('is_active')->default(true);
            $t->timestamps();
        });
        DB::table('ad_branches')->insert(['name' => 'Main Yard', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);

        // sellers and buyers share one shape; separate tables keep a person's sell-side and buy-side history apart
        foreach (['ad_sellers', 'ad_buyers'] as $table) {
            Schema::create($table, function (Blueprint $t) {
                $t->id();
                $t->string('name', 120);
                $t->string('phone', 15)->index();
                $t->text('address')->nullable();
                $t->enum('id_proof_type', ['aadhaar', 'driving_license', 'pan', 'voter_id', 'other'])->nullable();
                $t->string('id_proof_path')->nullable(); // private disk, never served publicly
                $t->timestamps();
            });
        }

        Schema::create('ad_vehicles', function (Blueprint $t) {
            $t->id();
            $t->enum('intake_type', ['seized', 'customer_buy'])->index();
            $t->string('company_name', 60)->index();
            $t->string('model_name', 80)->index();
            $t->string('variant', 80)->nullable();
            $t->unsignedSmallInteger('model_year')->index();
            $t->string('color', 40)->nullable();
            $t->string('registration_number', 20)->nullable()->index();
            $t->string('chassis_number', 32)->unique();
            $t->string('engine_number', 32)->index();
            $t->decimal('purchase_price', 12, 2);
            $t->decimal('expected_price', 12, 2)->nullable(); // estimated resale value
            $t->enum('status', ['in_stock', 'processing', 'reserved', 'sold', 'archived'])->default('in_stock');
            $t->boolean('is_listed')->default(false); // shown on the public catalogue
            $t->date('intake_date');
            $t->text('remarks')->nullable();
            $t->foreignId('seller_id')->constrained('ad_sellers')->restrictOnDelete();
            $t->foreignId('branch_id')->nullable()->constrained('ad_branches')->restrictOnDelete();
            $t->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->softDeletes();
            $t->index(['status', 'intake_date']);
            $t->index(['company_name', 'model_name']);
            $t->index('purchase_price');
            $t->index(['branch_id', 'status']);
            $t->index(['is_listed', 'status']);
        });

        Schema::create('ad_vehicle_photos', function (Blueprint $t) {
            $t->id();
            $t->foreignId('vehicle_id')->constrained('ad_vehicles')->cascadeOnDelete();
            $t->string('file_path');
            $t->enum('photo_type', ['front', 'rear', 'interior', 'engine', 'chassis', 'document', 'other'])->default('other');
            $t->unsignedInteger('size_kb')->nullable();
            $t->timestamps();
            $t->index(['vehicle_id', 'photo_type']);
        });

        Schema::create('ad_vehicle_transfers', function (Blueprint $t) {
            $t->id();
            $t->foreignId('vehicle_id')->constrained('ad_vehicles')->cascadeOnDelete();
            $t->foreignId('from_branch_id')->nullable()->constrained('ad_branches')->nullOnDelete();
            $t->foreignId('to_branch_id')->constrained('ad_branches')->restrictOnDelete();
            $t->date('transferred_on');
            $t->string('note', 255)->nullable();
            $t->foreignUuid('user_id')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
        });

        Schema::create('ad_sales', function (Blueprint $t) {
            $t->id();
            $t->foreignId('vehicle_id')->unique()->constrained('ad_vehicles')->restrictOnDelete();
            $t->foreignId('buyer_id')->constrained('ad_buyers')->restrictOnDelete();
            $t->decimal('selling_price', 12, 2);
            $t->date('sale_date')->index();
            $t->enum('payment_mode', ['cash', 'bank_transfer', 'upi', 'finance']);
            $t->enum('payment_status', ['paid', 'partial', 'pending'])->index();
            $t->decimal('paid_amount', 12, 2)->default(0);
            $t->decimal('balance_amount', 12, 2)->default(0);
            $t->string('financier', 120)->nullable();
            $t->text('notes')->nullable(); // remarks / terms & conditions
            $t->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
        });

        Schema::create('ad_sale_documents', function (Blueprint $t) {
            $t->id();
            $t->foreignId('sale_id')->constrained('ad_sales')->cascadeOnDelete();
            $t->string('file_path'); // private disk
            $t->string('label', 60)->nullable();
            $t->timestamps();
        });

        Schema::create('ad_sale_payments', function (Blueprint $t) {
            $t->id();
            $t->foreignId('sale_id')->constrained('ad_sales')->cascadeOnDelete();
            $t->decimal('amount', 12, 2);
            $t->date('paid_on')->index();
            $t->enum('mode', ['cash', 'bank_transfer', 'upi', 'finance']);
            $t->string('reference', 120)->nullable(); // UTR / cheque no.
            $t->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
        });

        // staff limited to one yard (no row = every yard); owners (SSS admins) are never limited
        Schema::create('ad_branch_user', function (Blueprint $t) {
            $t->id();
            $t->foreignUuid('user_id')->unique()->constrained('users')->cascadeOnDelete();
            $t->foreignId('branch_id')->constrained('ad_branches')->cascadeOnDelete();
            $t->timestamps();
        });

        Schema::create('ad_activity_logs', function (Blueprint $t) {
            $t->id();
            $t->foreignUuid('user_id')->nullable()->constrained('users')->nullOnDelete();
            $t->string('action', 40)->index(); // e.g. vehicle.created, sale.cancelled
            $t->nullableMorphs('subject');      // the vehicle / sale / yard it was about
            $t->string('description', 255);
            $t->json('changes')->nullable();    // {field: [old, new]} for edits
            $t->string('ip', 45)->nullable();
            $t->timestamp('created_at')->useCurrent()->index();
        });

        // restore-point copies: same columns, no keys, plus rp_id
        foreach (self::TABLES as $table) {
            DB::statement("create table `rp_$table` as select * from `$table` where 1 = 0");
            DB::statement("alter table `rp_$table` add `rp_id` bigint unsigned not null first, add index (`rp_id`)");
        }
    }

    public function down(): void
    {
        foreach (array_reverse(self::TABLES) as $table) {
            Schema::dropIfExists("rp_$table");
            Schema::dropIfExists($table);
        }
    }
};

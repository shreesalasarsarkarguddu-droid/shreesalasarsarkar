<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The business tables, the same as the Supabase schema (SSS/reference/pg-schema.txt).
 * Postgres-only things are replaced: jsonb/arrays -> JSON, partial / NULLS NOT DISTINCT unique indexes -> generated key columns,
 * timestamptz -> DATETIME(6) in India time. Works on MySQL 8 and MariaDB 10.4.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('app_settings', function (Blueprint $t) {
            $t->unsignedTinyInteger('id')->primary();
            $t->string('business_name', 120)->default('Shree Salasar Sarkar');
            $t->boolean('telegram_enabled')->default(false);
            $t->text('telegram_bot_token')->nullable();
            $t->string('telegram_group_id', 60)->nullable();
            $t->boolean('tg_on_payment')->default(true);
            $t->boolean('tg_on_new_loan')->default(true);
            $t->boolean('tg_on_seizure')->default(true);
            $t->boolean('tg_daily_summary')->default(true);
            $t->unsignedTinyInteger('tg_summary_hour')->default(20);
            $t->boolean('whatsapp_enabled')->default(false);
            $t->string('whatsapp_host', 200)->nullable();
            $t->text('whatsapp_api_key')->nullable();
            $t->boolean('wa_receipt')->default(true);
            $t->text('wa_receipt_template');
            $t->boolean('wa_due_reminder')->default(true);
            $t->unsignedTinyInteger('wa_reminder_days_before')->default(1);
            $t->unsignedTinyInteger('wa_reminder_hour')->default(10);
            $t->text('wa_reminder_template');
            $t->unsignedSmallInteger('review_backdate_days')->default(3);
            $t->decimal('review_above', 14, 2)->default(0);
            $t->boolean('require_receipt_books')->default(false);
            $t->boolean('restrict_to_assigned')->default(false);
            $t->dateTime('updated_at', 6)->nullable();
            $t->uuid('updated_by')->nullable();
        });
        DB::table('app_settings')->insert([
            'id' => 1,
            'wa_receipt_template' => 'Dear {name}, we have received {amount} on {date} for Folio {folio} (Receipt {receipt}). Balance: {balance}. Thank you - {business}',
            'wa_reminder_template' => 'Dear {name}, your EMI of {emi} for Folio {folio} is due on {due_date}. Please pay on time to avoid late charges. - {business}',
        ]);

        Schema::create('import_batches', function (Blueprint $t) {
            $t->id();
            $t->string('source_file', 200);
            $t->dateTime('imported_at', 6)->useCurrent();
            $t->string('imported_by', 200);
            $t->integer('total_records');
            $t->integer('imported_records');
            $t->integer('skipped_records');
            $t->integer('flagged_records');
            $t->enum('status', ['completed', 'failed']);
            $t->json('notes');
        });

        // ---------------------------------------------------------------- old software (FoxPro) accounts and receipts
        Schema::create('legacy_accounts', function (Blueprint $t) {
            $t->id();
            $t->enum('ledger', ['pending', 'closed']);
            $t->integer('sno')->unique();
            $t->integer('fno')->index();
            $t->string('fcode', 20)->nullable();
            $t->string('borrower_name', 200);
            $t->string('borrower_father', 200)->nullable();
            $t->text('borrower_address')->nullable();
            $t->string('borrower_mobile', 40)->nullable();
            $t->string('borrower_mobile2', 40)->nullable();
            $t->string('guarantor_name', 200)->nullable();
            $t->string('guarantor_father', 200)->nullable();
            $t->text('guarantor_address')->nullable();
            $t->string('guarantor_mobile', 40)->nullable();
            $t->string('guarantor_mobile2', 40)->nullable();
            $t->string('finance_mode', 40)->nullable();
            $t->string('zone', 60)->nullable()->index();
            $t->string('vehicle_condition', 40)->nullable();
            $t->string('vehicle_model', 120)->nullable();
            $t->string('vehicle_variant', 120)->nullable();
            $t->string('chassis_no', 80)->nullable();
            $t->string('engine_no', 80)->nullable();
            $t->integer('model_year')->nullable();
            $t->string('registration_no', 40)->nullable();
            $t->date('agreement_date')->nullable()->index();
            $t->integer('tenure_months')->nullable();
            $t->integer('interval_months')->nullable();
            $t->decimal('finance_amount', 14, 2);
            $t->decimal('interest_amount', 14, 2);
            $t->decimal('agreement_amount', 14, 2);
            $t->decimal('hp_amount', 14, 2);
            $t->decimal('total_amount', 14, 2);
            $t->decimal('emi_amount', 14, 2);
            $t->boolean('seized')->nullable();
            $t->json('data_flags');
            $t->text('recovery');
            $t->json('raw');
            $t->foreignId('import_batch_id')->constrained('import_batches');
            $t->decimal('legacy_paid', 14, 2)->default(0);
            $t->integer('legacy_payments_count')->default(0);
            $t->date('legacy_last_paid')->nullable();
            $t->boolean('zone_set_in_app')->default(false);
            $t->index(['ledger', 'sno']);
        });
        // search box text: name, folio, SNO, mobiles, vehicle no., father (lower case)
        DB::statement("alter table legacy_accounts add column search_text varchar(700) as (lower(concat_ws(' ', borrower_name, fno, sno,
            coalesce(borrower_mobile, ''), coalesce(borrower_mobile2, ''), coalesce(registration_no, ''), coalesce(borrower_father, '')))) stored");

        // ---------------------------------------------------------------- zones and their receipt books
        Schema::create('zones', function (Blueprint $t) {
            $t->id();
            $t->string('name', 60)->unique();
            $t->bigInteger('receipt_start');
            $t->boolean('active')->default(true);
            $t->dateTime('created_at', 6)->useCurrent();
            $t->uuid('created_by')->nullable();
        });

        Schema::create('receipt_series', function (Blueprint $t) {
            $t->id();
            $t->foreignId('zone_id')->nullable()->constrained('zones');
            $t->integer('book_no');
            $t->string('code', 80)->unique();
            $t->bigInteger('start_no');
            $t->dateTime('opened_at', 6)->useCurrent();
            $t->dateTime('closed_at', 6)->nullable();
            $t->uuid('opened_by')->nullable();
        });
        // one book number per zone (MAIN = zone 0) and one open book per zone
        DB::statement('alter table receipt_series add column zone_key bigint as (coalesce(zone_id, 0)) stored');
        DB::statement('alter table receipt_series add column open_key bigint as (case when closed_at is null then coalesce(zone_id, 0) end) stored');
        DB::statement('create unique index receipt_series_zone_book on receipt_series (zone_key, book_no)');
        DB::statement('create unique index receipt_series_one_open on receipt_series (open_key)');
        DB::table('receipt_series')->insert(['zone_id' => null, 'book_no' => 1, 'code' => 'MAIN', 'start_no' => 1]);

        Schema::create('legacy_payments', function (Blueprint $t) {
            $t->id();
            $t->enum('ledger', ['pending', 'closed']);
            $t->integer('sno')->index();
            $t->foreignId('account_id')->nullable()->constrained('legacy_accounts');
            $t->integer('installment_no');
            $t->decimal('due_amount', 14, 2)->nullable();
            $t->date('due_date')->nullable();
            $t->decimal('paid_amount', 14, 2);
            $t->date('paid_date')->nullable()->index();
            $t->decimal('balance_after', 14, 2)->nullable();
            $t->integer('delay_days')->nullable();
            $t->string('payment_mode', 20)->nullable();
            $t->string('cheque_no', 40)->nullable();
            $t->integer('receipt_no')->nullable();
            $t->json('data_flags');
            $t->json('raw');
            $t->foreignId('import_batch_id')->constrained('import_batches');
            $t->foreignId('series_id')->constrained('receipt_series');
            $t->string('receipt_book', 80)->nullable();
            $t->unique(['ledger', 'sno', 'installment_no']);
            $t->index(['account_id', 'installment_no']);
            $t->index(['series_id', 'receipt_no']);
        });

        // ---------------------------------------------------------------- new loans made in the app
        Schema::create('borrowers', function (Blueprint $t) {
            $t->id();
            $t->string('full_name', 120);
            $t->string('father_name', 120)->nullable();
            $t->string('mobile', 10)->nullable();
            $t->date('date_of_birth')->nullable();
            $t->text('address')->nullable();
            $t->dateTime('created_at', 6)->useCurrent();
            $t->uuid('created_by');
        });

        Schema::create('loans', function (Blueprint $t) {
            $t->id();
            $t->string('folio_no', 30)->unique();
            $t->string('zone', 60)->nullable()->index();
            $t->string('dealer', 120)->nullable();
            $t->enum('loan_type', ['CASH', 'BANK']);
            $t->foreignId('borrower_id')->constrained('borrowers');
            $t->string('guarantor_name', 120)->nullable();
            $t->string('guarantor_father', 120)->nullable();
            $t->string('guarantor_mobile', 10)->nullable();
            $t->text('guarantor_address')->nullable();
            $t->enum('vehicle_condition', ['NEW', 'USED']);
            $t->string('sold_by', 120)->nullable();
            $t->string('vehicle_model', 120);
            $t->string('vehicle_color', 60)->nullable();
            $t->string('chassis_no', 80)->nullable();
            $t->string('engine_no', 80)->nullable();
            $t->integer('make_year')->nullable();
            $t->string('vehicle_no', 40)->nullable();
            $t->date('insurance_expiry')->nullable();
            $t->date('agreement_date')->index();
            $t->integer('installments');
            $t->integer('interval_months');
            $t->decimal('finance_amount', 14, 2);
            $t->decimal('interest_rate', 6, 2);
            $t->decimal('agreement_amount', 14, 2)->default(0);
            $t->decimal('hp_amount', 14, 2)->default(0);
            $t->decimal('interest_amount', 14, 2);
            $t->decimal('total_amount', 14, 2);
            $t->decimal('emi_amount', 14, 2);
            $t->enum('status', ['active', 'closed', 'seized'])->default('active');
            $t->uuid('idempotency_key')->unique();
            $t->dateTime('created_at', 6)->useCurrent()->index();
            $t->uuid('created_by');
        });

        // ---------------------------------------------------------------- payments taken in the app
        Schema::create('payments', function (Blueprint $t) {
            $t->id();
            $t->foreignId('legacy_account_id')->nullable()->constrained('legacy_accounts');
            $t->foreignId('loan_id')->nullable()->constrained('loans');
            $t->integer('installment_no');
            $t->date('due_date')->nullable();
            $t->decimal('due_amount', 14, 2)->nullable();
            $t->decimal('paid_amount', 14, 2);
            $t->date('paid_date')->index();
            $t->enum('payment_mode', ['CASH', 'CHEQUE', 'SBI', 'BANK', 'SPLIT']);
            $t->string('reference_no', 30)->nullable();
            $t->string('bank_name', 60)->nullable();
            $t->bigInteger('receipt_no');
            $t->decimal('balance_after', 14, 2);
            $t->integer('delay_days')->nullable();
            $t->integer('installments_covered')->default(1);
            $t->uuid('idempotency_key')->unique();
            $t->json('parts')->nullable();
            $t->foreignId('series_id')->constrained('receipt_series');
            $t->string('receipt_book', 80)->nullable();
            $t->text('review_reason')->nullable();
            $t->uuid('reviewed_by')->nullable();
            $t->dateTime('reviewed_at', 6)->nullable();
            $t->dateTime('created_at', 6)->useCurrent()->index();
            $t->uuid('created_by');
            $t->unique(['legacy_account_id', 'installment_no']);
            $t->unique(['loan_id', 'installment_no']);
            $t->unique(['series_id', 'receipt_no'], 'payments_series_receipt_no_key');
        });

        // collection men's payments wait here for the night cash count
        Schema::create('pending_payments', function (Blueprint $t) {
            $t->id();
            $t->enum('source', ['old', 'new']);
            $t->bigInteger('ref_id');
            $t->decimal('paid_amount', 14, 2);
            $t->date('paid_date');
            $t->enum('payment_mode', ['CASH', 'CHEQUE', 'SBI', 'BANK', 'SPLIT']);
            $t->string('reference_no', 30)->nullable();
            $t->string('bank_name', 60)->nullable();
            $t->bigInteger('receipt_no');
            $t->integer('installments_covered')->default(1);
            $t->uuid('idempotency_key')->unique();
            $t->text('note')->nullable();
            $t->json('parts')->nullable();
            $t->foreignId('series_id')->constrained('receipt_series');
            $t->string('receipt_book', 80)->nullable();
            $t->uuid('created_by');
            $t->dateTime('created_at', 6)->useCurrent();
            $t->index(['source', 'ref_id']);
            $t->index(['created_by', 'created_at']);
            $t->unique(['series_id', 'receipt_no'], 'pending_payments_series_receipt_no_key');
        });

        Schema::create('adjustments', function (Blueprint $t) {
            $t->id();
            $t->foreignId('legacy_account_id')->nullable()->constrained('legacy_accounts');
            $t->foreignId('loan_id')->nullable()->constrained('loans');
            $t->enum('kind', ['penalty', 'discount', 'settle', 'reschedule']);
            $t->decimal('amount', 14, 2)->default(0);
            $t->date('entry_date');
            $t->string('reason', 300);
            $t->decimal('new_emi', 14, 2)->nullable();
            $t->date('next_due')->nullable();
            $t->dateTime('cancelled_at', 6)->nullable();
            $t->uuid('cancelled_by')->nullable();
            $t->text('cancel_reason')->nullable();
            $t->dateTime('created_at', 6)->useCurrent();
            $t->uuid('created_by');
        });

        Schema::create('seizures', function (Blueprint $t) {
            $t->id();
            $t->foreignId('legacy_account_id')->nullable()->constrained('legacy_accounts');
            $t->foreignId('loan_id')->nullable()->constrained('loans');
            $t->enum('action', ['seize', 'release']);
            $t->date('action_date');
            $t->string('remarks', 300)->nullable();
            $t->uuid('idempotency_key')->unique();
            $t->dateTime('created_at', 6)->useCurrent();
            $t->uuid('created_by');
            $t->index(['legacy_account_id', 'created_at']);
            $t->index(['loan_id', 'created_at']);
        });

        // ---------------------------------------------------------------- staff control
        Schema::create('receipt_books', function (Blueprint $t) {
            $t->id();
            $t->foreignUuid('user_id')->constrained('users');
            $t->bigInteger('from_no');
            $t->bigInteger('to_no');
            $t->date('issued_on');
            $t->string('note', 200)->nullable();
            $t->dateTime('closed_at', 6)->nullable();
            $t->foreignId('series_id')->constrained('receipt_series');
            $t->dateTime('created_at', 6)->useCurrent();
            $t->uuid('created_by');
        });

        Schema::create('cash_closings', function (Blueprint $t) {
            $t->id();
            $t->foreignUuid('user_id')->constrained('users');
            $t->date('day');
            $t->integer('receipts');
            $t->decimal('expected_cash', 14, 2);
            $t->decimal('expected_other', 14, 2);
            $t->decimal('received_amount', 14, 2);
            $t->string('note', 300)->nullable();
            $t->uuid('received_by');
            $t->dateTime('received_at', 6)->useCurrent();
            $t->unique(['user_id', 'day']);
        });

        Schema::create('collection_assignments', function (Blueprint $t) {
            $t->id();
            $t->date('day');
            $t->foreignUuid('user_id')->constrained('users');
            $t->enum('source', ['old', 'new']);
            $t->bigInteger('ref_id');
            $t->string('note', 200)->nullable();
            $t->uuid('created_by');
            $t->dateTime('created_at', 6)->useCurrent();
            $t->unique(['day', 'source', 'ref_id']);
            $t->index(['user_id', 'day']);
        });

        Schema::create('visit_remarks', function (Blueprint $t) {
            $t->id();
            $t->enum('source', ['old', 'new']);
            $t->bigInteger('ref_id');
            $t->integer('installment_no')->nullable();
            $t->string('remark', 300);
            $t->date('promise_date')->nullable()->index();
            $t->uuid('created_by');
            $t->dateTime('created_at', 6)->useCurrent()->index();
            $t->index(['source', 'ref_id']);
        });

        // ---------------------------------------------------------------- activity log and notifications
        Schema::create('data_audit', function (Blueprint $t) {
            $t->id();
            $t->dateTime('at', 6)->useCurrent()->index();
            $t->uuid('by_user')->nullable();
            $t->string('by_name', 200)->nullable();
            $t->string('action', 40);
            $t->string('subject', 300)->nullable();
            $t->json('ref')->nullable();
            $t->json('details');
            $t->index(['by_user', 'at']);
            $t->index(['action', 'at']);
        });

        Schema::create('notification_log', function (Blueprint $t) {
            $t->id();
            $t->enum('channel', ['telegram', 'whatsapp']);
            $t->string('event', 40);
            $t->string('recipient', 100);
            $t->text('message');
            $t->bigInteger('request_id')->nullable();
            $t->string('status', 20)->default('queued');
            $t->text('detail')->nullable();
            $t->string('dedupe_key', 200)->nullable()->unique();
            $t->dateTime('created_at', 6)->useCurrent()->index();
        });

        // dashboard numbers kept for a minute
        Schema::create('dashboard_cache', function (Blueprint $t) {
            $t->date('day')->primary();
            $t->json('data');
            $t->dateTime('computed_at', 6);
        });
    }

    public function down(): void
    {
        foreach (['dashboard_cache', 'notification_log', 'data_audit', 'visit_remarks', 'collection_assignments', 'cash_closings',
            'receipt_books', 'seizures', 'adjustments', 'pending_payments', 'payments', 'loans', 'borrowers', 'legacy_payments',
            'receipt_series', 'zones', 'legacy_accounts', 'import_batches', 'app_settings'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};

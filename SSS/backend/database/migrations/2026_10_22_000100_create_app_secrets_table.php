<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

/** Secrets no screen ever reads (app_private.secrets): the PIN that confirms deleting a loan completely. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('app_secrets', function (Blueprint $t) {
            $t->string('key', 60)->primary();
            $t->string('value', 255);
            $t->dateTime('updated_at', 6)->useCurrent();
        });
        DB::table('app_secrets')->insert(['key' => 'delete_pin', 'value' => Hash::make('334455'), 'updated_at' => now()->format('Y-m-d H:i:s.u')]);
    }

    public function down(): void
    {
        Schema::dropIfExists('app_secrets');
    }
};

<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Nothing to seed on a live site: the data comes from the old database (scripts/pull_from_supabase.py) and the first
     * admin is made by hand. On a local copy the two test logins are added.
     */
    public function run(): void
    {
        if (app()->environment('local')) {
            $this->call(LocalTestUserSeeder::class);
        }
    }
}

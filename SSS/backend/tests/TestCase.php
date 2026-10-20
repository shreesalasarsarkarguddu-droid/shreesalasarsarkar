<?php

namespace Tests;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

/**
 * Tests run on the local copy of the live data (SSS/scripts/pull_from_supabase.py -> MySQL "sss"),
 * each inside a transaction that is rolled back, so nothing they do is kept.
 */
abstract class TestCase extends BaseTestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        // like the React app: a same-site request, so the API uses the session cookie (Sanctum SPA)
        $this->withHeader('Referer', 'http://localhost:5173/');
    }

    /** Act as this person (forgets the previous one: the test client keeps the signed-in user between requests). */
    protected function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($u);

        return $this;
    }

    protected function staff(string $role = 'staff', array $perms = []): User
    {
        return User::create([
            'email' => 'test-'.Str::random(8).'@local.test', 'password' => 'local-test-password', 'full_name' => 'TEST '.strtoupper($role),
            'role' => $role, 'active' => true, 'permissions' => $perms,
        ]);
    }

    protected function admin(): User
    {
        return $this->staff('admin');
    }

    /** An old account that can take a payment: [sno, emi, legacy id], optionally with no zone. */
    protected function openOldAccount(bool $noZone = true): array
    {
        $a = DB::table('legacy_accounts as a')->where('a.ledger', 'pending')->where('a.emi_amount', '>', 0)
            ->when($noZone, fn ($q) => $q->whereNull('a.zone'))
            ->whereNotExists(fn ($q) => $q->from('adjustments as x')->whereColumn('x.legacy_account_id', 'a.id')->where('x.kind', 'settle')->whereNull('x.cancelled_at'))
            ->orderByDesc('a.sno')->first(['a.sno', 'a.emi_amount', 'a.id']);

        return [(int) $a->sno, $a->emi_amount, (int) $a->id];
    }

    protected function payment(string $source, int $ref, string $amount, int $receipt, array $extra = []): array
    {
        return $extra + [
            'source' => $source, 'refId' => $ref, 'idempotencyKey' => (string) Str::uuid(), 'paid_amount' => $amount,
            'paid_date' => now()->toDateString(), 'payment_mode' => 'CASH', 'receipt_no' => (string) $receipt,
            'reference_no' => '', 'bank_name' => '', 'installments_covered' => 1,
        ];
    }

    protected function freeReceipt(int $series = 1): int
    {
        $n = 880000000 + random_int(0, 9999999);
        while (DB::table('payments')->where('series_id', $series)->where('receipt_no', $n)->exists()) {
            $n++;
        }

        return $n;
    }
}

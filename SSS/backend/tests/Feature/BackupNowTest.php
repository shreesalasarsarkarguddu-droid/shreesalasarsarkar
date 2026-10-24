<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** Settings → Telegram → "Backup now": the nightly backup at once (server copy + encrypted Telegram copy). */
class BackupNowTest extends TestCase
{
    public function test_backup_now_sends_to_telegram_and_says_how_it_went(): void
    {
        $before = glob(storage_path('app/backups/*')) ?: [];
        config(['services.backup.password' => 'test-pass', 'services.backup.telegram_token' => '123:abc', 'services.backup.telegram_chat_id' => '-100']);
        $refuse = false;
        Http::fake(['api.telegram.org/*' => function () use (&$refuse) {
            return $refuse ? Http::response(['ok' => false, 'description' => 'Bad Request: chat not found'], 400) : Http::response(['ok' => true]);
        }]);

        $this->as($this->staff('staff', ['backup']));
        $this->postJson('/api/rpc/admin_backup_now')->assertStatus(403);

        $this->as($this->admin());
        $r = $this->postJson('/api/rpc/admin_backup_now')->assertOk()->json('data');
        $this->assertSame('sent', $r['telegram']);
        $this->assertStringEndsWith('.zip.enc', $r['file']);
        $this->assertGreaterThan(1000, $r['size']);
        Http::assertSent(fn ($req) => str_contains($req->url(), '/bot123:abc/sendDocument'));

        // Telegram refuses: the error comes back without the token
        $refuse = true;
        $r = $this->postJson('/api/rpc/admin_backup_now')->assertOk()->json('data');
        $this->assertSame('failed', $r['telegram']);
        $this->assertStringContainsString('chat not found', $r['error']);
        $this->assertStringNotContainsString('123:abc', $r['error']);

        // not set up: only the server copy
        config(['services.backup.password' => '']);
        $this->assertSame('off', $this->postJson('/api/rpc/admin_backup_now')->assertOk()->json('data.telegram'));

        foreach (array_diff(glob(storage_path('app/backups/*')) ?: [], $before) as $f) {
            @unlink($f); // the files this test made
        }
    }
}

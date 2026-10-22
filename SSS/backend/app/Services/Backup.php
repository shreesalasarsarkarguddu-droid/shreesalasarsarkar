<?php

namespace App\Services;

use App\AutoDeal\Support\Cloudinary;
use App\AutoDeal\Support\Module;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * The backup zip: one Excel-readable CSV per table (the same files as the old app's download, so either can be restored),
 * and the nightly copy (encrypted like the old GitHub backup: "openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt").
 * Settings (bot / gateway keys) and passwords are never in it.
 */
final class Backup
{
    /** Tables in the zip; "staff" is the logins without email or password. */
    public const TABLES = ['legacy_accounts', 'legacy_payments', 'borrowers', 'loans', 'payments', 'seizures', 'adjustments', 'receipt_books', 'cash_closings',
        'collection_assignments', 'pending_payments', 'staff', 'import_batches', 'zones', 'receipt_series', 'visit_remarks'];

    /** The tables in the zip, with Auto Deal's (ad_*) when it is installed. */
    public static function tables(): array
    {
        return Module::installed() ? [...self::TABLES, ...Module::TABLES] : self::TABLES;
    }

    private static function cell(mixed $v): string
    {
        if ($v === null) {
            return '';
        }
        $s = (string) $v;

        return preg_match('/[",\n\r]/', $s) ? '"'.str_replace('"', '""', $s).'"' : $s;
    }

    private static function csv(string $table): array
    {
        if ($table === 'staff') {
            $cols = ['user_id', 'full_name', 'role', 'active', 'permissions', 'force_logout_at', 'archived_at', 'created_at'];
            $q = DB::table('users')->orderBy('id')->selectRaw('id as user_id, full_name, role, active, permissions, force_logout_at, archived_at, created_at');
        } else {
            $cols = array_column(DB::select('select column_name as c from information_schema.columns where table_schema = database() and table_name = ?
                and coalesce(generation_expression, \'\') = \'\' order by ordinal_position', [$table]), 'c');
            $q = DB::table($table)->orderBy($cols[0])->select($cols);
        }
        $lines = [implode(',', $cols)];
        $n = 0;
        foreach ($q->cursor() as $r) {
            $r = (array) $r;
            $lines[] = implode(',', array_map(fn ($c) => self::cell($r[$c]), $cols));
            $n++;
        }

        return ["\u{FEFF}".implode("\r\n", $lines), $n]; // BOM so Excel reads names correctly
    }

    /** The zip's bytes. */
    public static function zip(): string
    {
        $z = new ZipWriter;
        $summary = [];
        foreach (self::tables() as $t) {
            [$csv, $n] = self::csv($t);
            $z->add("$t.csv", $csv);
            $summary[] = "$t: $n rows";
        }
        $z->add('README.txt', 'Backup taken '.now()->format('Y-m-d H:i:s')." India time\r\n\r\n".implode("\r\n", $summary)."\r\n");

        return $z->bytes();
    }

    /**
     * Auto Deal's uploaded files (vehicle photos, KYC documents) as a zip at $path: public/autodeal/... and
     * private/autodeal/..., the same folders under storage/app, and cloudinary/<public id> for photos kept on
     * Cloudinary (downloaded back; one that cannot be fetched is listed in cloudinary-missing.txt). Returns how many files.
     */
    public static function filesZip(string $path): int
    {
        $z = new ZipFileWriter($path);
        foreach (['public' => Storage::disk('public')->path('autodeal'), 'private' => Storage::disk('local')->path('autodeal')] as $label => $dir) {
            if (! is_dir($dir)) {
                continue;
            }
            foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS)) as $f) {
                $rel = str_replace(DIRECTORY_SEPARATOR, '/', substr($f->getPathname(), strlen($dir) + 1));
                $z->addFile("$label/autodeal/$rel", $f->getPathname());
            }
        }
        $missing = [];
        $cloud = Module::installed() ? DB::table('ad_vehicle_photos')->where('file_path', 'like', Cloudinary::PREFIX.'%')->orderBy('id')->pluck('file_path') : [];
        foreach ($cloud as $p) {
            try {
                $z->addBytes('cloudinary/'.substr($p, strlen(Cloudinary::PREFIX)), Http::timeout(30)->get(Cloudinary::url($p))->throw()->body());
            } catch (\Throwable) {
                $missing[] = $p;
            }
        }
        if ($missing) {
            $z->addBytes('cloudinary-missing.txt', implode("\r\n", $missing)."\r\n");
        }

        return $z->close();
    }

    /** Same format as "openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt" (the Data page can open it with the password). */
    public static function encrypt(string $data, string $password): string
    {
        $salt = random_bytes(8);
        $kiv = hash_pbkdf2('sha256', $password, $salt, 200000, 48, true);
        $out = openssl_encrypt($data, 'aes-256-cbc', substr($kiv, 0, 32), OPENSSL_RAW_DATA, substr($kiv, 32, 16));
        if ($out === false) {
            throw new RuntimeException('could not encrypt the backup');
        }

        return 'Salted__'.$salt.$out;
    }

    public static function decrypt(string $data, string $password): ?string
    {
        if (! str_starts_with($data, 'Salted__')) {
            return null;
        }
        $kiv = hash_pbkdf2('sha256', $password, substr($data, 8, 8), 200000, 48, true);
        $out = openssl_decrypt(substr($data, 16), 'aes-256-cbc', substr($kiv, 0, 32), OPENSSL_RAW_DATA, substr($kiv, 32, 16));

        return $out === false ? null : $out;
    }

    /**
     * Every night (scheduler, 22:00): keep the last 7 backups in storage/app/backups, and send an encrypted copy to the
     * Telegram chat in .env (BACKUP_PASSWORD, BACKUP_TELEGRAM_TOKEN, BACKUP_TELEGRAM_CHAT_ID). Without a password nothing leaves the server.
     */
    public static function nightly(): ?string
    {
        $dir = storage_path('app/backups');
        if (! is_dir($dir)) {
            mkdir($dir, 0700, true);
        }
        $pass = (string) config('services.backup.password');
        $bytes = self::zip();
        $name = 'salasar-backup-'.now()->format('Y-m-d').'.zip';
        if ($pass !== '') {
            $bytes = self::encrypt($bytes, $pass);
            $name .= '.enc';
        }
        $path = "$dir/$name";
        file_put_contents($path, $bytes);
        $files = glob("$dir/salasar-backup-*") ?: [];
        rsort($files);
        foreach (array_slice($files, 7) as $old) {
            @unlink($old);
        }
        // Auto Deal's photos and documents: kept on the server only (too big for Telegram), the last 3
        if (Module::installed()) {
            self::filesZip("$dir/autodeal-files-".now()->format('Y-m-d').'.zip');
            $files = glob("$dir/autodeal-files-*") ?: [];
            rsort($files);
            foreach (array_slice($files, 3) as $old) {
                @unlink($old);
            }
        }

        $token = (string) config('services.backup.telegram_token');
        $chat = (string) config('services.backup.telegram_chat_id');
        if ($pass !== '' && $token !== '' && $chat !== '') {
            try {
                Http::timeout(120)->attach('document', $bytes, $name)->post("https://api.telegram.org/bot$token/sendDocument", [
                    'chat_id' => $chat,
                    'caption' => "Encrypted backup $name (open it on Settings → Data → Restore from a backup file, with the backup password)",
                ])->throw();
            } catch (\Throwable $e) {
                Log::warning('nightly backup: Telegram upload failed: '.$e->getMessage());
            }
        }

        return $path;
    }
}

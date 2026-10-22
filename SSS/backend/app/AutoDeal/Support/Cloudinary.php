<?php

namespace App\AutoDeal\Support;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Vehicle photos on Cloudinary (signed upload / destroy over its REST API, no SDK).
 * A stored photo's file_path is "cld:<public_id>.<format>", e.g. "cld:autodeal/vehicles/45/01J….jpg".
 */
class Cloudinary
{
    public const PREFIX = 'cld:';

    /** [cloud, key, secret] from CLOUDINARY_URL, or null when it is not set. */
    private static function account(): ?array
    {
        $u = parse_url((string) config('autodeal.cloudinary_url'));
        if (! $u || ($u['scheme'] ?? '') !== 'cloudinary' || empty($u['host']) || empty($u['user']) || empty($u['pass'])) {
            return null;
        }

        return [$u['host'], urldecode($u['user']), urldecode($u['pass'])];
    }

    public static function enabled(): bool
    {
        return self::account() !== null;
    }

    public static function owns(?string $path): bool
    {
        return $path !== null && str_starts_with($path, self::PREFIX);
    }

    /** Public address of a stored "cld:…" photo. */
    public static function url(string $path): string
    {
        $cloud = self::account()[0] ?? (string) parse_url((string) config('autodeal.cloudinary_url'), PHP_URL_HOST);

        return "https://res.cloudinary.com/{$cloud}/image/upload/".substr($path, strlen(self::PREFIX));
    }

    /** Uploads the image file and returns its "cld:…" path. */
    public static function upload(string $file, string $folder, string $name): string
    {
        [$cloud, $key, $secret] = self::account() ?? throw new RuntimeException('Cloudinary is not set up (CLOUDINARY_URL).');
        $params = [
            'folder' => trim(config('autodeal.cloudinary_folder').'/'.$folder, '/'),
            'public_id' => $name,
            'timestamp' => time(),
        ];
        $res = Http::timeout(60)
            ->attach('file', (string) file_get_contents($file), "$name.jpg")
            ->post("https://api.cloudinary.com/v1_1/{$cloud}/image/upload", [...$params, 'api_key' => $key, 'signature' => self::sign($params, $secret)]);
        if (! $res->successful() || ! $res->json('public_id')) {
            throw new RuntimeException('Photo upload to Cloudinary failed: '.($res->json('error.message') ?? $res->status()));
        }

        return self::PREFIX.$res->json('public_id').'.'.($res->json('format') ?: 'jpg');
    }

    /** Removes a stored photo; a failure is only logged (the row is gone either way). */
    public static function destroy(string $path): void
    {
        $account = self::account();
        if (! $account || ! self::owns($path)) {
            return;
        }
        [$cloud, $key, $secret] = $account;
        $params = ['public_id' => preg_replace('/\.[a-z0-9]+$/i', '', substr($path, strlen(self::PREFIX))), 'timestamp' => time()];
        try {
            Http::timeout(30)->asForm()
                ->post("https://api.cloudinary.com/v1_1/{$cloud}/image/destroy", [...$params, 'api_key' => $key, 'signature' => self::sign($params, $secret)])
                ->throw();
        } catch (\Throwable $e) {
            Log::warning("Cloudinary: could not delete {$path}: ".$e->getMessage());
        }
    }

    /** Cloudinary's signature: sha1 of the sorted "k=v&k=v" parameters followed by the API secret. */
    private static function sign(array $params, string $secret): string
    {
        ksort($params);

        return sha1(urldecode(http_build_query($params)).$secret);
    }
}

<?php

namespace App\AutoDeal\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;

/**
 * Central place for where files land on disk.
 *  - Vehicle photos  -> "public" disk under autodeal/ (served via the storage symlink, cacheable)
 *  - ID proofs/docs  -> "local" disk under autodeal/ (storage/app/private, streamed through a signed-in route)
 */
class Uploads
{
    public static function vehiclePhoto(UploadedFile $file, int $vehicleId): string
    {
        return $file->storeAs("autodeal/vehicles/{$vehicleId}", self::name($file), 'public');
    }

    public static function privateDocument(UploadedFile $file, string $folder): string
    {
        return $file->storeAs("autodeal/kyc/{$folder}/".now()->format('Y/m'), self::name($file), 'local');
    }

    private static function name(UploadedFile $file): string
    {
        $ext = strtolower($file->guessExtension() ?: $file->getClientOriginalExtension() ?: 'jpg');

        return Str::ulid()->toBase32().'.'.$ext;
    }
}

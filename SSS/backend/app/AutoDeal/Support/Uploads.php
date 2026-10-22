<?php

namespace App\AutoDeal\Support;

use Illuminate\Http\File;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Central place for where files land. Every image is first brought to ≤ autodeal.image_kb (ImageShrink).
 *  - Vehicle photos  -> Cloudinary when CLOUDINARY_URL is set ("cld:…"), else the "public" disk under autodeal/
 *  - ID proofs/docs  -> "local" disk under autodeal/ (storage/app/private, streamed through a signed-in route)
 */
class Uploads
{
    /** Stores the photo and returns [path, size in KB]. */
    public static function vehiclePhoto(UploadedFile $file, int $vehicleId): array
    {
        $fitted = ImageShrink::fit($file->getRealPath());
        $kb = (int) ceil(filesize($fitted) / 1024);
        $name = Str::ulid()->toBase32();
        try {
            if (Cloudinary::enabled()) {
                try {
                    return [Cloudinary::upload($fitted, "vehicles/{$vehicleId}", $name), $kb];
                } catch (\Throwable $e) {
                    // Cloudinary down / wrong key / blocked: keep the photo on this server so the work is not lost
                    Log::warning('Cloudinary upload failed, photo kept on the server: '.$e->getMessage());
                }
            }
            $ext = $fitted === $file->getRealPath() ? self::ext($file) : 'jpg';

            return [Storage::disk('public')->putFileAs("autodeal/vehicles/{$vehicleId}", new File($fitted), "{$name}.{$ext}"), $kb];
        } finally {
            if ($fitted !== $file->getRealPath()) {
                @unlink($fitted);
            }
        }
    }

    public static function privateDocument(UploadedFile $file, string $folder): string
    {
        $dir = "autodeal/kyc/{$folder}/".now()->format('Y/m');
        $name = Str::ulid()->toBase32();
        if (! str_starts_with((string) $file->getMimeType(), 'image/')) {
            return $file->storeAs($dir, "{$name}.".self::ext($file), 'local'); // PDF: as it is
        }
        $fitted = ImageShrink::fit($file->getRealPath(), 'documents');
        try {
            $ext = $fitted === $file->getRealPath() ? self::ext($file) : 'jpg';

            return Storage::disk('local')->putFileAs($dir, new File($fitted), "{$name}.{$ext}");
        } finally {
            if ($fitted !== $file->getRealPath()) {
                @unlink($fitted);
            }
        }
    }

    /** Removes a stored vehicle photo, wherever it is. */
    public static function deletePhoto(string $path): void
    {
        Cloudinary::owns($path) ? Cloudinary::destroy($path) : Storage::disk('public')->delete($path);
    }

    /** Public address of a stored vehicle photo. */
    public static function photoUrl(string $path): string
    {
        return Cloudinary::owns($path) ? Cloudinary::url($path) : Storage::disk('public')->url($path);
    }

    private static function ext(UploadedFile $file): string
    {
        return strtolower($file->guessExtension() ?: $file->getClientOriginalExtension() ?: 'jpg');
    }
}

<?php

namespace App\AutoDeal\Support;

use Illuminate\Validation\ValidationException;

/**
 * Brings an image down to the size limit (config autodeal.image_kb, 200 KB) on the server, for photos the phone
 * could not shrink itself (old browser, HEIC …). JPEG quality goes down first, then the picture gets smaller.
 */
class ImageShrink
{
    /** The file to store: $file itself when it already fits, else a JPEG ≤ the limit in a temp file. */
    public static function fit(string $file, string $field = 'photos'): string
    {
        $limit = config('autodeal.image_kb') * 1024;
        if (filesize($file) <= $limit) {
            return $file;
        }
        $kb = config('autodeal.image_kb');
        if (! function_exists('imagecreatefromstring')) {
            throw ValidationException::withMessages([$field => "Each photo must be {$kb} KB or less."]);
        }
        $src = @imagecreatefromstring((string) file_get_contents($file));
        if ($src === false) {
            throw ValidationException::withMessages([$field => "This photo could not be reduced to {$kb} KB. Please send a JPG photo."]);
        }
        $src = self::upright($src, $file);
        $w = imagesx($src);
        $h = imagesy($src);
        $side = min(1600, max($w, $h));
        try {
            while ($side >= 320) {
                $scale = $side / max($w, $h);
                $img = imagecreatetruecolor(max(1, (int) round($w * $scale)), max(1, (int) round($h * $scale)));
                imagefill($img, 0, 0, imagecolorallocate($img, 255, 255, 255)); // transparent PNG parts become white
                imagecopyresampled($img, $src, 0, 0, 0, 0, imagesx($img), imagesy($img), $w, $h);
                foreach ([80, 70, 60, 50, 42] as $q) {
                    ob_start();
                    imagejpeg($img, null, $q);
                    $jpeg = (string) ob_get_clean();
                    if (strlen($jpeg) <= $limit) {
                        imagedestroy($img);
                        $out = tempnam(sys_get_temp_dir(), 'adimg');
                        file_put_contents($out, $jpeg);

                        return $out;
                    }
                }
                imagedestroy($img);
                $side = (int) floor($side * 0.8);
            }
        } finally {
            imagedestroy($src);
        }
        throw ValidationException::withMessages([$field => "This photo could not be reduced to {$kb} KB."]);
    }

    /** Phone photos carry their rotation in EXIF; turn the picture so it is the right way up. */
    private static function upright(\GdImage $img, string $file): \GdImage
    {
        $o = function_exists('exif_read_data') ? (int) (@exif_read_data($file)['Orientation'] ?? 1) : 1;
        $angle = [3 => 180, 6 => -90, 8 => 90][$o] ?? 0;
        if ($angle === 0) {
            return $img;
        }
        $turned = imagerotate($img, $angle, 0);
        if ($turned === false) {
            return $img;
        }
        imagedestroy($img);

        return $turned;
    }
}

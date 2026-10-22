<?php

namespace App\Services;

use RuntimeException;

/**
 * A zip written straight to disk, files stored as they are (photos are already compressed): for uploads that can be
 * hundreds of MB, where ZipWriter (in memory) would run out of memory. Needs no zip extension.
 */
final class ZipFileWriter
{
    /** @var resource */
    private $out;

    private string $dir = '';

    private int $count = 0;

    private int $offset = 0;

    public function __construct(string $path)
    {
        $out = fopen($path, 'wb');
        if ($out === false) {
            throw new RuntimeException("cannot write $path");
        }
        $this->out = $out;
    }

    public function addFile(string $name, string $file): void
    {
        $this->addBytes($name, (string) file_get_contents($file), (int) filemtime($file));
    }

    public function addBytes(string $name, string $content, ?int $mtime = null): void
    {
        $len = strlen($content);
        $d = getdate($mtime ?? time());
        $time = ($d['hours'] << 11) | ($d['minutes'] << 5) | intdiv($d['seconds'], 2);
        $date = (($d['year'] - 1980) << 9) | ($d['mon'] << 5) | $d['mday'];
        $common = pack('vvvvvVVVv', 20, 0x0800, 0, $time, $date, crc32($content), $len, $len, strlen($name));
        fwrite($this->out, "PK\x03\x04".$common."\x00\x00".$name);
        fwrite($this->out, $content);
        $this->dir .= "PK\x01\x02".pack('v', 20).$common.pack('vvvvVV', 0, 0, 0, 0, 0, $this->offset).$name;
        $this->offset += 30 + strlen($name) + $len;
        $this->count++;
    }

    public function close(): int
    {
        fwrite($this->out, $this->dir."PK\x05\x06".pack('vvvvVVv', 0, 0, $this->count, $this->count, strlen($this->dir), $this->offset, 0));
        fclose($this->out);

        return $this->count;
    }
}

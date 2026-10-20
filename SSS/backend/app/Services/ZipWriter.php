<?php

namespace App\Services;

/** A small zip writer (deflate, needs only zlib): shared hosting does not always have the zip extension. */
final class ZipWriter
{
    private string $data = '';

    private string $dir = '';

    private int $count = 0;

    public function add(string $name, string $content): void
    {
        $packed = gzdeflate($content, 6);
        $crc = crc32($content);
        [$time, $date] = self::dosTime(time());
        $offset = strlen($this->data);
        $common = pack('vvvvvVVVv', 20, 0x0800, 8, $time, $date, $crc, strlen($packed), strlen($content), strlen($name));
        $this->data .= "PK\x03\x04".$common."\x00\x00".$name.$packed; // the two zero bytes finish the header: no extra field
        $this->dir .= "PK\x01\x02".pack('v', 20).$common.pack('vvvvVV', 0, 0, 0, 0, 0, $offset).$name;
        $this->count++;
    }

    public function bytes(): string
    {
        return $this->data.$this->dir."PK\x05\x06".pack('vvvvVVv', 0, 0, $this->count, $this->count, strlen($this->dir), strlen($this->data), 0);
    }

    private static function dosTime(int $ts): array
    {
        $d = getdate($ts);

        return [($d['hours'] << 11) | ($d['minutes'] << 5) | intdiv($d['seconds'], 2), (($d['year'] - 1980) << 9) | ($d['mon'] << 5) | $d['mday']];
    }
}

<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * MySQL gives times as "2026-10-19 15:10:53.691772" (India time). Send them like the old app did:
 * ISO with the offset ("2026-10-19T15:10:53.691+05:30") so the browser reads them right.
 */
class IsoTimes
{
    public function handle(Request $request, Closure $next)
    {
        $res = $next($request);
        if ($res instanceof JsonResponse) {
            $res->setData(self::walk($res->getData(true)));
        }

        return $res;
    }

    public static function walk(mixed $v): mixed
    {
        if (is_array($v)) {
            foreach ($v as $k => $x) {
                $v[$k] = self::walk($x);
            }

            return $v;
        }
        if (is_string($v) && strlen($v) >= 19 && preg_match('/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d{1,6})?$/', $v, $m)) {
            return $m[1].'T'.$m[2].(isset($m[3]) ? substr($m[3], 0, 4) : '').'+05:30';
        }

        return $v;
    }
}

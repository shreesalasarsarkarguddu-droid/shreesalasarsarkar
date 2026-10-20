<?php

namespace App\Http\Controllers;

use App\Services\PaymentError;
use Illuminate\Http\JsonResponse;

abstract class Controller
{
    /** The old app's server-action result shape: { ok: false, error, fieldErrors? }. */
    protected function fail(string $error, array $fieldErrors = [], int $status = 422): JsonResponse
    {
        return response()->json(['ok' => false, 'error' => $error] + ($fieldErrors ? ['fieldErrors' => $fieldErrors] : []), $status);
    }

    protected function failFrom(PaymentError $e): JsonResponse
    {
        return $this->fail($e->getMessage(), $e->field ? [$e->field => $e->getMessage()] : [], $e->status);
    }

    protected function ok(array $data = []): JsonResponse
    {
        return response()->json(['ok' => true] + $data);
    }

    /** Positive whole number from the URL, else 404. */
    protected function id(mixed $v): int
    {
        $s = (string) $v;
        abort_unless(preg_match('/^[1-9]\d{0,17}$/', $s) === 1, 404);

        return (int) $s;
    }
}

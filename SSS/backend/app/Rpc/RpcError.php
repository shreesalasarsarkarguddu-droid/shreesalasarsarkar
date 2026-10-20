<?php

namespace App\Rpc;

use RuntimeException;

/**
 * A refused call, with the old Postgres error code so the copied screens show the same messages:
 * 42501 not allowed, 22023 bad input, P0002 not found, 23505 duplicate.
 */
class RpcError extends RuntimeException
{
    public function __construct(public readonly string $pgCode, string $message)
    {
        parent::__construct($message);
    }

    public static function notAllowed(string $msg = 'not allowed'): self
    {
        return new self('42501', $msg);
    }

    public static function bad(string $msg): self
    {
        return new self('22023', $msg);
    }

    public static function notFound(string $msg): self
    {
        return new self('P0002', $msg);
    }
}

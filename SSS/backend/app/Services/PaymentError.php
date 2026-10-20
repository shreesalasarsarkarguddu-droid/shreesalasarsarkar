<?php

namespace App\Services;

use RuntimeException;

/** A payment / money rule that refused the request; shown to the person as is. */
class PaymentError extends RuntimeException
{
    public function __construct(string $message, public readonly ?string $field = null, public readonly int $status = 422)
    {
        parent::__construct($message);
    }
}

<?php

namespace App\AutoDeal\Http\Controllers;

use App\AutoDeal\Models\Vehicle;

abstract class Controller
{
    protected function isDealerOwner(): bool
    {
        return (bool) request()->user()?->isDealerOwner();
    }

    /** 404 (not 403) so staff can't even probe for vehicles in other branches. */
    protected function ensureVisible(?Vehicle $vehicle): void
    {
        abort_unless($vehicle && $vehicle->isVisibleTo(request()->user()), 404);
    }
}

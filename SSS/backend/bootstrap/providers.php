<?php

use App\AutoDeal\AutoDealServiceProvider;
use App\Providers\AppServiceProvider;

return [
    AppServiceProvider::class,
    AutoDealServiceProvider::class, // Auto Deal (/autodeal); to remove it see App\AutoDeal\Support\Module
];

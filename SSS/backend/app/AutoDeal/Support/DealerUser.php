<?php

namespace App\AutoDeal\Support;

use App\Support\Perm;
use Illuminate\Support\Facades\DB;

/**
 * Auto Deal on the SSS login (used by App\Models\User): an SSS admin is the dealer owner (costs, profit, reports,
 * deletions); staff with the "autodeal" permission are dealer staff, optionally limited to one yard (ad_branch_user).
 */
trait DealerUser
{
    private ?int $dealerBranchId = null;

    private bool $dealerBranchLoaded = false;

    public function isDealerOwner(): bool
    {
        return $this->isAdmin();
    }

    public function canUseDealer(): bool
    {
        return Perm::can($this, 'autodeal');
    }

    /** Yard this person is limited to, or null for every yard (owners are never limited). */
    public function dealerBranch(): ?int
    {
        if ($this->isDealerOwner()) {
            return null;
        }
        if (! $this->dealerBranchLoaded) {
            $id = DB::table('ad_branch_user')->where('user_id', $this->id)->value('branch_id');
            $this->dealerBranchId = $id === null ? null : (int) $id;
            $this->dealerBranchLoaded = true;
        }

        return $this->dealerBranchId;
    }
}

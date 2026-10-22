<?php

namespace App\AutoDeal\Http\Controllers;

use App\AutoDeal\Models\Buyer;
use App\AutoDeal\Models\SaleDocument;
use App\AutoDeal\Models\Seller;
use Illuminate\Support\Facades\Storage;

/**
 * Streams KYC files from the private disk – only to logged-in staff, and only
 * for people linked to a vehicle in a branch they can see.
 */
class DocumentController extends Controller
{
    public function sellerProof(Seller $seller)
    {
        $user = request()->user();
        abort_unless($seller->vehicles()->withTrashed()->visibleTo($user)->exists(), 404);

        return $this->stream($seller->id_proof_path);
    }

    public function buyerProof(Buyer $buyer)
    {
        $user = request()->user();
        abort_unless($buyer->sales()->whereHas('vehicle', fn ($q) => $q->visibleTo($user))->exists(), 404);

        return $this->stream($buyer->id_proof_path);
    }

    public function saleDocument(SaleDocument $document)
    {
        $this->ensureVisible($document->sale->vehicle);

        return $this->stream($document->file_path);
    }

    private function stream(?string $path)
    {
        abort_unless($path && Storage::disk('local')->exists($path), 404);

        return Storage::disk('local')->response($path, null, [
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}

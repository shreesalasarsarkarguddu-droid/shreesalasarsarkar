@extends('autodeal::receipts.layout')

@section('title', $vehicle->intake_type === 'seized' ? 'Seizure / Intake Receipt' : 'Vehicle Purchase Agreement')
@section('date', $vehicle->intake_date->format('d M Y'))
@section('party_label', $vehicle->intake_type === 'seized' ? 'Seizing Authority' : 'Seller')

@section('body')
    @php $inr = fn ($v) => 'Rs. ' . \App\AutoDeal\Support\Money::format($v, 2); @endphp

    <h2>{{ $vehicle->intake_type === 'seized' ? 'Seizing Authority / Previous Owner' : 'Seller Details' }}</h2>
    <table class="grid">
        @if($vehicle->source)
            <tr><td class="k">Source / Showroom</td><td>{{ $vehicle->source }}</td></tr>
        @endif
        <tr><td class="k">Name</td><td>{{ $vehicle->seller?->name ?: '-' }}</td></tr>
        <tr><td class="k">Mobile</td><td>{{ $vehicle->seller?->phone ?: '-' }}</td></tr>
        <tr><td class="k">Address</td><td>{{ $vehicle->seller?->address ?: '-' }}</td></tr>
        <tr><td class="k">ID Proof</td><td>{{ $vehicle->seller?->id_proof_type ? strtoupper(str_replace('_', ' ', $vehicle->seller->id_proof_type)) : '-' }} {{ $vehicle->seller?->id_proof_path ? '(on file)' : '' }}</td></tr>
    </table>

    <h2>Consideration</h2>
    <table class="grid total">
        <tr><td class="k">{{ $vehicle->intake_type === 'seized' ? 'Intake Value' : 'Purchase Price' }}</td><td class="right">{{ $inr($vehicle->purchase_price) }}</td></tr>
    </table>

    @if($vehicle->remarks)
        <h2>Remarks</h2>
        <div class="terms">{{ $vehicle->remarks }}</div>
    @endif

    <h2>Declaration</h2>
    <div class="terms">The {{ $vehicle->intake_type === 'seized' ? 'party handing over' : 'seller' }} declares that the above vehicle is free from all encumbrances, theft and legal disputes up to the date and time of this receipt, and that all challans, taxes and liabilities up to this date are their responsibility. Possession of the vehicle along with keys and listed documents is handed over to {{ $business['business_name'] }} on the date mentioned above.</div>
@endsection

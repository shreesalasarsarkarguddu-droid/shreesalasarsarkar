@extends('autodeal::receipts.layout')

@section('title', 'Vehicle Sale Receipt')
@section('date', $sale->sale_date->format('d M Y'))
@section('party_label', 'Buyer')

@section('body')
    @php $inr = fn ($v) => 'Rs. ' . \App\AutoDeal\Support\Money::format($v, 2); @endphp

    <h2>Buyer Details</h2>
    <table class="grid">
        <tr><td class="k">Name</td><td>{{ $sale->buyer->name }}</td></tr>
        <tr><td class="k">Mobile</td><td>{{ $sale->buyer->phone }}</td></tr>
        <tr><td class="k">Address</td><td>{{ $sale->buyer->address ?: '-' }}</td></tr>
        <tr><td class="k">ID Proof</td><td>{{ $sale->buyer->id_proof_type ? strtoupper(str_replace('_', ' ', $sale->buyer->id_proof_type)) : '-' }} {{ $sale->buyer->id_proof_path ? '(on file)' : '' }}</td></tr>
    </table>

    <h2>Payment</h2>
    <table class="grid">
        <tr><td class="k">Selling Price</td><td class="right"><strong>{{ $inr($sale->selling_price) }}</strong></td></tr>
        <tr><td class="k">Payment Mode</td><td class="right">{{ strtoupper(str_replace('_', ' ', $sale->payment_mode)) }}{{ $sale->financier ? ' – ' . $sale->financier : '' }}</td></tr>
        <tr><td class="k">Amount Received</td><td class="right">{{ $inr($sale->paid_amount) }}</td></tr>
        <tr class="total"><td class="k">Balance Due</td><td class="right">{{ $inr($sale->balance_amount) }}</td></tr>
    </table>

    <h2>Terms &amp; Conditions</h2>
    <div class="terms">{{ $sale->notes ?: "1. The vehicle is sold on an \"as is where is\" basis after inspection and test drive by the buyer.\n2. From the date and time of this receipt, the buyer is responsible for all challans, accidents, legal and tax liabilities.\n3. RC transfer to be completed within 30 days; the buyer will bear transfer charges unless agreed otherwise.\n4. Any balance amount must be cleared as agreed; ownership documents will be handed over on full payment." }}</div>
@endsection

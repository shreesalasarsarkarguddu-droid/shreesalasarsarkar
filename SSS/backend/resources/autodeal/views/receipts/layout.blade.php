<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>@yield('title') {{ $number }}</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: 'DejaVu Sans', system-ui, sans-serif; font-size: 12px; color: #111; margin: 0; background: #fff; }
        .page { max-width: 760px; margin: 0 auto; padding: 18px; }
        h1 { font-size: 18px; margin: 0 0 2px; }
        h2 { font-size: 13px; margin: 18px 0 6px; padding: 5px 8px; background: #0f172a; color: #fff; }
        table { width: 100%; border-collapse: collapse; }
        td, th { padding: 5px 8px; vertical-align: top; text-align: left; }
        .grid td { border: 1px solid #cbd5e1; }
        .grid td.k { width: 32%; background: #f1f5f9; font-weight: bold; }
        .muted { color: #555; font-size: 11px; }
        .right { text-align: right; }
        .total td { font-size: 14px; font-weight: bold; }
        .terms { font-size: 10.5px; color: #333; line-height: 1.5; white-space: pre-line; }
        .sign td { padding-top: 48px; width: 33%; text-align: center; font-size: 11px; }
        .sign span { display: block; border-top: 1px solid #333; padding-top: 4px; margin: 0 10px; }
        .toolbar { position: sticky; top: 0; background: #0f172a; padding: 10px; text-align: center; }
        .toolbar a, .toolbar button { color: #fff; background: #2563eb; border: 0; border-radius: 8px; padding: 10px 16px; font-size: 14px; margin: 0 4px; text-decoration: none; cursor: pointer; }
        @media print { .toolbar { display: none; } .page { padding: 0; } }
    </style>
</head>
<body>
@unless($pdf)
    <div class="toolbar">
        <button onclick="window.print()">Print</button>
        <a href="?download=1">Download PDF</a>
        <a href="{{ url()->previous() === url()->current() ? route('autodeal.vehicles.index') : url()->previous() }}" style="background:#475569">Back</a>
    </div>
@endunless
<div class="page">
    <table>
        <tr>
            <td style="padding-left:0">
                <h1>{{ $business['business_name'] }}</h1>
                <div class="muted">{{ $business['business_address'] }}</div>
                <div class="muted">
                    @if($business['business_phone']) Ph: {{ $business['business_phone'] }} @endif
                    @if($business['business_email'] ?? null) &nbsp;|&nbsp; {{ $business['business_email'] }} @endif
                    @if($business['business_gstin']) &nbsp;|&nbsp; GSTIN: {{ $business['business_gstin'] }} @endif
                </div>
            </td>
            <td class="right" style="padding-right:0">
                <strong style="font-size:15px">@yield('title')</strong><br>
                <span class="muted">No: {{ $number }}</span><br>
                <span class="muted">Date: @yield('date')</span>
            </td>
        </tr>
    </table>

    <h2>Vehicle Details</h2>
    <table class="grid">
        <tr><td class="k">Make / Model</td><td>{{ $vehicle->company_name }} {{ $vehicle->model_name }} {{ $vehicle->variant }}</td></tr>
        <tr><td class="k">Model Year / Colour</td><td>{{ $vehicle->model_year }} / {{ $vehicle->color ?: '-' }}</td></tr>
        <tr><td class="k">Registration No.</td><td>{{ $vehicle->registration_number ?: '-' }}</td></tr>
        <tr><td class="k">Chassis No.</td><td><strong>{{ $vehicle->chassis_number }}</strong></td></tr>
        <tr><td class="k">Engine No.</td><td><strong>{{ $vehicle->engine_number }}</strong></td></tr>
    </table>

    @yield('body')

    <table class="sign">
        <tr>
            <td><span>@yield('party_label')</span></td>
            <td><span>Witness</span></td>
            <td><span>For {{ $business['business_name'] }}</span></td>
        </tr>
    </table>
    <p class="muted" style="margin-top:18px">Computer-generated document. Generated on {{ now()->format('d M Y, h:i A') }}.</p>
</div>
</body>
</html>

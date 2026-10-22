const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export const inr = (v) => inrFmt.format(Number(v || 0));

/** Compact Indian notation for tiles: ₹4.2L, ₹1.3Cr. */
export function inrShort(v) {
    const n = Number(v || 0);
    const abs = Math.abs(n);
    if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
    if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
    if (abs >= 1e3) return `₹${(n / 1e3).toFixed(0)}K`;
    return inr(n);
}

export const date = (d) =>
    d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** Local calendar date as YYYY-MM-DD (toISOString() is UTC and gives yesterday before 5:30 AM IST). */
export function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days since a YYYY-MM-DD date, counted in local time. */
export function daysSince(ymd) {
    const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
    const start = new Date(y, m - 1, d);
    const now = new Date();
    return Math.max(0, Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - start) / 86400000));
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const STATUS = {
    in_stock: { label: 'In Stock', cls: 'bg-emerald-100 text-emerald-800' },
    processing: { label: 'Processing', cls: 'bg-amber-100 text-amber-800' },
    reserved: { label: 'Reserved', cls: 'bg-sky-100 text-sky-800' },
    sold: { label: 'Sold', cls: 'bg-slate-200 text-slate-700' },
    archived: { label: 'Archived', cls: 'bg-slate-100 text-slate-500' },
};

export const INTAKE = { seized: 'Seized', customer_buy: 'Direct Purchase' };

export const PHOTO_TYPES = {
    front: 'Front',
    rear: 'Rear',
    interior: 'Interior',
    engine: 'Engine Bay',
    chassis: 'Chassis Plate',
    document: 'RC / Documents',
    other: 'Other',
};

export const ID_PROOFS = {
    aadhaar: 'Aadhaar',
    driving_license: 'Driving License',
    pan: 'PAN',
    voter_id: 'Voter ID',
    other: 'Other',
};

export const PAYMENT_MODES = { cash: 'Cash', bank_transfer: 'Bank Transfer', upi: 'UPI', finance: 'Finance' };

export const COMPANIES = [
    'Maruti Suzuki', 'Hyundai', 'Tata', 'Mahindra', 'Honda', 'Toyota', 'Kia', 'Renault', 'Ford',
    'Volkswagen', 'Skoda', 'MG', 'Nissan', 'Hero', 'Bajaj', 'TVS', 'Royal Enfield', 'Yamaha', 'Suzuki',
];

export function vehicleTitle(v) {
    return [v.model_year, v.company_name, v.model_name, v.variant].filter(Boolean).join(' ');
}

/**
 * Opens WhatsApp with a customer-facing vehicle summary (mobile app or WhatsApp Web).
 * No app link: vehicle pages need a staff login, and cost price is never shared.
 */
export function shareOnWhatsApp(v, phone = '') {
    const lines = [
        `*${vehicleTitle(v)}*`,
        v.color && `Colour: ${v.color}`,
        v.registration_number && `Reg No: ${v.registration_number}`,
        `Chassis: …${String(v.chassis_number).slice(-6)}`,
        v.expected_price && `Price: ${inr(v.expected_price)}`,
    ].filter(Boolean);
    const target = phone ? `91${String(phone).slice(-10)}` : '';
    window.open(`https://wa.me/${target}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');
}

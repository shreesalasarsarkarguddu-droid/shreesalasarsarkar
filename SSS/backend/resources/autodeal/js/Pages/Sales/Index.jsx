import { Head, Link, router } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';
import { Icon, Input } from '@/Components/ui';
import { date, inr, PAYMENT_MODES, vehicleTitle } from '@/lib/format';

export default function SalesIndex({ sales, filters, outstandingTotal }) {
    const [q, setQ] = useState(filters.q ?? '');
    const first = useRef(true);
    const outstanding = !!filters.outstanding;

    const go = (params) => router.get(route('autodeal.sales.index'), params, { preserveState: true, replace: true });

    useEffect(() => {
        if (first.current) return void (first.current = false);
        const t = setTimeout(() => go({ q: q || undefined, outstanding: outstanding ? 1 : undefined }), 300);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [q]);

    return (
        <>
            <Head title="Sales" />
            <div className="flex items-center justify-between">
                <h1 className="text-lg font-bold">Sales ledger</h1>
                <button
                    onClick={() => go({ q: q || undefined, outstanding: outstanding ? undefined : 1 })}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${outstanding ? 'bg-amber-500 text-white' : 'bg-white text-amber-700 ring-1 ring-amber-300'}`}
                >
                    Dues {inr(outstandingTotal)}
                </button>
            </div>

            <div className="relative mt-3">
                <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-slate-400" />
                <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buyer name or mobile" className="pl-10" />
            </div>

            <div className="mt-3 space-y-2">
                {sales.data.length === 0 && <p className="rounded-2xl bg-white p-6 text-center text-slate-500 ring-1 ring-slate-200">No sales found.</p>}
                {sales.data.map((s) => (
                    <Link key={s.id} href={route('autodeal.vehicles.show', s.vehicle_id)} className="block rounded-2xl bg-white p-3 ring-1 ring-slate-200 active:bg-slate-50">
                        <div className="flex justify-between gap-2">
                            <p className="truncate font-semibold">{vehicleTitle(s.vehicle)}</p>
                            <p className="font-bold">{inr(s.selling_price)}</p>
                        </div>
                        <div className="mt-1 flex justify-between gap-2 text-xs text-slate-500">
                            <span className="truncate">
                                {s.buyer.name} · {s.buyer.phone} · {date(s.sale_date)}
                            </span>
                            {/* profit is null for staff logins */}
                            {s.profit != null && (
                                <span className={`shrink-0 font-semibold ${s.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                                    {s.profit >= 0 ? '+' : '−'}
                                    {inr(Math.abs(s.profit))}
                                </span>
                            )}
                        </div>
                        <div className="mt-1 flex justify-between text-xs">
                            <span className="text-slate-500">{PAYMENT_MODES[s.payment_mode]}</span>
                            {s.balance_amount > 0 ? <span className="font-semibold text-amber-700">Due {inr(s.balance_amount)}</span> : <span className="text-emerald-700">Paid</span>}
                        </div>
                    </Link>
                ))}
            </div>

            <div className="mt-4 flex justify-between">
                {sales.prev_page_url ? <Link href={sales.prev_page_url} className="font-semibold text-brand-700" preserveScroll>← Newer</Link> : <span />}
                {sales.next_page_url && <Link href={sales.next_page_url} className="font-semibold text-brand-700" preserveScroll>Older →</Link>}
            </div>
        </>
    );
}

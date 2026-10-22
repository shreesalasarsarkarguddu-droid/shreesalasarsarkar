import { Head, Link, router } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/Components/ui';
import { inr } from '@/lib/format';

/** Public, customer-facing stock catalogue (no login). */
export default function Catalogue({ vehicles, nextPageUrl, prevPageUrl, filters, companies, branches, dealer }) {
    const [q, setQ] = useState(filters.q ?? '');
    const first = useRef(true);

    const apply = (next) =>
        router.get(route('autodeal.catalogue.index'), Object.fromEntries(Object.entries({ ...filters, ...next }).filter(([, v]) => v !== '' && v != null)), {
            preserveState: true,
            replace: true,
        });

    useEffect(() => {
        if (first.current) return void (first.current = false);
        const t = setTimeout(() => apply({ q }), 350);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [q]);

    return (
        <div className="min-h-dvh bg-slate-50">
            <Head title={`${dealer.name} – Vehicles in stock`} />
            <header className="bg-ink text-white">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
                    <div className="min-w-0">
                        <h1 className="truncate text-lg font-bold">{dealer.name}</h1>
                        {dealer.address && <p className="truncate text-xs text-slate-300">{dealer.address}</p>}
                    </div>
                    {dealer.phone && (
                        <a href={`tel:${dealer.phone}`} className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold">
                            <Icon name="phone" className="size-4" /> Call
                        </a>
                    )}
                </div>
            </header>

            <main className="mx-auto max-w-5xl px-4 py-4">
                <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative flex-1">
                        <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-slate-400" />
                        <input
                            type="search"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Search make, model, colour, year…"
                            className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-3 pl-10 outline-none focus:border-brand-500"
                        />
                    </div>
                    <div className="flex gap-2">
                        <select value={filters.company ?? ''} onChange={(e) => apply({ company: e.target.value })} className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 sm:flex-none">
                            <option value="">All makes</option>
                            {companies.map((c) => (
                                <option key={c}>{c}</option>
                            ))}
                        </select>
                        <select value={filters.max_price ?? ''} onChange={(e) => apply({ max_price: e.target.value })} className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 sm:flex-none">
                            <option value="">Any budget</option>
                            {[100000, 300000, 500000, 800000, 1200000].map((p) => (
                                <option key={p} value={p}>
                                    Under {inr(p)}
                                </option>
                            ))}
                        </select>
                        {branches.length > 1 && (
                            <select value={filters.branch ?? ''} onChange={(e) => apply({ branch: e.target.value })} className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 sm:flex-none">
                                <option value="">All locations</option>
                                {branches.map((b) => (
                                    <option key={b.id} value={b.id}>
                                        {b.name}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>

                {vehicles.length === 0 ? (
                    <p className="mt-6 rounded-2xl bg-white p-8 text-center text-slate-500 ring-1 ring-slate-200">No vehicles match right now. Call us – new stock arrives every week.</p>
                ) : (
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {vehicles.map((v) => (
                            <Link key={v.id} href={route('autodeal.catalogue.show', v.id)} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 active:scale-[0.99]">
                                <div className="relative aspect-[4/3] bg-slate-100">
                                    {v.photos[0] ? (
                                        <img src={v.photos[0].url} alt={v.title} loading="lazy" decoding="async" className="size-full object-cover" />
                                    ) : (
                                        <div className="flex size-full items-center justify-center text-slate-300">
                                            <Icon name="car" className="size-14" />
                                        </div>
                                    )}
                                    {v.reserved && <span className="absolute top-2 left-2 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">Reserved</span>}
                                    {v.photo_count > 1 && (
                                        <span className="absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">
                                            <Icon name="camera" className="mr-0.5 inline size-3.5" /> {v.photo_count}
                                        </span>
                                    )}
                                </div>
                                <div className="p-3">
                                    <h2 className="truncate font-semibold">{v.title}</h2>
                                    <p className="truncate text-xs text-slate-500">
                                        {[v.color, v.registration, v.branch && branches.length > 1 ? v.branch.name : null].filter(Boolean).join(' · ')}
                                    </p>
                                    <p className="mt-1 text-lg font-bold text-brand-700">{v.price ? inr(v.price) : 'Price on request'}</p>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}

                <div className="mt-5 flex justify-between">
                    {prevPageUrl ? <Link href={prevPageUrl} className="font-semibold text-brand-700">← Previous</Link> : <span />}
                    {nextPageUrl && <Link href={nextPageUrl} className="font-semibold text-brand-700">More vehicles →</Link>}
                </div>
            </main>

            <footer className="pb-8 text-center text-xs text-slate-400">Prices are indicative and may change. Subject to availability.</footer>
        </div>
    );
}

import { Deferred, Head, Link, router, usePage } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';
import SaleModal from '@/Components/SaleModal';
import StockCard from '@/Components/StockCard';
import { Button, Field, Icon, Input, Select, Sheet } from '@/Components/ui';
import { INTAKE, inrShort, STATUS } from '@/lib/format';

// "All" hides archived vehicles; they (and soft-deleted ones) have their own tabs.
const STATUS_TABS = { '': 'All', in_stock: 'In Stock', processing: 'Processing', reserved: 'Reserved', sold: 'Sold', archived: 'Archived' };

export default function Index({ vehicles, nextPage, filters, summary, companies }) {
    const { auth, branches } = usePage().props;
    const owner = auth.can.owner;
    // Only owners can restore, so only they get the Deleted tab.
    const tabs = owner ? { ...STATUS_TABS, deleted: 'Deleted' } : STATUS_TABS;
    const [q, setQ] = useState(filters.q ?? '');
    const [showFilters, setShowFilters] = useState(false);
    const [selling, setSelling] = useState(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const first = useRef(true);

    function apply(next) {
        const params = Object.fromEntries(Object.entries({ ...filters, ...next }).filter(([, v]) => v !== '' && v != null));
        router.get(route('autodeal.vehicles.index'), params, {
            preserveState: true,
            preserveScroll: true,
            replace: true,
            reset: ['vehicles'], // new filter → replace the merged list instead of appending
            only: ['vehicles', 'nextPage', 'filters'],
        });
    }

    // Debounced live search (300 ms) – feels instant without hammering shared hosting.
    useEffect(() => {
        if (first.current) {
            first.current = false;
            return;
        }
        const t = setTimeout(() => apply({ q }), 300);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [q]);

    function loadMore() {
        router.get(route('autodeal.vehicles.index'), { ...filters, page: nextPage }, {
            preserveState: true,
            preserveScroll: true,
            replace: true,
            only: ['vehicles', 'nextPage'],
            onStart: () => setLoadingMore(true),
            onFinish: () => setLoadingMore(false),
        });
    }

    const activeFilters = ['intake_type', 'company', 'year', 'min_price', 'max_price', 'branch', 'listed'].filter((k) => filters[k] != null && filters[k] !== '').length;

    return (
        <>
            <Head title="Stock" />

            {owner && (
                <div className="mb-2 flex justify-end">
                    <a href={route('autodeal.catalogue.index')} target="_blank" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700">
                        <Icon name="share" className="size-4" /> Public catalogue
                    </a>
                </div>
            )}
            <Deferred data="summary" fallback={<SummarySkeleton />}>
                <Summary summary={summary} owner={owner} />
            </Deferred>

            {/* Search */}
            <div className="sticky top-14 z-20 -mx-4 bg-slate-100/95 px-4 pt-3 pb-2 backdrop-blur">
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-slate-400" />
                        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Model, reg, chassis, engine no…" className="pl-10" enterKeyHint="search" />
                    </div>
                    <button onClick={() => setShowFilters(true)} className="relative rounded-xl bg-white px-3 ring-1 ring-slate-300" aria-label="Filters">
                        <Icon name="filter" />
                        {activeFilters > 0 && <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">{activeFilters}</span>}
                    </button>
                </div>
                <div className="scrollbar-none mt-2 flex gap-1.5 overflow-x-auto">
                    {Object.entries(tabs).map(([k, label]) => (
                        <button
                            key={k}
                            onClick={() => apply({ status: k })}
                            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${(filters.status ?? '') === k ? 'bg-ink text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* List */}
            <div className="mt-2 space-y-3">
                {vehicles.length === 0 ? (
                    <div className="rounded-2xl bg-white p-8 text-center text-slate-500 ring-1 ring-slate-200">
                        <Icon name="car" className="mx-auto size-10 text-slate-300" />
                        <p className="mt-2">No vehicles match.</p>
                        <Link href={route('autodeal.vehicles.create')} className="mt-3 inline-block font-semibold text-brand-700">
                            + Add a vehicle
                        </Link>
                    </div>
                ) : (
                    vehicles.map((v) => <StockCard key={v.id} vehicle={v} onSell={setSelling} />)
                )}
                {nextPage && (
                    <Button variant="outline" className="w-full" onClick={loadMore} loading={loadingMore}>
                        Load more
                    </Button>
                )}
            </div>

            <FilterSheet
                open={showFilters}
                onClose={() => setShowFilters(false)}
                filters={filters}
                companies={companies}
                branches={branches}
                owner={owner}
                onApply={(f) => {
                    apply(f);
                    setShowFilters(false);
                }}
            />
            {selling && <SaleModal vehicle={selling} onClose={() => setSelling(null)} />}
        </>
    );
}

function Summary({ summary, owner }) {
    const tiles = owner
        ? [
              { label: 'Available', value: summary.available_units, sub: `${summary.by_status.processing} processing` },
              { label: 'Stock cost', value: inrShort(summary.stock_cost), sub: 'capital tied up' },
              { label: 'Est. value', value: inrShort(summary.stock_value), sub: `${summary.by_status.sold} sold total` },
          ]
        : [
              { label: 'In stock', value: summary.by_status.in_stock, sub: 'ready to sell' },
              { label: 'Processing', value: summary.by_status.processing, sub: 'documentation' },
              { label: 'Reserved', value: summary.by_status.reserved, sub: `${summary.by_status.sold} sold total` },
          ];
    return (
        <div className="grid grid-cols-3 gap-2">
            {tiles.map((t) => (
                <div key={t.label} className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
                    <p className="text-[11px] font-medium text-slate-500 uppercase">{t.label}</p>
                    <p className="mt-0.5 text-lg font-bold leading-tight">{t.value}</p>
                    <p className="truncate text-[11px] text-slate-500">{t.sub}</p>
                </div>
            ))}
        </div>
    );
}

function SummarySkeleton() {
    return (
        <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
                <div key={i} className="h-[74px] animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />
            ))}
        </div>
    );
}

function FilterSheet({ open, onClose, filters, companies, branches, owner, onApply }) {
    const [f, setF] = useState(filters);
    useEffect(() => setF(filters), [filters, open]);
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    const years = Array.from({ length: 25 }, (_, i) => new Date().getFullYear() - i);

    return (
        <Sheet
            open={open}
            onClose={onClose}
            title="Filters"
            footer={
                <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => onApply({ intake_type: '', company: '', year: '', min_price: '', max_price: '', branch: '', listed: '' })}>
                        Clear
                    </Button>
                    <Button className="flex-[2]" onClick={() => onApply(f)}>
                        Show results
                    </Button>
                </div>
            }
        >
            <div className="space-y-3">
                <Field label="Intake type">
                    <Select options={INTAKE} placeholder="Any" value={f.intake_type ?? ''} onChange={set('intake_type')} />
                </Field>
                <Field label="Company">
                    <Select options={Object.fromEntries((companies ?? []).map((c) => [c, c]))} placeholder="Any" value={f.company ?? ''} onChange={set('company')} />
                </Field>
                <Field label="Model year">
                    <Select options={Object.fromEntries(years.map((y) => [y, y]))} placeholder="Any" value={f.year ?? ''} onChange={set('year')} />
                </Field>
                {branches.length > 1 && (
                    <Field label="Branch">
                        <Select options={branches.map((b) => [b.id, b.name])} placeholder="All branches" value={f.branch ?? ''} onChange={set('branch')} />
                    </Field>
                )}
                {owner && (
                    <>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Min cost (₹)">
                                <Input type="number" inputMode="numeric" value={f.min_price ?? ''} onChange={set('min_price')} />
                            </Field>
                            <Field label="Max cost (₹)">
                                <Input type="number" inputMode="numeric" value={f.max_price ?? ''} onChange={set('max_price')} />
                            </Field>
                        </div>
                        <Field label="Public catalogue">
                            <Select options={{ 1: 'Listed online', 0: 'Not listed' }} placeholder="Any" value={f.listed ?? ''} onChange={set('listed')} />
                        </Field>
                    </>
                )}
                <Field label="Status">
                    <Select options={Object.fromEntries(Object.entries(STATUS).map(([k, s]) => [k, s.label]))} placeholder="Any" value={f.status ?? ''} onChange={set('status')} />
                </Field>
            </div>
        </Sheet>
    );
}

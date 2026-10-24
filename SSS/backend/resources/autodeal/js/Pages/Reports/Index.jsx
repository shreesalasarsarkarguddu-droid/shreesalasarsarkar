import { Deferred, Head, Link, router, usePage } from '@inertiajs/react';
import { useState } from 'react';
import { Card, Field, Icon, Input, Select } from '@/Components/ui';
import { inr, inrShort, INTAKE, MONTHS } from '@/lib/format';

export default function Reports({ year, branch, years, ledger, monthly, intakeSplit, sources = [], aging, profitability }) {
    const { branches } = usePage().props;
    const go = (params) => router.get(route('autodeal.reports.index'), { year, branch: branch || undefined, ...params }, { preserveScroll: true });

    return (
        <>
            <Head title="Reports" />
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-lg font-bold">Reports</h1>
                <div className="flex gap-2">
                    {branches.length > 1 && (
                        <select value={branch ?? ''} onChange={(e) => go({ branch: e.target.value || undefined })} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
                            <option value="">All branches</option>
                            {branches.map((b) => (
                                <option key={b.id} value={b.id}>
                                    {b.name}
                                </option>
                            ))}
                        </select>
                    )}
                    <select value={year} onChange={(e) => go({ year: e.target.value })} className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold">
                        {years.map((y) => <option key={y}>{y}</option>)}
                    </select>
                </div>
            </div>

            {/* Owner tools */}
            <div className="mt-3 grid grid-cols-3 gap-2">
                <Link href={route('autodeal.branches.index')} className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2.5 text-sm font-semibold ring-1 ring-slate-200">
                    <Icon name="car" className="size-5 text-slate-500" /> Yards
                </Link>
                <Link href={route('autodeal.activity.index')} className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2.5 text-sm font-semibold ring-1 ring-slate-200">
                    <Icon name="eye" className="size-5 text-slate-500" /> Activity log
                </Link>
                <Link href={route('autodeal.account')} className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2.5 text-sm font-semibold ring-1 ring-slate-200">
                    <Icon name="user" className="size-5 text-slate-500" /> Staff
                </Link>
            </div>

            {/* Ledger tiles */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile label="Purchased" value={inrShort(ledger.purchase_total)} sub={`${ledger.purchase_units} vehicles`} />
                <Tile label="Sales" value={inrShort(ledger.revenue)} sub={`${ledger.sale_units} vehicles`} />
                <Tile label="Net profit" value={inrShort(ledger.profit)} sub={`${ledger.margin}% margin`} tone={ledger.profit >= 0 ? 'good' : 'bad'} />
                <Tile label="Outstanding" value={inrShort(ledger.outstanding)} sub="all-time dues" tone={ledger.outstanding > 0 ? 'warn' : undefined} />
            </div>

            <MonthlyChart monthly={monthly} />

            <Card className="mt-4">
                <h2 className="font-bold">Seized vs Direct Purchase · {year}</h2>
                <div className="mt-3 grid grid-cols-2 gap-2">
                    {['seized', 'customer_buy'].map((t) => {
                        const r = intakeSplit.find((x) => x.intake_type === t) ?? { units: 0, cost: 0, sold_units: 0, revenue: 0, profit: 0 };
                        return (
                            <div key={t} className="rounded-xl bg-slate-50 p-3 text-sm">
                                <p className="font-semibold">{INTAKE[t]}</p>
                                <p className="mt-1 text-2xl font-bold">{r.units}</p>
                                <p className="text-xs text-slate-500">taken in · cost {inrShort(r.cost)}</p>
                                <p className="mt-2 text-xs">
                                    Sold {r.sold_units} · {inrShort(r.revenue)}
                                </p>
                                <p className={`text-xs font-semibold ${r.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>Profit {inr(r.profit)}</p>
                            </div>
                        );
                    })}
                </div>
            </Card>

            {sources.length > 0 && (
                <Card className="mt-4">
                    <h2 className="font-bold">Direct purchases by source · {year}</h2>
                    <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-left text-xs text-slate-500">
                                <tr>
                                    <th className="py-1.5 pr-2">Source / showroom</th>
                                    <th className="py-1.5 pr-2 text-right">Bought</th>
                                    <th className="py-1.5 pr-2 text-right">Cost</th>
                                    <th className="py-1.5 pr-2 text-right">Sold</th>
                                    <th className="py-1.5 text-right">Profit</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {sources.map((s) => (
                                    <tr key={s.source ?? ''}>
                                        <td className="py-1.5 pr-2">{s.source ?? <span className="text-slate-400">Not given</span>}</td>
                                        <td className="py-1.5 pr-2 text-right">{s.units}</td>
                                        <td className="py-1.5 pr-2 text-right">{inrShort(s.cost)}</td>
                                        <td className="py-1.5 pr-2 text-right">{s.sold_units}</td>
                                        <td className={`py-1.5 text-right font-semibold ${s.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{inr(s.profit)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            <Deferred data={['aging', 'profitability']} fallback={<div className="mt-4 h-40 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />}>
                <Aging aging={aging} />
                <Profitability rows={profitability} />
            </Deferred>

            <Exports branch={branch} branches={branches} />
        </>
    );
}

const EXPORTS = [
    ['stock', 'Current stock', false],
    ['purchases', 'Purchases', true],
    ['sales', 'Sales + profit', true],
    ['payments', 'Payments received', true],
    ['dues', 'Outstanding dues', false],
];

/** CSV downloads for the CA (opens in Excel / Google Sheets). Date range applies where it makes sense. */
/** Indian financial year starts 1 April. */
function financialYearStart() {
    const d = new Date();
    return `${d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1}-04-01`;
}

function Exports({ branch, branches }) {
    const [from, setFrom] = useState(financialYearStart);
    const [to, setTo] = useState('');
    const [exportBranch, setExportBranch] = useState(branch ?? '');

    const href = (type, dated) => {
        const params = new URLSearchParams();
        if (dated && from) params.set('from', from);
        if (dated && to) params.set('to', to);
        if (exportBranch) params.set('branch', exportBranch);
        return `${route('autodeal.exports', type)}?${params}`;
    };

    return (
        <Card className="mt-4">
            <h2 className="font-bold">Export to Excel (CSV)</h2>
            <p className="text-xs text-slate-500">Dated exports default to the current financial year (from 1 April). Leave “To” empty for up to today.</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="From">
                    <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label="To">
                    <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
                {branches.length > 1 && (
                    <Field label="Branch" className="col-span-2">
                        <Select options={branches.map((b) => [b.id, b.name])} placeholder="All branches" value={exportBranch} onChange={(e) => setExportBranch(e.target.value)} />
                    </Field>
                )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
                {EXPORTS.map(([type, label, dated]) => (
                    <a key={type} href={href(type, dated)} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm font-semibold ring-1 ring-slate-200 active:bg-slate-100">
                        <span>{label}</span>
                        <Icon name="download" className="size-4 text-slate-500" />
                    </a>
                ))}
            </div>
        </Card>
    );
}

function Tile({ label, value, sub, tone }) {
    const color = { good: 'text-emerald-700', bad: 'text-red-600', warn: 'text-amber-700' }[tone] ?? 'text-slate-900';
    return (
        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
            <p className="text-[11px] font-medium text-slate-500 uppercase">{label}</p>
            <p className={`mt-0.5 text-xl font-bold ${color}`}>{value}</p>
            <p className="text-[11px] text-slate-500">{sub}</p>
        </div>
    );
}

/** Grouped bars: purchases vs sales value per month, with hover/tap tooltip and table view. */
function MonthlyChart({ monthly }) {
    const [active, setActive] = useState(null);
    const [table, setTable] = useState(false);
    const max = Math.max(1, ...monthly.flatMap((m) => [m.bought_amount, m.sold_amount]));
    const a = active != null ? monthly[active] : null;

    return (
        <Card className="mt-4">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <h2 className="font-bold">Purchases vs Sales</h2>
                    <div className="mt-1 flex gap-3 text-xs text-slate-600">
                        <Legend color="bg-series-1" label="Purchased (₹)" />
                        <Legend color="bg-series-2" label="Sold (₹)" />
                    </div>
                </div>
                <button onClick={() => setTable(!table)} className="text-xs font-semibold text-brand-700">
                    {table ? 'Chart' : 'Table'}
                </button>
            </div>

            {table ? (
                <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="text-left text-slate-500">
                            <tr>
                                <th className="py-1">Month</th>
                                <th className="text-right">Bought</th>
                                <th className="text-right">Sold</th>
                                <th className="text-right">Profit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {monthly.map((m) => (
                                <tr key={m.month} className="border-t border-slate-100">
                                    <td className="py-1.5">{MONTHS[m.month - 1]}</td>
                                    <td className="text-right">{m.bought_units} · {inrShort(m.bought_amount)}</td>
                                    <td className="text-right">{m.sold_units} · {inrShort(m.sold_amount)}</td>
                                    <td className={`text-right font-semibold ${m.profit < 0 ? 'text-red-600' : ''}`}>{inrShort(m.profit)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <>
                    <div className="relative mt-3">
                        {/* Recessive gridlines */}
                        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
                            {[0, 1, 2, 3].map((i) => <div key={i} className="border-t border-slate-100" />)}
                        </div>
                        <div className="relative flex h-40 items-end gap-1 border-b border-slate-300" onMouseLeave={() => setActive(null)}>
                            {monthly.map((m, i) => (
                                <button
                                    key={m.month}
                                    type="button"
                                    onMouseEnter={() => setActive(i)}
                                    onClick={() => setActive(active === i ? null : i)}
                                    className={`flex h-full flex-1 items-end justify-center gap-0.5 rounded-t ${active === i ? 'bg-slate-100' : ''}`}
                                    aria-label={`${MONTHS[i]}: purchased ${inr(m.bought_amount)}, sold ${inr(m.sold_amount)}`}
                                >
                                    <span className="w-1/3 max-w-3 rounded-t-[4px] bg-series-1" style={{ height: `${(m.bought_amount / max) * 100}%` }} />
                                    <span className="w-1/3 max-w-3 rounded-t-[4px] bg-series-2" style={{ height: `${(m.sold_amount / max) * 100}%` }} />
                                </button>
                            ))}
                        </div>
                        <div className="mt-1 flex gap-1 text-center text-[10px] text-slate-500">
                            {MONTHS.map((m) => <span key={m} className="flex-1">{m[0]}</span>)}
                        </div>
                    </div>
                    <div className="mt-2 min-h-10 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        {a ? (
                            <>
                                <strong>{MONTHS[a.month - 1]}</strong> · Bought {a.bought_units} ({inr(a.bought_amount)}) · Sold {a.sold_units} ({inr(a.sold_amount)}) · Profit{' '}
                                <strong className={a.profit < 0 ? 'text-red-600' : 'text-emerald-700'}>{inr(a.profit)}</strong>
                            </>
                        ) : (
                            <span className="text-slate-500">Tap a month for details. Peak {inrShort(max)}.</span>
                        )}
                    </div>
                </>
            )}
        </Card>
    );
}

function Legend({ color, label }) {
    return (
        <span className="flex items-center gap-1">
            <span className={`size-2.5 rounded-sm ${color}`} />
            {label}
        </span>
    );
}

function Aging({ aging }) {
    const max = Math.max(1, ...aging.buckets.map((b) => b.units));
    return (
        <Card className="mt-4">
            <h2 className="font-bold">Stock aging (unsold)</h2>
            <div className="mt-3 space-y-2">
                {aging.buckets.map((b) => (
                    <div key={b.range} className="flex items-center gap-2 text-xs">
                        <span className="w-14 shrink-0 text-slate-600">{b.range} d</span>
                        <div className="h-5 flex-1 rounded bg-slate-100">
                            <div className="h-full rounded-r-[4px] bg-series-1" style={{ width: `${(b.units / max) * 100}%` }} />
                        </div>
                        <span className="w-28 shrink-0 text-right text-slate-700">
                            <strong>{b.units}</strong> · {inrShort(b.cost)}
                        </span>
                    </div>
                ))}
            </div>
            {aging.oldest.length > 0 && (
                <>
                    <h3 className="mt-4 text-sm font-semibold text-slate-700">Oldest in stock</h3>
                    <ul className="mt-1 divide-y divide-slate-100 text-sm">
                        {aging.oldest.slice(0, 10).map((v) => (
                            <li key={v.id}>
                                <Link href={route('autodeal.vehicles.show', v.id)} className="flex justify-between gap-2 py-2">
                                    <span className="truncate">{v.title}</span>
                                    <span className={`shrink-0 font-semibold ${v.days > 90 ? 'text-red-600' : v.days > 60 ? 'text-amber-700' : 'text-slate-600'}`}>{v.days} d</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </Card>
    );
}

function Profitability({ rows }) {
    const totals = rows.reduce((t, r) => ({ cost: t.cost + r.cost, price: t.price + r.price, profit: t.profit + r.profit }), { cost: 0, price: 0, profit: 0 });
    return (
        <Card className="mt-4">
            <h2 className="font-bold">Profitability per vehicle</h2>
            {rows.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No sales this year.</p>
            ) : (
                <div className="-mx-4 mt-2 overflow-x-auto px-4">
                    <table className="w-full min-w-[520px] text-xs">
                        <thead className="text-left text-slate-500">
                            <tr>
                                <th className="py-1.5">Vehicle</th>
                                <th>Type</th>
                                <th className="text-right">Cost</th>
                                <th className="text-right">Sold</th>
                                <th className="text-right">Profit</th>
                                <th className="text-right">Days</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.sale_id} className="border-t border-slate-100">
                                    <td className="max-w-40 truncate py-1.5">
                                        <Link href={route('autodeal.vehicles.show', r.vehicle_id)} className="text-brand-700">{r.title}</Link>
                                    </td>
                                    <td>{r.intake_type === 'seized' ? 'Seized' : 'Direct'}</td>
                                    <td className="text-right">{inr(r.cost)}</td>
                                    <td className="text-right">{inr(r.price)}</td>
                                    <td className={`text-right font-semibold ${r.profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                                        {inr(r.profit)} <span className="font-normal text-slate-500">({r.margin}%)</span>
                                    </td>
                                    <td className="text-right">{r.days}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="font-bold">
                            <tr className="border-t-2 border-slate-300">
                                <td className="py-2" colSpan={2}>Total ({rows.length})</td>
                                <td className="text-right">{inr(totals.cost)}</td>
                                <td className="text-right">{inr(totals.price)}</td>
                                <td className={`text-right ${totals.profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{inr(totals.profit)}</td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </Card>
    );
}

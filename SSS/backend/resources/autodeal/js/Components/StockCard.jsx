import { Link, router, usePage } from '@inertiajs/react';
import { date, daysSince, INTAKE, inr, shareOnWhatsApp, vehicleTitle } from '@/lib/format';
import { Icon, StatusBadge } from './ui';

const SELLABLE = ['in_stock', 'processing', 'reserved'];

export default function StockCard({ vehicle: v, onSell }) {
    const { auth, branches } = usePage().props;
    const owner = auth.can.owner;
    const days = daysSince(v.intake_date);
    const thumb = v.cover_photo?.url;
    // Purchase receipt shows the cost: owners, or the staff member who did the intake.
    const canPrint = owner || v.created_by === auth.user.id;
    const branchName = branches.length > 1 ? branches.find((b) => b.id === v.branch_id)?.name : null;
    // Staff never receive cost, so they see the asking price instead.
    const price =
        v.status === 'sold'
            ? { value: v.sale?.selling_price, label: 'Sold price' }
            : owner
              ? { value: v.purchase_price, label: 'Cost' }
              : { value: v.expected_price, label: 'Asking price' };

    if (v.deleted_at) {
        return (
            <article className="flex items-center gap-3 rounded-2xl bg-white p-3 opacity-80 ring-1 ring-slate-200">
                <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">{vehicleTitle(v)}</h3>
                    <p className="truncate text-xs text-slate-500">
                        {v.registration_number || (v.chassis_number && `CH ${v.chassis_number}`) || '—'} · deleted {date(v.deleted_at)}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => router.post(route('autodeal.vehicles.restore', v.id))}
                    className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white"
                >
                    Restore
                </button>
            </article>
        );
    }

    return (
        <article className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <Link href={route('autodeal.vehicles.show', v.id)} className="flex gap-3 p-3">
                <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                    {thumb ? (
                        <img src={thumb} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                    ) : (
                        <div className="flex size-full items-center justify-center text-slate-300">
                            <Icon name="car" className="size-9" />
                        </div>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                        <h3 className="truncate font-semibold leading-tight">{vehicleTitle(v)}</h3>
                        <StatusBadge status={v.status} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                        {[v.registration_number || 'No reg.', v.color || '—', v.chassis_number && `CH …${v.chassis_number.slice(-6)}`, v.source].filter(Boolean).join(' · ')}
                        {branchName && ` · ${branchName}`}
                    </p>
                    <div className="mt-1.5 flex items-end justify-between">
                        <div>
                            <p className="flex items-center gap-1.5 text-base font-bold">
                                {price.value != null ? inr(price.value) : '—'}
                                {v.is_listed && SELLABLE.includes(v.status) && (
                                    <span className="rounded bg-brand-50 px-1 py-px text-[10px] font-semibold text-brand-700 ring-1 ring-brand-100" title="On the public catalogue">
                                        ONLINE
                                    </span>
                                )}
                            </p>
                            <p className="text-[11px] text-slate-500">{price.label}</p>
                        </div>
                        <div className="text-right text-[11px] text-slate-500">
                            <span className={`block font-medium ${v.intake_type === 'seized' ? 'text-orange-700' : 'text-sky-700'}`}>{INTAKE[v.intake_type]}</span>
                            {v.status === 'sold' ? date(v.intake_date) : <span className={days > 60 ? 'font-semibold text-red-600' : ''}>{days}d in stock</span>}
                        </div>
                    </div>
                </div>
            </Link>

            {/* Quick actions – large tap targets for one-handed use */}
            <div className="grid grid-cols-4 border-t border-slate-100 text-[11px] font-medium text-slate-600">
                <Action href={route('autodeal.vehicles.show', v.id)} icon="eye" label="View" />
                {SELLABLE.includes(v.status) ? (
                    <Action onClick={() => onSell(v)} icon="tag" label="Sell" className="text-emerald-700" />
                ) : (
                    <Action href={route('autodeal.vehicles.show', v.id)} icon="rupee" label="Sale" />
                )}
                {canPrint ? (
                    <Action href={route('autodeal.receipts.purchase', v.id)} external icon="download" label="Receipt" />
                ) : (
                    <Action href={route('autodeal.vehicles.show', v.id)} icon="file" label="Details" />
                )}
                <Action onClick={() => shareOnWhatsApp(v)} icon="share" label="WhatsApp" className="text-green-700" />
            </div>
        </article>
    );
}

function Action({ href, onClick, icon, label, external, className = '' }) {
    const cls = `flex flex-col items-center gap-0.5 py-2 active:bg-slate-50 ${className}`;
    const inner = (
        <>
            <Icon name={icon} className="size-5" />
            {label}
        </>
    );
    if (onClick) return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
    if (external) return <a href={href} className={cls}>{inner}</a>;
    return <Link href={href} className={cls}>{inner}</Link>;
}

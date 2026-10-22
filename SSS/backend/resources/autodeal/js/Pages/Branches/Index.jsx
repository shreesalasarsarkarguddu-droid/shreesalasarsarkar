import { Head, Link, router, useForm } from '@inertiajs/react';
import { useState } from 'react';
import { Button, Field, Icon, Input, Sheet } from '@/Components/ui';
import { date, inrShort } from '@/lib/format';

/** Owner-only: yards / branches – add, edit, close/reopen, delete. */
export default function Branches({ branches }) {
    const [editing, setEditing] = useState(null); // null = closed, {} = new, branch = edit
    const open = branches.filter((b) => b.is_active);
    const closed = branches.filter((b) => !b.is_active);

    return (
        <>
            <Head title="Yards" />
            <div className="mb-3 flex items-center gap-2">
                <Link href={route('autodeal.account')} className="-ml-2 rounded-full p-2 hover:bg-slate-200" aria-label="Back">
                    <Icon name="chevronLeft" />
                </Link>
                <div className="min-w-0 flex-1">
                    <h1 className="text-lg font-bold">Yards / branches</h1>
                    <p className="text-xs text-slate-500">
                        {open.length} open{closed.length > 0 && ` · ${closed.length} closed`}
                    </p>
                </div>
                <Button onClick={() => setEditing({})} className="shrink-0">
                    <Icon name="plus" /> Add yard
                </Button>
            </div>

            {open.length === 1 && (
                <p className="mb-3 rounded-xl bg-brand-50 p-3 text-sm text-slate-700 ring-1 ring-brand-100">
                    Add a second yard to unlock branch filters on stock, reports and exports, vehicle transfers, and staff limited to one yard.
                </p>
            )}

            <div className="space-y-3">
                {[...open, ...closed].map((b) => (
                    <YardCard key={b.id} branch={b} onEdit={() => setEditing(b)} lastOpen={b.is_active && open.length === 1} />
                ))}
            </div>

            {editing && <YardSheet branch={editing} onClose={() => setEditing(null)} />}
        </>
    );
}

function YardCard({ branch: b, onEdit, lastOpen }) {
    const setActive = (is_active) =>
        router.put(route('autodeal.branches.update', b.id), { name: b.name, address: b.address, phone: b.phone, is_active }, { preserveScroll: true });

    return (
        <article className={`rounded-2xl bg-white p-4 ring-1 ring-slate-200 ${b.is_active ? '' : 'opacity-70'}`}>
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <h2 className="flex items-center gap-2 font-bold">
                        <span className="truncate">{b.name}</span>
                        {!b.is_active && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 uppercase">Closed</span>}
                    </h2>
                    <p className="truncate text-xs text-slate-500">{[b.address, b.phone].filter(Boolean).join(' · ') || 'No address or phone yet'}</p>
                </div>
                <button onClick={onEdit} className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-brand-700 hover:bg-brand-50">
                    Edit
                </button>
            </div>

            <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                <Stat label="In stock" value={b.stock_count} />
                <Stat label="Value" value={inrShort(b.stock_value)} />
                <Stat label="Sold" value={b.sold_count} />
                <Stat label="Staff" value={b.staff_count} />
            </dl>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                {b.is_active && (
                    <Link href={route('autodeal.vehicles.index', { branch: b.id })} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold">
                        View stock
                    </Link>
                )}
                <span className="text-xs text-slate-400">Added {date(b.created_at)}</span>
                <div className="ml-auto flex gap-3">
                    {b.is_active ? (
                        !lastOpen && (
                            <button
                                className="text-xs font-semibold text-slate-600"
                                onClick={() => {
                                    if (window.confirm(`Close ${b.name}? It must have no unsold vehicles. Its history stays in reports.`)) setActive(false);
                                }}
                            >
                                Close yard
                            </button>
                        )
                    ) : (
                        <button className="text-xs font-semibold text-emerald-700" onClick={() => setActive(true)}>
                            Reopen
                        </button>
                    )}
                    {b.deletable && !lastOpen && (
                        <button
                            className="text-xs font-semibold text-red-600"
                            onClick={() => {
                                if (window.confirm(`Delete ${b.name} permanently?`)) router.delete(route('autodeal.branches.destroy', b.id), { preserveScroll: true });
                            }}
                        >
                            Delete
                        </button>
                    )}
                </div>
            </div>
        </article>
    );
}

function Stat({ label, value }) {
    return (
        <div className="rounded-xl bg-slate-50 py-2">
            <dd className="text-sm font-bold">{value}</dd>
            <dt className="text-[10px] text-slate-500 uppercase">{label}</dt>
        </div>
    );
}

function YardSheet({ branch, onClose }) {
    const isNew = !branch.id;
    const form = useForm({ name: branch.name ?? '', address: branch.address ?? '', phone: branch.phone ?? '', is_active: branch.is_active ?? true });
    const save = () =>
        isNew
            ? form.post(route('autodeal.branches.store'), { preserveScroll: true, onSuccess: onClose })
            : form.put(route('autodeal.branches.update', branch.id), { preserveScroll: true, onSuccess: onClose });

    return (
        <Sheet
            open
            onClose={onClose}
            title={isNew ? 'Add yard' : `Edit ${branch.name}`}
            footer={
                <Button className="w-full" loading={form.processing} onClick={save}>
                    {isNew ? 'Add yard' : 'Save changes'}
                </Button>
            }
        >
            <div className="space-y-3">
                <Field label="Yard name *" error={form.errors.name}>
                    <Input value={form.data.name} onChange={(e) => form.setData('name', e.target.value)} placeholder="Raipur Yard" autoFocus />
                </Field>
                <Field label="Address" hint="Printed on this yard’s receipts and shown on the public catalogue." error={form.errors.address}>
                    <Input value={form.data.address} onChange={(e) => form.setData('address', e.target.value)} placeholder="GE Road, Raipur" />
                </Field>
                <Field label="Phone" hint="Customers call/WhatsApp this number for this yard’s vehicles." error={form.errors.phone}>
                    <Input type="tel" inputMode="numeric" maxLength={10} value={form.data.phone} onChange={(e) => form.setData('phone', e.target.value.replace(/\D/g, ''))} placeholder="98xxxxxxxx" />
                </Field>
            </div>
        </Sheet>
    );
}

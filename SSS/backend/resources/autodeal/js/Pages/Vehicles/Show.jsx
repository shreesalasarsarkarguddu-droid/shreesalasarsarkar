import { Head, Link, router, useForm, usePage } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import ChangeList from '@/Components/ChangeList';
import PhotoCapture from '@/Components/PhotoCapture';
import SaleModal from '@/Components/SaleModal';
import { Button, Card, Field, Icon, Input, Row, Select, Sheet, StatusBadge } from '@/Components/ui';
import { date, ID_PROOFS, inr, INTAKE, PAYMENT_MODES, PHOTO_TYPES, shareOnWhatsApp, STATUS, today } from '@/lib/format';

export default function Show({ vehicle: v, photoTypes, activity }) {
    const { auth, branches } = usePage().props;
    const owner = auth.can.owner;
    const [selling, setSelling] = useState(false);
    const [viewer, setViewer] = useState(null);
    const [addingPhotos, setAddingPhotos] = useState(false);
    const [paying, setPaying] = useState(false);
    const [transferring, setTransferring] = useState(false);
    const sale = v.sale;
    const multiBranch = branches.length > 1;

    const changeStatus = (status) => router.patch(route('autodeal.vehicles.status', v.id), { status }, { preserveScroll: true });

    return (
        <>
            <Head title={v.title} />
            <div className="mb-3 flex items-center gap-2">
                <Link href={route('autodeal.vehicles.index')} className="-ml-2 rounded-full p-2 hover:bg-slate-200" aria-label="Back">
                    <Icon name="chevronLeft" />
                </Link>
                <div className="min-w-0 flex-1">
                    <h1 className="truncate text-lg font-bold leading-tight">{v.title}</h1>
                    <p className="text-xs text-slate-500">
                        {INTAKE[v.intake_type]} · {v.days_in_stock} days {sale ? 'to sell' : 'in stock'}
                        {multiBranch && v.branch && ` · ${v.branch.name}`}
                    </p>
                </div>
                <StatusBadge status={v.status} />
            </div>

            {/* Gallery – horizontal snap scroll */}
            <div className="scrollbar-none -mx-4 flex snap-x gap-2 overflow-x-auto px-4">
                {v.photos.map((p) => (
                    <button key={p.id} onClick={() => setViewer(p)} className="relative h-44 w-64 shrink-0 snap-start overflow-hidden rounded-2xl bg-slate-200">
                        <img src={p.url} alt={PHOTO_TYPES[p.photo_type]} loading="lazy" className="size-full object-cover" />
                        <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">{PHOTO_TYPES[p.photo_type]}</span>
                    </button>
                ))}
                <button onClick={() => setAddingPhotos(true)} className="flex h-44 w-32 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-slate-300 text-sm text-slate-500">
                    <Icon name="camera" className="size-7" />
                    Add photos
                </button>
            </div>

            {/* Primary actions */}
            <div className="mt-4 grid grid-cols-2 gap-2">
                {v.sellable ? (
                    <Button variant="success" onClick={() => setSelling(true)}>
                        <Icon name="tag" /> Sell vehicle
                    </Button>
                ) : (
                    sale && (
                        <Button variant="dark" onClick={() => (window.location.href = route('autodeal.receipts.sale', sale.id))}>
                            <Icon name="download" /> Sale receipt
                        </Button>
                    )
                )}
                <Button variant="outline" onClick={() => shareOnWhatsApp(v)}>
                    <Icon name="share" /> WhatsApp
                </Button>
                {v.can_print_purchase && (
                    <a href={route('autodeal.receipts.purchase', v.id)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold">
                        <Icon name="receipt" /> Purchase receipt
                    </a>
                )}
                <Link href={route('autodeal.vehicles.edit', v.id)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold">
                    <Icon name="edit" /> Edit
                </Link>
                {multiBranch && v.status !== 'sold' && (
                    <Button variant="outline" onClick={() => setTransferring(true)}>
                        <Icon name="car" /> Transfer
                    </Button>
                )}
            </div>

            {owner && v.status !== 'sold' && <ListingCard v={v} />}

            {sale && (
                <Card className="mt-4">
                    <div className="mb-2 flex items-center justify-between">
                        <h2 className="font-bold">Sale</h2>
                        {owner && v.profit != null && (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${v.profit >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                                {v.profit >= 0 ? 'Profit' : 'Loss'} {inr(Math.abs(v.profit))}
                            </span>
                        )}
                    </div>
                    <Row label="Buyer">{sale.buyer.name}</Row>
                    <Row label="Mobile">
                        <a href={`tel:${sale.buyer.phone}`} className="text-brand-700">{sale.buyer.phone}</a>
                    </Row>
                    <Row label="Address">{sale.buyer.address}</Row>
                    <Row label="ID proof">
                        {sale.buyer.has_id_proof ? <a className="text-brand-700" href={route('autodeal.files.buyer', sale.buyer.id)} target="_blank">{ID_PROOFS[sale.buyer.id_proof_type] ?? 'View'}</a> : '—'}
                    </Row>
                    <Row label="Sale date">{date(sale.sale_date)}</Row>
                    <Row label="Selling price">{inr(sale.selling_price)}</Row>
                    <Row label="Payment">{PAYMENT_MODES[sale.payment_mode]}{sale.financier ? ` · ${sale.financier}` : ''}</Row>
                    <Row label="Received">{inr(sale.paid_amount)}</Row>
                    <Row label="Balance">
                        <span className={sale.balance_amount > 0 ? 'text-amber-700' : ''}>{inr(sale.balance_amount)}</span>
                    </Row>
                    {sale.payments.length > 0 && (
                        <div className="mt-2 rounded-lg bg-slate-50 p-2">
                            <p className="mb-1 text-xs font-semibold text-slate-500 uppercase">Payment history</p>
                            {sale.payments.map((p) => (
                                <div key={p.id} className="flex justify-between gap-2 py-1 text-sm">
                                    <span className="text-slate-600">
                                        {date(p.paid_on)} · {PAYMENT_MODES[p.mode]}
                                        {p.reference ? ` · ${p.reference}` : ''}
                                    </span>
                                    <span className="font-semibold">{inr(p.amount)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {sale.documents.length > 0 && (
                        <Row label="Documents">
                            {sale.documents.map((d) => (
                                <a key={d.id} href={route('autodeal.files.sale-document', d.id)} target="_blank" className="block truncate text-brand-700">
                                    {d.label || `Document ${d.id}`}
                                </a>
                            ))}
                        </Row>
                    )}
                    {sale.notes && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm whitespace-pre-line text-slate-700">{sale.notes}</p>}
                    <div className="mt-3 flex gap-2">
                        {sale.balance_amount > 0 && (
                            <Button className="flex-1" onClick={() => setPaying(true)}>
                                Record payment
                            </Button>
                        )}
                        {owner && (
                            <Button
                                variant="ghost"
                                className="text-red-600"
                                onClick={() => {
                                    if (window.confirm('Cancel this sale and move the vehicle back to stock?')) router.delete(route('autodeal.sales.destroy', sale.id));
                                }}
                            >
                                Cancel sale
                            </Button>
                        )}
                    </div>
                </Card>
            )}

            <Card className="mt-4">
                <h2 className="mb-2 font-bold">Vehicle</h2>
                <Row label="Registration">{v.registration_number}</Row>
                <Row label="Chassis no.">
                    <span className="font-mono">{v.chassis_number}</span>
                </Row>
                <Row label="Engine no.">
                    <span className="font-mono">{v.engine_number}</span>
                </Row>
                <Row label="Colour">{v.color}</Row>
                <Row label="Intake date">{date(v.intake_date)}</Row>
                {multiBranch && <Row label="Branch">{v.branch?.name}</Row>}
                {owner && <Row label={v.intake_type === 'seized' ? 'Intake value' : 'Purchase price'}>{inr(v.purchase_price)}</Row>}
                <Row label="Expected sale">{v.expected_price ? inr(v.expected_price) : '—'}</Row>
                {v.remarks && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm whitespace-pre-line text-slate-700">{v.remarks}</p>}
                {v.transfers.length > 0 && (
                    <div className="mt-2 rounded-lg bg-slate-50 p-2">
                        <p className="mb-1 text-xs font-semibold text-slate-500 uppercase">Transfers</p>
                        {v.transfers.map((t) => (
                            <p key={t.id} className="py-0.5 text-sm text-slate-700">
                                {date(t.transferred_on)} · {t.from?.name ?? '—'} → <strong>{t.to?.name}</strong>
                                {t.user && <span className="text-slate-500"> · {t.user.full_name}</span>}
                                {t.note && <span className="block text-xs text-slate-500">{t.note}</span>}
                            </p>
                        ))}
                    </div>
                )}
            </Card>

            <Card className="mt-4">
                <h2 className="mb-2 font-bold">{v.intake_type === 'seized' ? 'Seizing authority / owner' : 'Seller'}</h2>
                <Row label="Name">{v.seller.name}</Row>
                <Row label="Mobile">
                    <a href={`tel:${v.seller.phone}`} className="text-brand-700">{v.seller.phone}</a>
                </Row>
                <Row label="Address">{v.seller.address}</Row>
                <Row label="ID proof">
                    {v.seller.has_id_proof ? <a className="text-brand-700" href={route('autodeal.files.seller', v.seller.id)} target="_blank">{ID_PROOFS[v.seller.id_proof_type] ?? 'View'}</a> : '—'}
                </Row>
            </Card>

            {v.status !== 'sold' && (
                <Card className="mt-4">
                    <h2 className="mb-2 font-bold">Status</h2>
                    <div className="grid grid-cols-2 gap-2">
                        {['in_stock', 'processing', 'reserved', 'archived'].map((s) => (
                            <button key={s} onClick={() => changeStatus(s)} disabled={v.status === s} className={`rounded-xl py-2.5 text-sm font-semibold ring-1 ${v.status === s ? 'bg-ink text-white ring-ink' : 'bg-white ring-slate-300'}`}>
                                {STATUS[s].label}
                            </button>
                        ))}
                    </div>
                    {owner && (
                        <button
                            className="mt-3 w-full py-2 text-sm font-medium text-red-600"
                            onClick={() => {
                                if (window.confirm('Delete this vehicle from stock?')) router.delete(route('autodeal.vehicles.destroy', v.id));
                            }}
                        >
                            Delete vehicle
                        </button>
                    )}
                </Card>
            )}

            {owner && activity.length > 0 && <ActivityTimeline items={activity} />}

            {selling && <SaleModal vehicle={v} onClose={() => setSelling(false)} />}
            <PhotoViewer photo={viewer} vehicleId={v.id} canDelete={owner} onClose={() => setViewer(null)} />
            <AddPhotos open={addingPhotos} vehicleId={v.id} types={photoTypes} onClose={() => setAddingPhotos(false)} />
            {sale && <PaymentSheet open={paying} sale={sale} onClose={() => setPaying(false)} />}
            {multiBranch && <TransferSheet open={transferring} vehicle={v} branches={branches} onClose={() => setTransferring(false)} />}
        </>
    );
}

/** Owner toggle for the public catalogue, with a shareable link. */
function ListingCard({ v }) {
    const url = route('autodeal.catalogue.show', v.id);
    const share = () => {
        const text = `${v.title}${v.expected_price ? ` – ${inr(v.expected_price)}` : ''}\n${url}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    };

    return (
        <Card className="mt-4">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="font-bold">Public catalogue</h2>
                    <p className="text-xs text-slate-500">
                        {v.is_listed ? 'Customers can see this vehicle (photos + asking price only).' : 'Hidden from customers.'}
                        {!v.expected_price && v.is_listed && ' No asking price set – shows “Price on request”.'}
                    </p>
                </div>
                <button
                    role="switch"
                    aria-checked={v.is_listed}
                    aria-label="Show on public catalogue"
                    onClick={() => router.post(route('autodeal.vehicles.listing', v.id), {}, { preserveScroll: true })}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition ${v.is_listed ? 'bg-brand-600' : 'bg-slate-300'}`}
                >
                    <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${v.is_listed ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
            </div>
            {v.is_listed && (
                <div className="mt-3 flex gap-2">
                    <a href={url} target="_blank" className="flex-1 rounded-xl bg-slate-100 px-3 py-2 text-center text-sm font-semibold">
                        Open listing
                    </a>
                    <button onClick={share} className="flex-1 rounded-xl bg-green-600 px-3 py-2 text-sm font-semibold text-white">
                        Share link
                    </button>
                </div>
            )}
        </Card>
    );
}

function TransferSheet({ open, vehicle, branches, onClose }) {
    const form = useForm({ to_branch_id: '', transferred_on: today(), note: '' });
    const targets = branches.filter((b) => b.id !== vehicle.branch_id);

    return (
        <Sheet
            open={open}
            onClose={onClose}
            title="Transfer to another branch"
            footer={
                <Button className="w-full" disabled={!form.data.to_branch_id} loading={form.processing} onClick={() => form.post(route('autodeal.vehicles.transfer', vehicle.id), { preserveScroll: true, onSuccess: onClose })}>
                    Transfer
                </Button>
            }
        >
            <p className="mb-3 text-sm text-slate-600">Currently at {vehicle.branch?.name ?? '—'}.</p>
            <div className="space-y-3">
                <Field label="Move to *" error={form.errors.to_branch_id}>
                    <Select options={targets.map((b) => [b.id, b.name])} placeholder="Choose branch" value={form.data.to_branch_id} onChange={(e) => form.setData('to_branch_id', e.target.value)} />
                </Field>
                <Field label="Date" error={form.errors.transferred_on}>
                    <Input type="date" max={today()} value={form.data.transferred_on} onChange={(e) => form.setData('transferred_on', e.target.value)} />
                </Field>
                <Field label="Note" hint="Driver, reason…" error={form.errors.note}>
                    <Input value={form.data.note} onChange={(e) => form.setData('note', e.target.value)} />
                </Field>
            </div>
        </Sheet>
    );
}

function ActivityTimeline({ items }) {
    return (
        <Card className="mt-4">
            <div className="mb-2 flex items-center justify-between">
                <h2 className="font-bold">History</h2>
                <Link href={route('autodeal.activity.index')} className="text-xs font-semibold text-brand-700">
                    Full log →
                </Link>
            </div>
            <ol className="space-y-2 border-l-2 border-slate-200 pl-3">
                {items.map((a) => (
                    <li key={a.id} className="text-sm">
                        <p className="text-slate-800">{a.description}</p>
                        <p className="text-xs text-slate-500">
                            {new Date(a.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {a.user?.full_name ?? 'System'}
                        </p>
                        {a.changes && <ChangeList changes={a.changes} />}
                    </li>
                ))}
            </ol>
        </Card>
    );
}

function PhotoViewer({ photo, vehicleId, canDelete, onClose }) {
    if (!photo) return null;
    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-black" onClick={onClose}>
            <div className="flex items-center justify-between p-3 text-white">
                <span className="text-sm">{PHOTO_TYPES[photo.photo_type]}</span>
                <div className="flex gap-2">
                    {canDelete && (
                        <button
                            className="rounded-full p-2 text-red-400"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm('Delete this photo?')) router.delete(route('autodeal.vehicles.photos.destroy', [vehicleId, photo.id]), { preserveScroll: true, onSuccess: onClose });
                            }}
                            aria-label="Delete photo"
                        >
                            <Icon name="trash" />
                        </button>
                    )}
                    <button className="rounded-full p-2" aria-label="Close">
                        <Icon name="x" />
                    </button>
                </div>
            </div>
            <img src={photo.url} alt="" className="m-auto max-h-[85dvh] max-w-full object-contain" />
        </div>
    );
}

function AddPhotos({ open, vehicleId, types, onClose }) {
    const form = useForm({ photos: [] });
    return (
        <Sheet
            open={open}
            onClose={onClose}
            title="Add photos"
            footer={
                <Button
                    className="w-full"
                    disabled={!form.data.photos.length}
                    loading={form.processing}
                    onClick={() =>
                        form.post(route('autodeal.vehicles.photos.store', vehicleId), {
                            forceFormData: true,
                            preserveScroll: true,
                            onSuccess: () => {
                                form.reset();
                                onClose();
                            },
                        })
                    }
                >
                    Upload {form.data.photos.length || ''} photos
                </Button>
            }
        >
            <PhotoCapture value={form.data.photos} onChange={(p) => form.setData('photos', p)} types={types} />
            {Object.values(form.errors)[0] && <p className="mt-2 text-sm text-red-600">{Object.values(form.errors)[0]}</p>}
        </Sheet>
    );
}

function PaymentSheet({ open, sale, onClose }) {
    const form = useForm({ amount: String(Math.round(sale.balance_amount)), paid_on: today(), mode: 'cash', reference: '' });

    // Prefill the remaining balance each time the sheet opens.
    useEffect(() => {
        if (open) form.setData({ amount: String(Math.round(sale.balance_amount)), paid_on: today(), mode: 'cash', reference: '' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, sale.balance_amount]);

    return (
        <Sheet
            open={open}
            onClose={onClose}
            title="Record payment"
            footer={
                <Button className="w-full" loading={form.processing} onClick={() => form.post(route('autodeal.sales.payments.store', sale.id), { preserveScroll: true, onSuccess: onClose })}>
                    Save payment
                </Button>
            }
        >
            <p className="mb-3 text-sm text-slate-600">Outstanding: {inr(sale.balance_amount)}</p>
            <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Amount (₹)" error={form.errors.amount}>
                        <Input type="number" inputMode="numeric" value={form.data.amount} onChange={(e) => form.setData('amount', e.target.value)} />
                    </Field>
                    <Field label="Date" error={form.errors.paid_on}>
                        <Input type="date" max={today()} min={sale.sale_date} value={form.data.paid_on} onChange={(e) => form.setData('paid_on', e.target.value)} />
                    </Field>
                </div>
                <Field label="Mode" error={form.errors.mode}>
                    <Select options={PAYMENT_MODES} value={form.data.mode} onChange={(e) => form.setData('mode', e.target.value)} />
                </Field>
                <Field label="Reference (UTR / cheque no.)" error={form.errors.reference}>
                    <Input value={form.data.reference} onChange={(e) => form.setData('reference', e.target.value)} />
                </Field>
            </div>
        </Sheet>
    );
}

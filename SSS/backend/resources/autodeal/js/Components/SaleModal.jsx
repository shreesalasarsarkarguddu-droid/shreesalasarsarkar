import { useForm, usePage } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { DocumentCapture } from './PhotoCapture';
import PriceHint from './PriceHint';
import { Button, Field, Input, Select, Sheet, Stepper, Textarea } from './ui';
import { compressImage } from '@/lib/compressImage';
import { ID_PROOFS, inr, PAYMENT_MODES, today, vehicleTitle } from '@/lib/format';

const STEPS = ['Buyer', 'Price & Payment', 'Documents'];
const STEP_FIELDS = [
    ['buyer.name', 'buyer.phone', 'buyer.address', 'buyer.id_proof_type', 'buyer_id_proof'],
    ['selling_price', 'sale_date', 'payment_mode', 'paid_amount', 'financier'],
    ['documents', 'notes'],
];

export default function SaleModal({ vehicle, onClose }) {
    const { auth } = usePage().props;
    const [step, setStep] = useState(0);
    const form = useForm({
        buyer: { name: '', phone: '', address: '', id_proof_type: 'aadhaar' },
        buyer_id_proof: null,
        selling_price: vehicle?.expected_price ? String(Math.round(vehicle.expected_price)) : '',
        sale_date: today(),
        payment_mode: 'cash',
        paid_amount: '',
        financier: '',
        notes: '',
        documents: [],
    });
    const { data, setData, errors, processing } = form;

    useEffect(() => {
        setStep(0);
        form.reset();
        form.clearErrors();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vehicle?.id]);

    // On a server validation error, jump back to the first step that has one.
    useEffect(() => {
        const keys = Object.keys(errors);
        if (!keys.length) return;
        const first = STEP_FIELDS.findIndex((fields) => keys.some((k) => fields.some((f) => k === f || k.startsWith(f + '.'))));
        if (first >= 0) setStep(first);
    }, [errors]);

    if (!vehicle) return null;

    const price = Number(data.selling_price || 0);
    const paid = data.paid_amount === '' ? price : Number(data.paid_amount);
    const profit = price - Number(vehicle.purchase_price);
    const setBuyer = (k, v) => setData('buyer', { ...data.buyer, [k]: v });

    const canNext =
        step === 0 ? data.buyer.name.trim() && /^\d{10}$/.test(data.buyer.phone.replace(/\D/g, '').slice(-10)) : step === 1 ? price > 0 && data.sale_date : true;

    function submit() {
        form.transform((d) => ({ ...d, paid_amount: d.paid_amount === '' ? d.selling_price : d.paid_amount }));
        form.post(route('autodeal.sales.store', vehicle.id), {
            forceFormData: true,
            preserveScroll: true,
            onSuccess: () => onClose(),
        });
    }

    async function addDocs(e) {
        const picked = Array.from(e.target.files || []);
        e.target.value = ''; // allow re-picking the same file
        const files = await Promise.all(picked.map((f) => compressImage(f, { maxSize: 2000, quality: 0.8 })));
        setData('documents', [...data.documents, ...files].slice(0, 4));
    }

    return (
        <Sheet
            open
            onClose={onClose}
            title={`Sell · ${vehicleTitle(vehicle)}`}
            footer={
                <div className="flex gap-2">
                    {step > 0 && (
                        <Button variant="outline" onClick={() => setStep(step - 1)} className="flex-1">
                            Back
                        </Button>
                    )}
                    {step < 2 ? (
                        <Button onClick={() => setStep(step + 1)} disabled={!canNext} className="flex-[2]">
                            Continue
                        </Button>
                    ) : (
                        <Button variant="success" onClick={submit} loading={processing} className="flex-[2]">
                            Confirm sale · {inr(price)}
                        </Button>
                    )}
                </div>
            }
        >
            <Stepper steps={STEPS} current={step} />
            <div className="mt-4 space-y-3">
                {step === 0 && (
                    <>
                        <Field label="Buyer name *" error={errors['buyer.name']}>
                            <Input value={data.buyer.name} onChange={(e) => setBuyer('name', e.target.value)} autoComplete="off" />
                        </Field>
                        <Field label="Mobile number *" error={errors['buyer.phone']}>
                            <Input type="tel" inputMode="numeric" maxLength={14} value={data.buyer.phone} onChange={(e) => setBuyer('phone', e.target.value)} placeholder="98765 43210" />
                        </Field>
                        <Field label="Full address" error={errors['buyer.address']}>
                            <Textarea value={data.buyer.address} onChange={(e) => setBuyer('address', e.target.value)} />
                        </Field>
                        <Field label="ID proof type" error={errors['buyer.id_proof_type']}>
                            <Select options={ID_PROOFS} value={data.buyer.id_proof_type} onChange={(e) => setBuyer('id_proof_type', e.target.value)} />
                        </Field>
                        <Field error={errors.buyer_id_proof}>
                            <DocumentCapture value={data.buyer_id_proof} onChange={(f) => setData('buyer_id_proof', f)} label="Buyer ID / address proof" />
                        </Field>
                    </>
                )}

                {step === 1 && (
                    <>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Selling price (₹) *" error={errors.selling_price}>
                                <Input type="number" inputMode="numeric" min="0" value={data.selling_price} onChange={(e) => setData('selling_price', e.target.value)} />
                            </Field>
                            <Field label="Sale date *" error={errors.sale_date}>
                                <Input type="date" max={today()} value={data.sale_date} onChange={(e) => setData('sale_date', e.target.value)} />
                            </Field>
                        </div>

                        {/* Cost and margin are owner-only; staff just get the price history. */}
                        {auth.can.owner && price > 0 && (
                            <div className={`rounded-xl p-3 text-sm ${profit >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                                Cost {inr(vehicle.purchase_price)} → Net {profit >= 0 ? 'profit' : 'loss'} <strong>{inr(Math.abs(profit))}</strong>
                            </div>
                        )}
                        <PriceHint
                            company={vehicle.company_name}
                            model={vehicle.model_name}
                            year={vehicle.model_year}
                            exclude={vehicle.id}
                            onUse={(p) => setData('selling_price', String(Math.round(p)))}
                            useLabel="Use"
                        />

                        <Field label="Payment mode *" error={errors.payment_mode}>
                            <div className="grid grid-cols-4 gap-1.5">
                                {Object.entries(PAYMENT_MODES).map(([k, label]) => (
                                    <button
                                        key={k}
                                        type="button"
                                        onClick={() => setData('payment_mode', k)}
                                        className={`rounded-xl px-1 py-2.5 text-xs font-semibold ring-1 ${data.payment_mode === k ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300'}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </Field>
                        {data.payment_mode === 'finance' && (
                            <Field label="Financier / bank *" error={errors.financier}>
                                <Input value={data.financier} onChange={(e) => setData('financier', e.target.value)} />
                            </Field>
                        )}
                        <Field label="Amount received now (₹)" hint="Leave empty if fully paid." error={errors.paid_amount}>
                            <Input type="number" inputMode="numeric" min="0" value={data.paid_amount} onChange={(e) => setData('paid_amount', e.target.value)} placeholder={String(price || '')} />
                        </Field>
                        {price - paid > 0 && <p className="text-sm font-semibold text-amber-700">Outstanding balance: {inr(price - paid)}</p>}
                    </>
                )}

                {step === 2 && (
                    <>
                        <Field label="Sale documents (max 4)" hint="Signed agreement, Form 29/30, delivery note…" error={errors.documents || errors['documents.0']}>
                            <div className="space-y-2">
                                {data.documents.map((f, i) => (
                                    <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                                        <span className="truncate">{f.name}</span>
                                        <button type="button" className="text-red-600" onClick={() => setData('documents', data.documents.filter((_, j) => j !== i))}>
                                            Remove
                                        </button>
                                    </div>
                                ))}
                                {data.documents.length < 4 && (
                                    <div className="flex gap-2">
                                        <label className="flex-1 cursor-pointer rounded-xl border border-dashed border-slate-300 py-3 text-center text-sm font-medium text-slate-600">
                                            Camera
                                            <input type="file" accept="image/*" capture="environment" hidden onChange={addDocs} />
                                        </label>
                                        <label className="flex-1 cursor-pointer rounded-xl border border-dashed border-slate-300 py-3 text-center text-sm font-medium text-slate-600">
                                            Files
                                            <input type="file" accept="image/*,application/pdf" multiple hidden onChange={addDocs} />
                                        </label>
                                    </div>
                                )}
                            </div>
                        </Field>
                        <Field label="Remarks / Terms & conditions" hint="Leave empty to print the standard terms." error={errors.notes}>
                            <Textarea rows={4} value={data.notes} onChange={(e) => setData('notes', e.target.value)} />
                        </Field>
                        <div className="rounded-xl bg-slate-50 p-3 text-sm">
                            <p>
                                <strong>{data.buyer.name}</strong> · {data.buyer.phone}
                            </p>
                            <p>
                                {inr(price)} via {PAYMENT_MODES[data.payment_mode]} · received {inr(paid)}
                            </p>
                        </div>
                    </>
                )}
            </div>
        </Sheet>
    );
}

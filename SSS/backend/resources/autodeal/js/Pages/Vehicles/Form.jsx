import { Head, Link, useForm, usePage } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import PhotoCapture, { DocumentCapture } from '@/Components/PhotoCapture';
import PriceHint from '@/Components/PriceHint';
import { Button, Field, Icon, Input, Select, Stepper, Textarea } from '@/Components/ui';
import { COMPANIES, ID_PROOFS, inr, INTAKE, today } from '@/lib/format';

const STEPS = ['Vehicle', 'Seller (optional)', 'Photos & Confirm'];

const STEP_FIELDS = [
    ['intake_type', 'source', 'company_name', 'model_name', 'variant', 'model_year', 'color', 'registration_number', 'chassis_number', 'engine_number', 'purchase_price', 'expected_price', 'intake_date', 'remarks'],
    ['seller', 'seller_id_proof'],
    ['photos'],
];

export default function VehicleForm({ vehicle, photoTypes, defaultBranch, sources = [] }) {
    const editing = !!vehicle;
    const { auth, branches } = usePage().props;
    const owner = auth.can.owner;
    // Staff type the cost at intake but never see or change it afterwards.
    const showCost = owner || !editing;
    // Owners and all-branch staff pick the branch at intake; edits move vehicles via Transfer instead.
    const pickBranch = !editing && branches.length > 1 && !auth.user.branch_id;
    const [step, setStep] = useState(0);

    const form = useForm({
        intake_type: vehicle?.intake_type ?? 'customer_buy',
        source: vehicle?.source ?? '',
        company_name: vehicle?.company_name ?? '',
        model_name: vehicle?.model_name ?? '',
        variant: vehicle?.variant ?? '',
        model_year: vehicle?.model_year ?? '',
        color: vehicle?.color ?? '',
        registration_number: vehicle?.registration_number ?? '',
        chassis_number: vehicle?.chassis_number ?? '',
        engine_number: vehicle?.engine_number ?? '',
        purchase_price: vehicle?.purchase_price ? String(Math.round(vehicle.purchase_price)) : '',
        expected_price: vehicle?.expected_price ? String(Math.round(vehicle.expected_price)) : '',
        intake_date: vehicle?.intake_date ?? today(),
        branch_id: vehicle?.branch_id ?? defaultBranch ?? '',
        remarks: vehicle?.remarks ?? '',
        seller: {
            name: vehicle?.seller?.name ?? '',
            phone: vehicle?.seller?.phone ?? '',
            address: vehicle?.seller?.address ?? '',
            id_proof_type: vehicle?.seller?.id_proof_type ?? 'aadhaar',
        },
        seller_id_proof: null,
        photos: [],
    });
    const { data, setData, errors, processing } = form;
    const err = (k) => errors[k];

    useEffect(() => {
        const keys = Object.keys(errors);
        if (!keys.length) return;
        const idx = STEP_FIELDS.findIndex((fields) => keys.some((k) => fields.some((f) => k === f || k.startsWith(f + '.') || k.startsWith(f + '_'))));
        if (idx >= 0) setStep(idx);
    }, [errors]);

    const set = (k) => (e) => setData(k, e.target.value);
    const setSeller = (k) => (e) => setData('seller', { ...data.seller, [k]: e.target.value });

    // needed: company, model, registration no., colour and the purchase price; everything else (and the seller) is optional
    const stepValid = [
        data.company_name.trim() && data.model_name.trim() && data.registration_number.replace(/\s/g, '').length >= 4 && data.color.trim() && (!showCost || data.purchase_price !== ''),
        true,
        true,
    ][step];

    function submit() {
        const opts = { forceFormData: true, preserveScroll: true };
        if (editing) {
            // Multipart PUT isn't supported by PHP – spoof the method over POST.
            form.transform((d) => ({ ...d, _method: 'put' }));
            form.post(route('autodeal.vehicles.update', vehicle.id), opts);
        } else {
            form.post(route('autodeal.vehicles.store'), opts);
        }
    }

    const isSeized = data.intake_type === 'seized';

    return (
        <>
            <Head title={editing ? 'Edit vehicle' : 'Vehicle intake'} />
            <div className="mb-3 flex items-center gap-2">
                <Link href={editing ? route('autodeal.vehicles.show', vehicle.id) : route('autodeal.vehicles.index')} className="-ml-2 rounded-full p-2 hover:bg-slate-200" aria-label="Back">
                    <Icon name="chevronLeft" />
                </Link>
                <h1 className="text-lg font-bold">{editing ? 'Edit vehicle' : 'New intake'}</h1>
            </div>

            <Stepper steps={STEPS} current={step} />

            <form onSubmit={(e) => e.preventDefault()} className="mt-4 space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                {step === 0 && (
                    <>
                        <Field label="Intake type *" error={err('intake_type')}>
                            <div className="grid grid-cols-2 gap-2">
                                {Object.entries(INTAKE).map(([k, label]) => (
                                    <button
                                        key={k}
                                        type="button"
                                        onClick={() => setData('intake_type', k)}
                                        className={`rounded-xl py-3 text-sm font-semibold ring-1 ${data.intake_type === k ? (k === 'seized' ? 'bg-orange-600 text-white ring-orange-600' : 'bg-brand-600 text-white ring-brand-600') : 'bg-white text-slate-700 ring-slate-300'}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </Field>
                        {!isSeized && (
                            <Field label="Source / showroom" error={err('source')} hint="Optional · where this vehicle came from (showroom, dealer, place)">
                                <Input list="sources" value={data.source} onChange={set('source')} placeholder="e.g. Shree Hero Showroom, Dhamtari" maxLength={120} autoComplete="off" />
                                <datalist id="sources">
                                    {sources.map((s) => <option key={s} value={s} />)}
                                </datalist>
                            </Field>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Company / Make *" error={err('company_name')} className="col-span-2 sm:col-span-1">
                                <Input list="companies" value={data.company_name} onChange={set('company_name')} placeholder="Maruti Suzuki" autoComplete="off" />
                                <datalist id="companies">
                                    {COMPANIES.map((c) => <option key={c} value={c} />)}
                                </datalist>
                            </Field>
                            <Field label="Model *" error={err('model_name')} className="col-span-2 sm:col-span-1">
                                <Input value={data.model_name} onChange={set('model_name')} placeholder="Swift" />
                            </Field>
                            <Field label="Variant" error={err('variant')}>
                                <Input value={data.variant} onChange={set('variant')} placeholder="VXi" />
                            </Field>
                            <Field label="Model year" error={err('model_year')}>
                                <Input type="number" inputMode="numeric" min="1980" max={new Date().getFullYear() + 1} value={data.model_year} onChange={set('model_year')} placeholder="2019" />
                            </Field>
                            <Field label="Colour *" error={err('color')}>
                                <Input value={data.color} onChange={set('color')} placeholder="White" />
                            </Field>
                            <Field label="Registration no. *" error={err('registration_number')}>
                                <Input value={data.registration_number} onChange={set('registration_number')} placeholder="CG04AB1234" className="uppercase" />
                            </Field>
                        </div>

                        <Field label="Chassis number" error={err('chassis_number')}>
                            <Input value={data.chassis_number} onChange={set('chassis_number')} className="font-mono uppercase" autoCapitalize="characters" spellCheck={false} />
                        </Field>
                        <Field label="Engine number" error={err('engine_number')}>
                            <Input value={data.engine_number} onChange={set('engine_number')} className="font-mono uppercase" autoCapitalize="characters" spellCheck={false} />
                        </Field>

                        <PriceHint
                            company={data.company_name}
                            model={data.model_name}
                            year={data.model_year}
                            exclude={vehicle?.id}
                            onUse={(p) => setData('expected_price', String(Math.round(p)))}
                            useLabel="Use as expected"
                        />
                        <div className="grid grid-cols-2 gap-3">
                            {showCost && (
                                <Field label={isSeized ? 'Intake value (₹) *' : 'Purchase price (₹) *'} error={err('purchase_price')}>
                                    <Input type="number" inputMode="numeric" min="0" value={data.purchase_price} onChange={set('purchase_price')} />
                                </Field>
                            )}
                            <Field label="Expected sale (₹)" error={err('expected_price')} hint="Asking price · shown online if listed" className={showCost ? '' : 'col-span-2'}>
                                <Input type="number" inputMode="numeric" min="0" value={data.expected_price} onChange={set('expected_price')} />
                            </Field>
                        </div>
                        {pickBranch && (
                            <Field label="Branch / yard *" error={err('branch_id')}>
                                <Select options={branches.map((b) => [b.id, b.name])} value={data.branch_id} onChange={set('branch_id')} />
                            </Field>
                        )}
                        <Field label="Intake date" error={err('intake_date')} hint="Empty = today">
                            <Input type="date" max={today()} value={data.intake_date} onChange={set('intake_date')} />
                        </Field>
                        <Field label="Remarks" error={err('remarks')}>
                            <Textarea value={data.remarks} onChange={set('remarks')} placeholder="Condition, keys, pending challans…" />
                        </Field>
                    </>
                )}

                {step === 1 && (
                    <>
                        <p className="text-sm text-slate-500">
                            {isSeized ? 'Seizing authority / finance company, or the previous owner.' : 'The customer selling the vehicle.'} Optional — fill in what you have, or tap
                            Continue to skip.
                        </p>
                        <Field label={isSeized ? 'Authority / owner name' : 'Seller name'} error={err('seller.name')}>
                            <Input value={data.seller.name} onChange={setSeller('name')} autoComplete="off" />
                        </Field>
                        <Field label="Mobile number" error={err('seller.phone')}>
                            <Input type="tel" inputMode="numeric" maxLength={14} value={data.seller.phone} onChange={setSeller('phone')} placeholder="98765 43210" />
                        </Field>
                        <Field label="Full address" error={err('seller.address')}>
                            <Textarea value={data.seller.address} onChange={setSeller('address')} />
                        </Field>
                        <Field label="ID proof type" error={err('seller.id_proof_type')}>
                            <Select options={ID_PROOFS} value={data.seller.id_proof_type} onChange={setSeller('id_proof_type')} />
                        </Field>
                        <Field error={err('seller_id_proof')}>
                            <DocumentCapture value={data.seller_id_proof} onChange={(f) => setData('seller_id_proof', f)} existing={vehicle?.seller?.has_id_proof} label="Aadhaar / DL / PAN photo or PDF" />
                        </Field>
                    </>
                )}

                {step === 2 && (
                    <>
                        <Field label={editing ? 'Add more photos' : 'Vehicle photos'} error={err('photos') || Object.entries(errors).find(([k]) => k.startsWith('photos.'))?.[1]}>
                            <PhotoCapture value={data.photos} onChange={(p) => setData('photos', p)} types={photoTypes} />
                        </Field>
                        <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
                            <p className="font-semibold">
                                {data.model_year} {data.company_name} {data.model_name} {data.variant}
                            </p>
                            <p className="font-mono text-xs text-slate-600">
                                {[data.registration_number.toUpperCase(), data.color, data.chassis_number && `CH ${data.chassis_number}`, data.engine_number && `EN ${data.engine_number}`]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </p>
                            <p>
                                {INTAKE[data.intake_type]}
                                {!isSeized && data.source && ` · ${data.source}`}
                                {showCost && ` · ${inr(data.purchase_price)}`}
                                {data.seller.name && ` · from ${data.seller.name}`}
                            </p>
                        </div>
                    </>
                )}
            </form>

            {/* Sticky action bar, above the bottom nav on phones */}
            <div className="sticky bottom-20 z-20 mt-4 flex gap-2 sm:bottom-4">
                {step > 0 && (
                    <Button variant="outline" className="flex-1 shadow" onClick={() => setStep(step - 1)}>
                        Back
                    </Button>
                )}
                {step < 2 ? (
                    <Button className="flex-[2] shadow" disabled={!stepValid} onClick={() => setStep(step + 1)}>
                        Continue
                    </Button>
                ) : (
                    <Button variant="success" className="flex-[2] shadow" loading={processing} onClick={submit}>
                        {editing ? 'Save changes' : 'Add to stock'}
                    </Button>
                )}
            </div>
            {form.progress && <p className="mt-2 text-center text-xs text-slate-500">Uploading… {form.progress.percentage}%</p>}
        </>
    );
}

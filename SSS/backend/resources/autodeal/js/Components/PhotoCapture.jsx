import { useEffect, useRef, useState } from 'react';
import { compressImage } from '@/lib/compressImage';
import { PHOTO_TYPES } from '@/lib/format';
import { Icon } from './ui';

/**
 * Grid of labelled photo slots (Front, Rear, Interior …). Each slot opens the
 * rear camera directly on phones; photos are compressed before they enter form state.
 * value: [{ file: File, type: 'front' }]
 */
export default function PhotoCapture({ value, onChange, types = Object.keys(PHOTO_TYPES), max = 12 }) {
    const [busy, setBusy] = useState(null);
    const extraInput = useRef(null);

    async function add(type, input) {
        const files = Array.from(input.files || []).slice(0, max - value.length);
        input.value = ''; // allow picking the same file again later
        if (!files.length) return;
        setBusy(type);
        const compressed = await Promise.all(files.map((f) => compressImage(f)));
        onChange([...value, ...compressed.map((file) => ({ file, type }))]);
        setBusy(null);
    }

    const remove = (idx) => onChange(value.filter((_, i) => i !== idx));
    const totalKB = Math.round(value.reduce((s, p) => s + p.file.size, 0) / 1024);

    return (
        <div>
            <div className="grid grid-cols-3 gap-2">
                {types
                    .filter((t) => t !== 'other')
                    .map((type) => {
                        const idx = value.findIndex((p) => p.type === type);
                        return idx >= 0 ? (
                            <Thumb key={type} photo={value[idx]} onRemove={() => remove(idx)} />
                        ) : (
                            <Slot key={type} label={PHOTO_TYPES[type]} busy={busy === type} onFiles={(input) => add(type, input)} />
                        );
                    })}
                {value.map((p, i) => (p.type === 'other' || value.findIndex((x) => x.type === p.type) !== i) ? <Thumb key={i} photo={p} onRemove={() => remove(i)} /> : null)}
                {value.length < max && (
                    <button
                        type="button"
                        onClick={() => extraInput.current?.click()}
                        className="flex aspect-square flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-xs text-slate-500"
                    >
                        <Icon name="plus" />
                        More
                        <input ref={extraInput} type="file" accept="image/*" multiple hidden onChange={(e) => add('other', e.target)} />
                    </button>
                )}
            </div>
            <p className="mt-2 text-xs text-slate-500">
                {value.length}/{max} photos · {totalKB} KB after compression
            </p>
        </div>
    );
}

function Slot({ label, busy, onFiles }) {
    return (
        <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-1 text-center text-xs font-medium text-slate-600 active:bg-slate-100">
            {busy ? <span className="size-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /> : <Icon name="camera" className="size-6 text-slate-400" />}
            {label}
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e.target)} />
        </label>
    );
}

function Thumb({ photo, onRemove }) {
    const [src, setSrc] = useState(null);
    useEffect(() => {
        const url = URL.createObjectURL(photo.file);
        setSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [photo.file]);

    return (
        <div className="relative aspect-square overflow-hidden rounded-xl bg-slate-200">
            {src && <img src={src} alt="" className="size-full object-cover" />}
            <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-center text-[10px] text-white">{PHOTO_TYPES[photo.type]}</span>
            <button type="button" onClick={onRemove} className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white" aria-label="Remove photo">
                <Icon name="x" className="size-3.5" />
            </button>
        </div>
    );
}

/** Single ID-proof / document picker: camera or gallery for images, PDFs pass through. */
export function DocumentCapture({ value, onChange, label = 'Upload ID proof', existing }) {
    const [busy, setBusy] = useState(false);

    async function pick(e) {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        setBusy(true);
        onChange(await compressImage(f));
        setBusy(false);
    }

    return (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
            <Icon name="file" className="size-6 shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1 text-sm">
                {value ? (
                    <span className="block truncate font-medium">{value.name} · {Math.round(value.size / 1024)} KB</span>
                ) : (
                    <span className="text-slate-600">{existing ? 'On file – upload to replace' : label}</span>
                )}
            </div>
            {value ? (
                <button type="button" className="text-sm font-semibold text-red-600" onClick={() => onChange(null)}>
                    Remove
                </button>
            ) : (
                <div className="flex gap-1">
                    <label className="cursor-pointer rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold ring-1 ring-slate-300">
                        {busy ? '…' : 'Camera'}
                        <input type="file" accept="image/*" capture="environment" hidden onChange={pick} />
                    </label>
                    <label className="cursor-pointer rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold ring-1 ring-slate-300">
                        File
                        <input type="file" accept="image/*,application/pdf" hidden onChange={pick} />
                    </label>
                </div>
            )}
        </div>
    );
}

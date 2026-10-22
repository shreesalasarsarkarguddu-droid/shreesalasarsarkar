import { useEffect } from 'react';
import { STATUS } from '@/lib/format';

export function Field({ label, error, hint, children, className = '' }) {
    return (
        <label className={`block ${className}`}>
            {label && <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>}
            {children}
            {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
            {error && <span className="mt-1 block text-xs font-medium text-red-600">{error}</span>}
        </label>
    );
}

const control =
    'block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 shadow-xs outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100';

export function Input({ className = '', ...props }) {
    return <input className={`${control} ${className}`} {...props} />;
}

export function Textarea({ className = '', ...props }) {
    return <textarea rows={3} className={`${control} ${className}`} {...props} />;
}

/** options: { value: label } or an ordered list of [value, label] pairs. */
export function Select({ options, placeholder, className = '', ...props }) {
    const entries = Array.isArray(options) ? options : Object.entries(options);
    return (
        <select className={`${control} ${className}`} {...props}>
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {entries.map(([value, label]) => (
                <option key={value} value={value}>
                    {label}
                </option>
            ))}
        </select>
    );
}

const variants = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700',
    dark: 'bg-ink text-white hover:bg-slate-800',
    outline: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-slate-700 hover:bg-slate-100',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700',
};

export function Button({ variant = 'primary', className = '', loading, children, ...props }) {
    return (
        <button
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${variants[variant]} ${className}`}
            disabled={loading || props.disabled}
            {...props}
        >
            {loading && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
            {children}
        </button>
    );
}

export function StatusBadge({ status }) {
    const s = STATUS[status] ?? STATUS.in_stock;
    return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

export function Card({ className = '', children }) {
    return <div className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${className}`}>{children}</div>;
}

export function Row({ label, children }) {
    return (
        <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
            <span className="text-slate-500">{label}</span>
            <span className="text-right font-medium break-all text-slate-900">{children ?? '—'}</span>
        </div>
    );
}

/** Bottom sheet on phones, centered dialog on larger screens. */
export function Sheet({ open, onClose, title, children, footer }) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = '';
        };
    }, [open, onClose]);

    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
            <div className="relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:max-w-lg sm:rounded-3xl">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                    <h2 className="text-base font-bold">{title}</h2>
                    <button onClick={onClose} className="-mr-2 rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Close">
                        <Icon name="x" />
                    </button>
                </div>
                <div className="overflow-y-auto px-5 py-4">{children}</div>
                {footer && <div className="border-t border-slate-100 px-5 py-3 pb-safe">{footer}</div>}
            </div>
        </div>
    );
}

export function Stepper({ steps, current }) {
    return (
        <ol className="flex gap-2">
            {steps.map((s, i) => (
                <li key={s} className="flex-1">
                    <div className={`h-1.5 rounded-full ${i <= current ? 'bg-brand-600' : 'bg-slate-200'}`} />
                    <span className={`mt-1 block text-xs ${i === current ? 'font-semibold text-brand-700' : 'text-slate-500'}`}>
                        {i + 1}. {s}
                    </span>
                </li>
            ))}
        </ol>
    );
}

// Minimal inline icon set (stroke icons) – avoids shipping an icon library.
const paths = {
    car: 'M5 17h14M6 17v2m12-2v2M3 13l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5v4H3v-4Zm0 0h18M7 14.5h.01M17 14.5h.01',
    plus: 'M12 5v14M5 12h14',
    chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h3',
    search: 'm21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z',
    filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
    camera: 'M4 8h3l2-3h6l2 3h3v11H4V8Zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    x: 'M6 6l12 12M18 6 6 18',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    tag: 'M3 12V3h9l9 9-9 9-9-9Zm5-4h.01',
    download: 'M12 3v12m0 0-4-4m4 4 4-4M4 21h16',
    share: 'M12 3v12m0-12-4 4m4-4 4 4M5 13v7h14v-7',
    logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
    chevronLeft: 'm15 18-6-6 6-6',
    edit: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
    trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
    phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z',
    file: 'M14 3H6v18h12V7l-4-4Zm0 0v4h4',
    rupee: 'M6 4h12M6 9h12M9 4c4 0 6 2 6 5s-2 5-6 5H7l7 7',
};

export function Icon({ name, className = 'size-5' }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
            <path d={paths[name]} />
        </svg>
    );
}

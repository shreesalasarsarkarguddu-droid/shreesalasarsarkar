import { usePage } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { inr } from '@/lib/format';

/**
 * "What has this model sold for?" from the dealer's own sales history.
 * Owners also see average cost and margin. Optional onUse(price) adds a button
 * to copy the suggested price into a form field.
 */
export default function PriceHint({ company, model, year, exclude, onUse, useLabel = 'Use' }) {
    const { auth } = usePage().props;
    const [hint, setHint] = useState(null);

    useEffect(() => {
        if (!company?.trim() || !model?.trim()) return setHint(null);
        const ctrl = new AbortController();
        const t = setTimeout(async () => {
            try {
                const params = new URLSearchParams({ company: company.trim(), model: model.trim() });
                if (year) params.set('year', year);
                if (exclude) params.set('exclude', exclude);
                const res = await fetch(`${route('autodeal.price-hint')}?${params}`, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
                setHint(res.ok ? await res.json() : null);
            } catch {
                /* aborted or offline – no hint */
            }
        }, 400);
        return () => {
            clearTimeout(t);
            ctrl.abort();
        };
    }, [company, model, year, exclude]);

    if (!hint) return null;
    if (!hint.count) {
        return <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">No past sales of this model yet – no price history.</p>;
    }

    return (
        <div className="rounded-xl bg-brand-50 px-3 py-2.5 text-sm text-slate-800 ring-1 ring-brand-100">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <p className="text-xs font-semibold text-brand-700 uppercase">
                        Your past sales · {hint.count} sold ({hint.scope})
                    </p>
                    <p className="mt-0.5">
                        Avg <strong>{inr(hint.avg_price)}</strong>
                        <span className="text-slate-500">
                            {' '}
                            · range {inr(hint.min_price)}–{inr(hint.max_price)}
                        </span>
                    </p>
                </div>
                {onUse && (
                    <button type="button" onClick={() => onUse(hint.avg_price)} className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-100">
                        {useLabel}
                    </button>
                )}
            </div>
            <p className="mt-1 text-xs text-slate-600">
                {auth.can.owner && hint.avg_cost != null && (
                    <>
                        Avg cost {inr(hint.avg_cost)} · margin {inr(hint.avg_profit)} ({hint.avg_margin}%) ·{' '}
                    </>
                )}
                {hint.avg_days != null && <>sells in ~{hint.avg_days} days</>}
            </p>
        </div>
    );
}

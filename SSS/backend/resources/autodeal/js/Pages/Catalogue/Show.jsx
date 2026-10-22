import { Head, Link } from '@inertiajs/react';
import { useState } from 'react';
import { Icon } from '@/Components/ui';
import { inr, PHOTO_TYPES } from '@/lib/format';

/** Public vehicle page: photos, price and one-tap Call / WhatsApp to the right branch. */
export default function CatalogueShow({ vehicle: v, dealer }) {
    const [active, setActive] = useState(0);
    const phone = v.branch?.phone || dealer.phone;
    const message = `Hi, I'm interested in the ${v.title}${v.price ? ` (${inr(v.price)})` : ''} – ${window.location.href}`;
    const wa = phone ? `https://wa.me/91${String(phone).slice(-10)}?text=${encodeURIComponent(message)}` : null;
    const photo = v.photos[active];

    return (
        <div className="min-h-dvh bg-slate-50 pb-28">
            <Head title={`${v.title} – ${dealer.name}`} />
            <header className="bg-ink text-white">
                <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
                    <Link href={route('autodeal.catalogue.index')} className="-ml-2 rounded-full p-2 hover:bg-white/10" aria-label="All vehicles">
                        <Icon name="chevronLeft" />
                    </Link>
                    <span className="truncate font-semibold">{dealer.name}</span>
                </div>
            </header>

            <main className="mx-auto max-w-3xl">
                <div className="relative aspect-[4/3] bg-slate-200 sm:mt-4 sm:overflow-hidden sm:rounded-2xl">
                    {photo ? (
                        <img src={photo.url} alt={`${v.title} – ${PHOTO_TYPES[photo.type]}`} className="size-full object-cover" />
                    ) : (
                        <div className="flex size-full items-center justify-center text-slate-400">
                            <Icon name="car" className="size-20" />
                        </div>
                    )}
                    {v.reserved && <span className="absolute top-3 left-3 rounded-full bg-amber-500 px-2.5 py-1 text-xs font-bold text-white">Reserved</span>}
                </div>
                {v.photos.length > 1 && (
                    <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 py-2">
                        {v.photos.map((p, i) => (
                            <button key={p.url} onClick={() => setActive(i)} className={`size-16 shrink-0 overflow-hidden rounded-lg ring-2 ${i === active ? 'ring-brand-600' : 'ring-transparent'}`} aria-label={`Photo ${i + 1}`}>
                                <img src={p.url} alt="" loading="lazy" className="size-full object-cover" />
                            </button>
                        ))}
                    </div>
                )}

                <div className="px-4 pt-2">
                    <h1 className="text-xl font-bold">{v.title}</h1>
                    <p className="mt-1 text-2xl font-bold text-brand-700">{v.price ? inr(v.price) : 'Price on request'}</p>

                    <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                        {[
                            ['Make', v.company_name],
                            ['Model', [v.model_name, v.variant].filter(Boolean).join(' ')],
                            ['Year', v.model_year],
                            ['Colour', v.color],
                            ['Registration', v.registration],
                            ['Location', v.branch?.name],
                        ]
                            .filter(([, val]) => val)
                            .map(([k, val]) => (
                                <div key={k} className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                                    <dt className="text-xs text-slate-500">{k}</dt>
                                    <dd className="font-semibold">{val}</dd>
                                </div>
                            ))}
                    </dl>
                    {v.branch?.address && <p className="mt-3 text-sm text-slate-600">📍 {v.branch.address}</p>}
                    <p className="mt-4 text-xs text-slate-400">Price is indicative and subject to availability. Documents available for inspection at the showroom.</p>
                </div>
            </main>

            {/* Sticky contact bar */}
            {phone && (
                <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 pt-3 backdrop-blur pb-safe">
                    <div className="mx-auto flex max-w-3xl gap-2">
                        <a href={`tel:${phone}`} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-ink font-semibold text-white">
                            <Icon name="phone" /> Call
                        </a>
                        <a href={wa} target="_blank" rel="noopener" className="flex min-h-12 flex-[2] items-center justify-center gap-2 rounded-xl bg-green-600 font-semibold text-white">
                            <Icon name="share" /> WhatsApp – I’m interested
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
}

import { Icon } from './ui';

const digits = (p) => String(p ?? '').replace(/\D/g, '').slice(-10);
export const waLink = (number, text) => `https://wa.me/91${digits(number)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/** Public catalogue: the shop's contact details (Auto Deal → Account → Shop details). */
export default function ShopContact({ dealer, className = '' }) {
    const phones = [dealer.phone, dealer.phone2].filter(Boolean);
    if (!phones.length && !dealer.address && !dealer.email && !dealer.about && !dealer.hours) return null;
    return (
        <section className={`rounded-2xl bg-white p-4 ring-1 ring-slate-200 ${className}`} aria-label="Contact us">
            <h2 className="text-lg font-bold">{dealer.name}</h2>
            {dealer.tagline && <p className="text-sm text-slate-500">{dealer.tagline}</p>}
            {dealer.about && <p className="mt-2 text-sm whitespace-pre-line text-slate-700">{dealer.about}</p>}

            <dl className="mt-3 space-y-2 text-sm">
                {dealer.address && (
                    <div className="flex gap-2">
                        <dt className="shrink-0" aria-label="Address">📍</dt>
                        <dd className="text-slate-700">{dealer.address}</dd>
                    </div>
                )}
                {dealer.hours && (
                    <div className="flex gap-2">
                        <dt className="shrink-0" aria-label="Opening hours">🕘</dt>
                        <dd className="text-slate-700">{dealer.hours}</dd>
                    </div>
                )}
                {phones.map((p) => (
                    <div key={p} className="flex gap-2">
                        <dt className="shrink-0" aria-label="Mobile">📞</dt>
                        <dd>
                            <a href={`tel:${p}`} className="font-semibold text-brand-700">{p}</a>
                        </dd>
                    </div>
                ))}
                {dealer.email && (
                    <div className="flex gap-2">
                        <dt className="shrink-0" aria-label="Email">✉️</dt>
                        <dd>
                            <a href={`mailto:${dealer.email}`} className="font-semibold break-all text-brand-700">{dealer.email}</a>
                        </dd>
                    </div>
                )}
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
                {dealer.phone && (
                    <a href={`tel:${dealer.phone}`} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-white">
                        <Icon name="phone" className="size-4" /> Call
                    </a>
                )}
                {dealer.whatsapp && (
                    <a href={waLink(dealer.whatsapp, `Hi ${dealer.name}, I saw your vehicles online.`)} target="_blank" rel="noopener" className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 px-4 text-sm font-semibold text-white">
                        <Icon name="share" className="size-4" /> WhatsApp
                    </a>
                )}
                {dealer.map_url && (
                    <a href={dealer.map_url} target="_blank" rel="noopener" className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-slate-800 ring-1 ring-slate-300">
                        📍 Directions
                    </a>
                )}
            </div>
        </section>
    );
}

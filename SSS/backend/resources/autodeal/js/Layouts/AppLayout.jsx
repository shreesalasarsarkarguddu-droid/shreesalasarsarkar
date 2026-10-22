import { Link, usePage } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { Icon } from '@/Components/ui';

const BASE_NAV = [
    { href: '/autodeal/vehicles', match: /^\/autodeal\/vehicles(?!\/create)/, icon: 'car', label: 'Stock' },
    { href: '/autodeal/sales', match: /^\/autodeal\/sales/, icon: 'receipt', label: 'Sales' },
    { href: '/autodeal/vehicles/create', match: /^\/autodeal\/vehicles\/create/, icon: 'plus', label: 'Intake', primary: true },
];
const OWNER_TAB = { href: '/autodeal/reports', match: /^\/autodeal\/(reports|activity|branches|account)/, icon: 'chart', label: 'Reports' };
const STAFF_TAB = { href: '/autodeal/account', match: /^\/autodeal\/account/, icon: 'user', label: 'Account' };

export default function AppLayout({ children }) {
    const { url, props } = usePage();
    const path = url.split('?')[0];
    const NAV = [...BASE_NAV, props.auth.can.owner ? OWNER_TAB : STAFF_TAB];

    return (
        <div className="min-h-dvh pb-24 sm:pb-8">
            <header className="sticky top-0 z-30 bg-ink text-white">
                <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-4">
                    {/* Auto Deal is part of Shree Salasar Sarkar: the logo goes back to its screens */}
                    <a href={props.app.home} className="flex min-w-0 items-center gap-2 font-bold" title="Back to Shree Salasar Sarkar">
                        <Icon name="chevronLeft" className="size-5 shrink-0 text-slate-400" />
                        <img src="/icons/icon-192.png" alt="" className="size-7 shrink-0 rounded-lg" />
                        <span className="truncate">Auto Deal</span>
                    </a>
                    {/* Desktop/tablet nav; phones use the bottom bar */}
                    <nav className="hidden items-center gap-1 sm:flex">
                        {NAV.map((n) => (
                            <Link key={n.href} href={n.href} className={`rounded-lg px-3 py-1.5 text-sm ${n.match.test(path) ? 'bg-white/15' : 'text-slate-300 hover:text-white'}`}>
                                {n.label}
                            </Link>
                        ))}
                    </nav>
                    <Link
                        href="/autodeal/account"
                        className={`flex shrink-0 items-center gap-1.5 rounded-lg p-2 text-sm hover:text-white ${path.startsWith('/autodeal/account') ? 'text-white' : 'text-slate-300'}`}
                        aria-label="Account"
                    >
                        <Icon name="user" />
                        <span className="hidden max-w-32 truncate md:inline">{props.auth.user?.name}</span>
                    </Link>
                </div>
            </header>

            <main className="mx-auto max-w-3xl px-4 pt-4">{children}</main>

            <Flash flash={props.flash} />

            {/* Bottom navigation – thumb zone */}
            <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur pb-safe sm:hidden">
                <div className="mx-auto grid max-w-md grid-cols-4">
                    {NAV.map((n) =>
                        n.primary ? (
                            <Link key={n.href} href={n.href} className="flex flex-col items-center pt-1 text-[11px] font-semibold text-brand-700">
                                <span className="-mt-5 flex size-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg ring-4 ring-white">
                                    <Icon name="plus" className="size-6" />
                                </span>
                                {n.label}
                            </Link>
                        ) : (
                            <Link key={n.href} href={n.href} className={`flex flex-col items-center gap-0.5 pt-2 text-[11px] font-medium ${n.match.test(path) ? 'text-brand-700' : 'text-slate-500'}`}>
                                <Icon name={n.icon} className="size-6" />
                                {n.label}
                            </Link>
                        ),
                    )}
                </div>
            </nav>
        </div>
    );
}

function Flash({ flash }) {
    const [msg, setMsg] = useState(null);

    useEffect(() => {
        const m = flash.success ? { text: flash.success, ok: true } : flash.error ? { text: flash.error, ok: false } : null;
        if (!m) return;
        setMsg(m);
        const t = setTimeout(() => setMsg(null), 3500);
        return () => clearTimeout(t);
    }, [flash]);

    if (!msg) return null;
    return (
        <div className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-md sm:bottom-6" role="status">
            <div className={`rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${msg.ok ? 'bg-emerald-600' : 'bg-red-600'}`} onClick={() => setMsg(null)}>
                {msg.text}
            </div>
        </div>
    );
}

import { Head, Link, router } from '@inertiajs/react';
import { Card, Field, Input, Select } from '@/Components/ui';
import ChangeList from '@/Components/ChangeList';

export default function Activity({ logs, filters, users, areas }) {
    const apply = (next) =>
        router.get(route('autodeal.activity.index'), Object.fromEntries(Object.entries({ ...filters, ...next }).filter(([, v]) => v)), { preserveState: true, replace: true });

    return (
        <>
            <Head title="Activity log" />
            <h1 className="text-lg font-bold">Activity log</h1>
            <p className="text-sm text-slate-500">Every intake, edit, sale, payment, deletion, login and export – who and when.</p>

            <Card className="mt-3">
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Person">
                        <Select options={users.map((u) => [u.id, u.name])} placeholder="Everyone" value={filters.user ?? ''} onChange={(e) => apply({ user: e.target.value })} />
                    </Field>
                    <Field label="Area">
                        <Select options={areas} placeholder="Everything" value={filters.area ?? ''} onChange={(e) => apply({ area: e.target.value })} />
                    </Field>
                    <Field label="From">
                        <Input type="date" value={filters.from ?? ''} onChange={(e) => apply({ from: e.target.value })} />
                    </Field>
                    <Field label="To">
                        <Input type="date" value={filters.to ?? ''} onChange={(e) => apply({ to: e.target.value })} />
                    </Field>
                </div>
            </Card>

            <div className="mt-3 space-y-2">
                {logs.data.length === 0 && <p className="rounded-2xl bg-white p-6 text-center text-slate-500 ring-1 ring-slate-200">Nothing logged for these filters.</p>}
                {logs.data.map((a) => (
                    <div key={a.id} className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
                        <div className="flex items-start justify-between gap-2">
                            <p className="text-sm text-slate-800">
                                {a.vehicle_id ? (
                                    <Link href={route('autodeal.vehicles.show', a.vehicle_id)} className="text-brand-700">
                                        {a.description}
                                    </Link>
                                ) : (
                                    a.description
                                )}
                            </p>
                            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-600">{a.action}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                            {new Date(a.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {a.user ?? 'System'}
                            {a.ip && ` · ${a.ip}`}
                        </p>
                        {a.changes && <ChangeList changes={a.changes} />}
                    </div>
                ))}
            </div>

            <div className="mt-4 flex justify-between">
                {logs.prev_page_url ? <Link href={logs.prev_page_url} className="font-semibold text-brand-700" preserveScroll>← Newer</Link> : <span />}
                {logs.next_page_url && <Link href={logs.next_page_url} className="font-semibold text-brand-700" preserveScroll>Older →</Link>}
            </div>
        </>
    );
}

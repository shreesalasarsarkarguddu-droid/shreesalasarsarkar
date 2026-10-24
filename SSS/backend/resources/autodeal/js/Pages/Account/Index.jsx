import { Head, Link, router, usePage } from '@inertiajs/react';
import { Card, Icon, Select } from '@/Components/ui';

/** Who uses Auto Deal. Logins, passwords and the "Auto Deal" permission live in Shree Salasar Sarkar → Users. */
export default function Account({ users, allBranches }) {
    const { auth, app } = usePage().props;
    const owner = auth.can.owner;
    const yards = allBranches.filter((b) => b.is_active);

    return (
        <>
            <Head title="Account" />
            <h1 className="text-lg font-bold">Account</h1>
            <p className="text-sm text-slate-500">
                Signed in as {auth.user.name} ({auth.user.email}) · {owner ? 'Owner (admin)' : 'Staff'}
            </p>

            {owner && (
                <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs font-semibold sm:grid-cols-4">
                    <Link href={route('autodeal.shop.edit')} className="rounded-2xl bg-white px-2 py-3 ring-1 ring-slate-200">
                        <Icon name="edit" className="mx-auto mb-1 size-5 text-slate-500" /> Shop details
                    </Link>
                    <Link href={route('autodeal.activity.index')} className="rounded-2xl bg-white px-2 py-3 ring-1 ring-slate-200">
                        <Icon name="eye" className="mx-auto mb-1 size-5 text-slate-500" /> Activity log
                    </Link>
                    <Link href={route('autodeal.branches.index')} className="rounded-2xl bg-white px-2 py-3 ring-1 ring-slate-200">
                        <Icon name="car" className="mx-auto mb-1 size-5 text-slate-500" /> Yards
                    </Link>
                    <a href={route('autodeal.catalogue.index')} target="_blank" className="rounded-2xl bg-white px-2 py-3 ring-1 ring-slate-200">
                        <Icon name="share" className="mx-auto mb-1 size-5 text-slate-500" /> Public catalogue
                    </a>
                </div>
            )}

            <Card className="mt-4">
                <h2 className="font-bold">Login and password</h2>
                <p className="mt-1 text-sm text-slate-600">
                    Auto Deal uses your Shree Salasar Sarkar login. Change your password there (Profile). {owner && 'Give staff access in Users → "Auto Deal".'}
                </p>
                <a href={app.home} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
                    <Icon name="chevronLeft" className="size-4" /> Back to Shree Salasar Sarkar
                </a>
            </Card>

            {owner && (
                <Card className="mt-4">
                    <h2 className="font-bold">Who uses Auto Deal</h2>
                    <p className="mb-2 text-xs text-slate-500">
                        Owners (admins) see costs, profit, reports and can delete. Staff can do intake, sales and payments only
                        {yards.length > 1 && '; a staff member limited to one yard only sees that yard’s vehicles'}.
                    </p>
                    {users.length === 0 ? (
                        <p className="text-sm text-slate-500">Nobody yet besides the admins.</p>
                    ) : (
                        <ul className="divide-y divide-slate-100">
                            {users.map((u) => (
                                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                                    <div className="min-w-0">
                                        <p className="truncate font-medium">
                                            {u.name}{' '}
                                            <span className={`ml-1 rounded px-1.5 py-px text-[10px] font-bold uppercase ${u.role === 'owner' ? 'bg-ink text-white' : 'bg-slate-100 text-slate-600'}`}>
                                                {u.role}
                                            </span>
                                        </p>
                                        <p className="truncate text-xs text-slate-500">{u.email}</p>
                                    </div>
                                    {u.role === 'staff' && yards.length > 1 && (
                                        <div className="w-44">
                                            <Select
                                                aria-label={`Yard of ${u.name}`}
                                                options={yards.map((b) => [b.id, b.name])}
                                                placeholder="Every yard"
                                                value={u.branch_id ?? ''}
                                                onChange={(e) => router.put(route('autodeal.account.users.update', u.id), { branch_id: e.target.value || null }, { preserveScroll: true })}
                                            />
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            )}
        </>
    );
}

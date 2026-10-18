import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getStaff } from "@/lib/staff";
import { can, homeFor } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { dmy, inr } from "@/lib/format";
import { todayIST } from "@/lib/schedule";
import { CollectButton } from "../payments/collect-button";

export const metadata: Metadata = { title: "My collection list · Shree Salasar Sarkar" };

type Item = {
  id: number; user_id: string; collector: string; source: "old" | "new"; ref_id: number; folio: string; borrower_name: string;
  mobile: string | null; address: string | null; vehicle: string | null; emi: number | null; balance: number | null; arrears: number | null;
  overdue_emis: number | null; next_due: string | null; seized: boolean; closed: boolean; collected: number; receipts: number; note: string | null;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const shift = (d: string, days: number) => new Date(Date.parse(d + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
const rs = (v: number | null | undefined) => inr(String(v ?? 0));

export default async function MyCollectionsPage({ searchParams }: PageProps<"/my-collections">) {
  const staff = await getStaff();
  if (!staff) notFound();
  if (!can(staff, "collect") && !can(staff, "assign")) redirect(homeFor(staff));
  const manager = can(staff, "assign");
  const sp = await searchParams;
  const today = todayIST();
  const raw = one(sp.day);
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
  const who = one(sp.who) ?? "";

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const me = String(claims?.claims?.sub ?? "");
  // collection men: their own list; anyone who assigns: everyone, or one person
  const target = manager ? (/^[0-9a-f-]{36}$/.test(who) ? who : null) : me;
  const [{ data, error }, { data: people }] = await Promise.all([
    supabase.rpc("collection_list", { p_day: day, p_user: target }),
    manager ? supabase.rpc("staff_names") : Promise.resolve({ data: null }),
  ]);
  if (error) {
    console.error("collection_list failed:", error);
    throw new Error("Could not load the collection list.");
  }
  const items = (data ?? []) as Item[];
  const done = items.filter((i) => i.collected > 0);
  const due = items.reduce((t, i) => t + Number(i.arrears && i.arrears > 0 ? i.arrears : (i.emi ?? 0)), 0);
  const got = items.reduce((t, i) => t + Number(i.collected), 0);
  const href = (d: string) => `/my-collections?day=${d}${who ? `&who=${who}` : ""}`;
  const dayLabel = new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

  // group by collection man (only shown when one person sees everyone)
  const groups = new Map<string, Item[]>();
  for (const i of items) groups.set(i.collector, [...(groups.get(i.collector) ?? []), i]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{manager && !target ? "Collection lists" : "My collection list"}</h1>
          <p className="text-sm text-slate-500">{day === today ? `Today · ${dayLabel}` : dayLabel}</p>
        </div>
        <nav className="flex items-center gap-2" aria-label="Day">
          <Link href={href(shift(day, -1))} className="flex h-10 items-center rounded-lg bg-white px-3 text-sm font-semibold ring-1 ring-slate-300">
            ←
          </Link>
          {day !== today && (
            <Link href={href(today)} className="flex h-10 items-center rounded-lg bg-white px-3 text-sm font-semibold text-blue-700 ring-1 ring-slate-300">
              Today
            </Link>
          )}
          <Link href={href(shift(day, 1))} className="flex h-10 items-center rounded-lg bg-white px-3 text-sm font-semibold ring-1 ring-slate-300">
            →
          </Link>
        </nav>
      </div>

      {manager && (
        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="day" value={day} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Collection man</span>
            <select name="who" defaultValue={who} className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm">
              <option value="">Everyone</option>
              {((people ?? []) as { user_id: string; full_name: string }[]).map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>
          <button className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white">Show</button>
          <Link href={`/assign?day=${day}`} className="ml-auto flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-blue-700 ring-1 ring-slate-300">
            Assign accounts →
          </Link>
        </form>
      )}

      {items.length > 0 && (
        <dl className="num grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
            <dt className="text-xs text-slate-500">Visited / paid</dt>
            <dd className="text-lg font-bold">
              {done.length} <span className="text-sm font-medium text-slate-500">of {items.length}</span>
            </dd>
          </div>
          <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
            <dt className="text-xs text-slate-500">To collect</dt>
            <dd className="text-lg font-bold text-red-700">{rs(due)}</dd>
          </div>
          <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
            <dt className="text-xs text-slate-500">Collected</dt>
            <dd className="text-lg font-bold text-emerald-700">{rs(got)}</dd>
          </div>
        </dl>
      )}

      {items.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          {manager ? "No accounts are assigned for this day." : "No accounts are assigned to you for this day. Ask the admin."}
        </p>
      ) : (
        [...groups.entries()].map(([collector, list]) => (
          <section key={collector} className="space-y-2">
            {manager && !target && (
              <h2 className="px-1 text-sm font-semibold text-slate-700">
                {collector} · {list.filter((i) => i.collected > 0).length}/{list.length} paid ·{" "}
                {rs(list.reduce((t, i) => t + Number(i.collected), 0))}
              </h2>
            )}
            <ul className="space-y-2">
              {list.map((i) => (
                <li key={i.id} className={`rounded-xl bg-white p-4 ring-1 ${i.collected > 0 ? "ring-emerald-300" : "ring-slate-200"}`}>
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1">
                      <Link href={i.source === "old" ? `/accounts/${i.ref_id}` : `/loans/${i.ref_id}`} className="font-semibold text-blue-700">
                        {i.borrower_name}
                      </Link>
                      <p className="text-xs text-slate-500">
                        Folio {i.folio}
                        {i.vehicle && ` · ${i.vehicle}`}
                      </p>
                    </div>
                    {i.collected > 0 ? (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                        ✓ Collected {rs(i.collected)}
                      </span>
                    ) : i.closed ? (
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Closed</span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Pending</span>
                    )}
                  </div>
                  {i.address && <p className="mt-1 whitespace-pre-line text-sm text-slate-700">📍 {i.address}</p>}
                  {i.note && <p className="mt-1 text-sm text-slate-600">📝 {i.note}</p>}
                  {!i.closed && (
                    <dl className="num mt-2 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <dt className="text-xs text-slate-500">EMI</dt>
                        <dd className="font-medium">{rs(i.emi)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Arrears</dt>
                        <dd className={`font-semibold ${Number(i.arrears) > 0 ? "text-red-700" : ""}`}>
                          {rs(i.arrears)}
                          {Number(i.overdue_emis) > 0 && <span className="block text-xs font-normal text-slate-500">{i.overdue_emis} overdue</span>}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Balance</dt>
                        <dd className="font-medium">{rs(i.balance)}</dd>
                        {i.next_due && <dd className="text-xs text-slate-500">next due {dmy(i.next_due)}</dd>}
                      </div>
                    </dl>
                  )}
                  {i.seized && <p className="mt-1 text-xs font-semibold text-red-700">Vehicle seized</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!i.closed && day === today && (i.user_id === me || manager) && (
                      <CollectButton row={{ source: i.source, ref_id: i.ref_id, folio: i.folio, borrower_name: i.borrower_name, borrower_mobile: i.mobile }} />
                    )}
                    {i.mobile &&
                      i.mobile
                        .split(", ")
                        .filter((m) => /^\d{10}$/.test(m))
                        .map((m) => (
                          <a key={m} href={`tel:${m}`} className="inline-flex h-11 items-center rounded-lg bg-white px-4 text-sm font-semibold text-blue-700 ring-1 ring-slate-300">
                            📞 {m}
                          </a>
                        ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

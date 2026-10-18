import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { ACTIONS, actionLabel, describe, refHref, type AuditRow } from "@/lib/activity";

export const metadata: Metadata = { title: "Activity · Shree Salasar Sarkar" };

const PAGE_SIZE = 50;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDate = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const nextDay = (d: string) => new Date(Date.parse(d + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);

const TONE: Record<string, string> = {
  payment: "bg-emerald-50 text-emerald-800",
  new_loan: "bg-blue-50 text-blue-800",
  seize: "bg-red-50 text-red-800",
  release: "bg-emerald-50 text-emerald-800",
  payment_edited: "bg-amber-50 text-amber-800",
  loan_edited: "bg-amber-50 text-amber-800",
  payment_cancelled: "bg-red-50 text-red-800",
  loan_deleted: "bg-red-50 text-red-800",
  delete: "bg-red-50 text-red-800",
};

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  await requireAdmin();
  const sp = await searchParams;
  const who = one(sp.who) ?? "";
  const what = ACTIONS.some((a) => a.key === one(sp.what)) ? one(sp.what)! : one(sp.what) === "fixes" ? "fixes" : "";
  const from = isDate(one(sp.from)) ? one(sp.from)! : "";
  const to = isDate(one(sp.to)) ? one(sp.to)! : "";
  const q = (one(sp.q) ?? "").trim().slice(0, 60);
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);

  const supabase = await createClient();
  let query = supabase
    .from("data_audit")
    .select("id, at, by_name, action, subject, ref, details", { count: "exact" })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (/^[0-9a-f-]{36}$/.test(who)) query = query.eq("by_user", who);
  if (what === "fixes") query = query.in("action", ACTIONS.filter((a) => a.group === "Fixes").map((a) => a.key));
  else if (what) query = query.eq("action", what);
  if (from) query = query.gte("at", `${from}T00:00:00+05:30`);
  if (to) query = query.lt("at", `${nextDay(to)}T00:00:00+05:30`);
  if (q) query = query.ilike("subject", `%${escapeLike(q)}%`);

  const [{ data, count, error }, { data: users }] = await Promise.all([query, supabase.rpc("admin_list_users")]);
  if (error) {
    console.error("activity query failed:", error);
    throw new Error("Could not load the activity log.");
  }
  const rows = (data ?? []) as AuditRow[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const people = ((users ?? []) as { user_id: string; full_name: string }[]).map((u) => ({ id: u.user_id, name: u.full_name }));

  const href = (p: number) => {
    const n = new URLSearchParams();
    if (who) n.set("who", who);
    if (what) n.set("what", what);
    if (from) n.set("from", from);
    if (to) n.set("to", to);
    if (q) n.set("q", q);
    if (p > 1) n.set("page", String(p));
    const s = n.toString();
    return s ? `/activity?${s}` : "/activity";
  };

  // group by day (India time)
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
  const groups: { day: string; rows: AuditRow[] }[] = [];
  for (const r of rows) {
    const d = day(r.at);
    if (groups.at(-1)?.day === d) groups.at(-1)!.rows.push(r);
    else groups.push({ day: d, rows: [r] });
  }

  const field = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Activity</h1>
        <p className="text-sm text-slate-500">Everything people did in the app: payments, loans, seizures, fixes, users, settings and data.</p>
      </div>

      <form method="get" className="grid gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Person</span>
          <select name="who" defaultValue={who} className={field}>
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">What</span>
          <select name="what" defaultValue={what} className={field}>
            <option value="">Everything</option>
            <option value="fixes">All fixes (edits, cancels, deletes)</option>
            {ACTIONS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">From</span>
          <input type="date" name="from" defaultValue={from} className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">To</span>
          <input type="date" name="to" defaultValue={to} className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Name / SNO / folio</span>
          <input name="q" defaultValue={q} placeholder="Search" className={field} />
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
          <button type="submit" className="h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800">
            Show
          </button>
          {(who || what || from || to || q) && (
            <Link href="/activity" className="flex h-11 items-center rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              Clear
            </Link>
          )}
          <span className="ml-auto self-center text-sm text-slate-500">
            {total.toLocaleString("en-IN")} entr{total === 1 ? "y" : "ies"}
          </span>
        </div>
      </form>

      {groups.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">Nothing found.</p>
      ) : (
        groups.map((g) => (
          <section key={g.day} className="rounded-xl bg-white ring-1 ring-slate-200">
            <h2 className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.day}</h2>
            <ul className="divide-y divide-slate-100">
              {g.rows.map((r) => {
                const link = refHref(r.ref);
                return (
                  <li key={r.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="num text-xs text-slate-400">{time(r.at)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[r.action] ?? "bg-slate-100 text-slate-700"}`}>
                        {actionLabel(r.action)}
                      </span>
                      {r.subject &&
                        (link ? (
                          <Link href={link} className="font-medium text-blue-700">
                            {r.subject}
                          </Link>
                        ) : (
                          <span className="font-medium">{r.subject}</span>
                        ))}
                      <span className="ml-auto text-xs text-slate-500">by {r.by_name ?? "—"}</span>
                    </div>
                    {describe(r) && <p className="num mt-1 break-words text-slate-600">{describe(r)}</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3 text-sm" aria-label="Pages">
          {page > 1 ? (
            <Link href={href(page - 1)} className="flex h-11 items-center rounded-lg bg-white px-4 font-semibold text-blue-700 ring-1 ring-slate-300">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-slate-500">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={href(page + 1)} className="flex h-11 items-center rounded-lg bg-white px-4 font-semibold text-blue-700 ring-1 ring-slate-300">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}

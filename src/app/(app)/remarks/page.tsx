import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getStaff } from "@/lib/staff";
import { can, homeFor } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { DateInput } from "@/components/date-input";
import { dateTimeIST, dmy } from "@/lib/format";
import { todayIST } from "@/lib/schedule";

export const metadata: Metadata = { title: "Remarks · Shree Salasar Sarkar" };

type Row = {
  id: number; source: "old" | "new"; ref_id: number; subject: string | null; folio: string | null; mobile: string | null;
  installment_no: number | null; remark: string; promise_date: string | null; created_at: string; by_user: string; by_name: string;
  paid_after: boolean; total: number;
};

const PAGE_SIZE = 50;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDate = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const SHOW = [
  ["", "All remarks"],
  ["today", "Will pay today"],
  ["broken", "Promise passed, not paid"],
  ["open", "Not paid yet"],
  ["paid", "Paid after the remark"],
] as const;

export default async function RemarksPage({ searchParams }: PageProps<"/remarks">) {
  const staff = await getStaff();
  if (!staff) notFound();
  if (!can(staff, "collect") && !can(staff, "view_accounts")) redirect(homeFor(staff));
  const seesAll = staff.role === "admin" || can(staff, "assign") || can(staff, "approve");

  const sp = await searchParams;
  const today = todayIST();
  const from = isDate(one(sp.from)) ? one(sp.from)! : "";
  const to = isDate(one(sp.to)) ? one(sp.to)! : "";
  const who = seesAll && /^[0-9a-f-]{36}$/.test(one(sp.who) ?? "") ? one(sp.who)! : "";
  const q = (one(sp.q) ?? "").trim().slice(0, 60);
  const show = SHOW.some(([k]) => k === one(sp.show)) ? one(sp.show)! : "";
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);

  const supabase = await createClient();
  const [{ data, error }, { data: people }] = await Promise.all([
    supabase.rpc("remarks_list", {
      p_from: from || null,
      p_to: to || null,
      p_user: who || null,
      p_q: q || null,
      p_status: show === "today" ? "open" : show || null,
      p_promise: show === "today" ? today : null,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
    seesAll ? supabase.rpc("staff_names", { p_all: true }) : Promise.resolve({ data: null }),
  ]);
  if (error) {
    console.error("remarks_list failed:", error);
    throw new Error("Could not load remarks.");
  }
  const rows = (data ?? []) as Row[];
  const total = Number(rows[0]?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const n = new URLSearchParams();
    if (from) n.set("from", from);
    if (to) n.set("to", to);
    if (who) n.set("who", who);
    if (q) n.set("q", q);
    if (show) n.set("show", show);
    if (p > 1) n.set("page", String(p));
    const s = n.toString();
    return s ? `/remarks?${s}` : "/remarks";
  };
  const field = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm";

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Remarks</h1>
        <p className="text-sm text-slate-500">
          What customers said when they did not pay, and when they promised to pay.
          {!seesAll && " You see the remarks you wrote."}
        </p>
      </div>

      <form method="get" className="grid gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Show</span>
          <select name="show" defaultValue={show} className={field}>
            {SHOW.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {seesAll && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Collection man</span>
            <select name="who" defaultValue={who} className={field}>
              <option value="">Everyone</option>
              {((people ?? []) as { user_id: string; full_name: string }[]).map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Visited from</span>
          <DateInput name="from" defaultValue={from} className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Visited to</span>
          <DateInput name="to" defaultValue={to} className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Name / mobile / folio</span>
          <input name="q" defaultValue={q} placeholder="Search" className={field} />
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
          <button type="submit" className="h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800">
            Show
          </button>
          {(from || to || who || q || show) && (
            <Link href="/remarks" className="flex h-11 items-center rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              Clear
            </Link>
          )}
          <span className="ml-auto self-center text-sm text-slate-500">
            {total} remark{total === 1 ? "" : "s"}
          </span>
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">Nothing found.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
          {rows.map((r) => {
            const broken = !r.paid_after && r.promise_date != null && r.promise_date < today;
            const dueToday = !r.paid_after && r.promise_date === today;
            return (
              <li key={r.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <Link href={r.source === "old" ? `/accounts/${r.ref_id}` : `/loans/${r.ref_id}`} className="font-semibold text-blue-700">
                      {r.subject ?? `${r.source} ${r.ref_id}`}
                    </Link>
                    <p className="num text-xs text-slate-500">
                      Folio {r.folio ?? "—"}
                      {r.mobile && (
                        <>
                          {" · "}
                          <a href={`tel:${r.mobile.split(",")[0].trim()}`} className="text-blue-700">
                            {r.mobile}
                          </a>
                        </>
                      )}
                      {r.installment_no && <> · EMI #{r.installment_no}</>}
                    </p>
                  </div>
                  {r.paid_after ? (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">✓ Paid after</span>
                  ) : broken ? (
                    <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-800">Promise passed</span>
                  ) : dueToday ? (
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Will pay today</span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Not paid yet</span>
                  )}
                </div>
                <p className="mt-1 text-slate-800">“{r.remark}”</p>
                <p className="num mt-0.5 text-xs text-slate-500">
                  {r.by_name} · {dateTimeIST(r.created_at)}
                  {r.promise_date && (
                    <>
                      {" · "}will pay <b className={broken ? "text-red-700" : "text-slate-700"}>{dmy(r.promise_date)}</b>
                    </>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
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

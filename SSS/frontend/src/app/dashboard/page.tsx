import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/lib/use-api";
import { useStaff } from "@/lib/auth";
import Loading from "../loading";
import { can } from "@/lib/permissions";
import { dmy, inr, monthYear, weekday } from "@/lib/format";
import { todayIST } from "@/lib/schedule";

type Dash = {
  day: string;
  today: { amount: number; count: number };
  today_modes: Record<string, number>;
  yesterday: number;
  month: { amount: number; count: number };
  last_month_same_days: number;
  months: { month: string; collected: number; lent: number }[];
  new_loans_month: { count: number; amount: number };
  outstanding: { balance: number; accounts: number; arrears: number; overdue_accounts: number; overdue_3: number };
  due_today: { count: number; amount: number };
  due_week: { count: number; amount: number };
  seized: { count: number; balance: number };
  top_overdue: { source: "old" | "new"; ref_id: number; folio: string; borrower_name: string; mobile: string | null; arrears: number; overdue_emis: number; balance: number }[];
  pending_approvals: number;
  cash_open: number;
};
type Perf = {
  user_id: string; full_name: string; active: boolean; receipts: number; collected: number; cash: number; loans: number; lent: number;
  seized: number; released: number; cash_expected: number; cash_received: number; cash_short: number; days_open: number;
  late_fees: number; fixes: number; last_receipt: string | null;
};

const rs = (v: number | null | undefined) => inr(String(v ?? 0));
/** ₹45.2L / ₹3.1Cr for big numbers on cards */
function short(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return rs(v);
}
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** "2026-10" -> "10/2026" (long) or "10/26" (chart label) */
const monthName = (ym: string, long = false) => (long ? monthYear(ym) : `${ym.slice(5, 7)}/${ym.slice(2, 4)}`);

export default function DashboardPage() {
  const staff = useStaff();
  const showStaff = can(staff, "cash");
  const sp = Object.fromEntries(useSearchParams()) as Record<string, string | undefined>;
  const today = todayIST();
  const ym = /^\d{4}-\d{2}$/.test(one(sp.month) ?? "") && one(sp.month)! <= today.slice(0, 7) ? one(sp.month)! : today.slice(0, 7);
  const from = `${ym}-01`;
  const lastDay = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const to = lastDay < today ? lastDay : today;

  const dash = useApi<Dash>("/dashboard");
  const perf = useApi<Perf[]>(showStaff ? `/staff-performance?${new URLSearchParams({ from, to })}` : null, { keep: true });
  if (dash.isPending) return <Loading />;
  if (dash.error) throw dash.error;
  const data = dash.data;
  const d = data as Dash;
  const people = (perf.data ?? []) as Perf[];
  const vsMonth = d.last_month_same_days > 0 ? Math.round(((d.month.amount - d.last_month_same_days) / d.last_month_same_days) * 100) : null;
  const max = Math.max(1, ...d.months.map((m) => Math.max(m.collected, m.lent)));
  const prevMonth = (() => {
    const [y, m] = ym.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();
  const nextMonth = (() => {
    const [y, m] = ym.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  })();

  return (
    <div className="space-y-4">
      <title>Dashboard · Shree Salasar Sarkar</title>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-slate-500">
            {weekday(today)}, {dmy(today)} ·
            old software + this app
          </p>
        </div>
      </div>

      {(d.pending_approvals > 0 || d.cash_open > 0) && (
        <div className="flex flex-wrap gap-2">
          {d.pending_approvals > 0 && can(staff, "approve") && (
            <Link href="/approvals" className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 ring-1 ring-amber-200">
              ⚠ {d.pending_approvals} payment{d.pending_approvals > 1 ? "s" : ""} waiting for approval →
            </Link>
          )}
          {d.cash_open > 0 && can(staff, "cash") && (
            <Link href="/cash" className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 ring-1 ring-amber-200">
              💵 {d.cash_open} person{d.cash_open > 1 ? "s have" : " has"} cash not handed in (last 7 days) →
            </Link>
          )}
        </div>
      )}

      <div className="num grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label="Collected today"
          value={short(d.today.amount)}
          sub={`${d.today.count} receipts · yesterday ${short(d.yesterday)}`}
          tone="green"
          href={`/reports/day-book?from=${today}&to=${today}`}
        />
        <Card
          label={`This month (${monthName(today.slice(0, 7))})`}
          value={short(d.month.amount)}
          sub={vsMonth == null ? `${d.month.count} receipts` : `${vsMonth >= 0 ? "▲" : "▼"} ${Math.abs(vsMonth)}% vs same days last month`}
          tone={vsMonth != null && vsMonth < 0 ? "red" : "green"}
        />
        <Card label="Outstanding" value={short(d.outstanding.balance)} sub={`${d.outstanding.accounts} pending accounts`} href="/reports/finance-details" />
        <Card
          label="Arrears (overdue)"
          value={short(d.outstanding.arrears)}
          sub={`${d.outstanding.overdue_accounts} accounts · ${d.outstanding.overdue_3} with 3+ EMIs`}
          tone="red"
          href="/reports/due-installments"
        />
        <Card label="Due today" value={short(d.due_today.amount)} sub={`${d.due_today.count} EMIs · this week ${d.due_week.count} (${short(d.due_week.amount)})`} href="/reports/due-installments" />
        <Card label="Seized vehicles" value={String(d.seized.count)} sub={`balance ${short(d.seized.balance)}`} href="/reports/seized" />
        <Card label="New loans this month" value={String(d.new_loans_month.count)} sub={`${short(d.new_loans_month.amount)} given`} />
        <Card
          label="Today by mode"
          value={Object.keys(d.today_modes).length ? "" : "—"}
          sub={Object.entries(d.today_modes).map(([m, v]) => `${m} ${short(v)}`).join(" · ") || "no receipts yet"}
        />
      </div>

      {/* 12 months: collected vs. lent */}
      <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Last 12 months</h2>
          <span className="flex gap-3 text-xs text-slate-600">
            <span className="flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600" /> Collected
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-500" /> Loans given
            </span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <div className="flex h-48 min-w-[640px] items-end gap-2">
            {d.months.map((m) => (
              <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <div className="flex h-full w-full items-end justify-center gap-0.5">
                  <div
                    className="w-1/2 rounded-t bg-emerald-600"
                    style={{ height: `${(m.collected / max) * 100}%` }}
                    title={`${monthName(m.month, true)}: collected ${rs(m.collected)}`}
                  />
                  <div className="w-1/2 rounded-t bg-blue-500" style={{ height: `${(m.lent / max) * 100}%` }} title={`${monthName(m.month, true)}: lent ${rs(m.lent)}`} />
                </div>
                <span className="text-[10px] text-slate-500">{monthName(m.month)}</span>
                <span className="num text-[10px] font-medium text-emerald-700">{short(m.collected).replace("₹", "")}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* biggest arrears */}
      <section className="rounded-xl bg-white ring-1 ring-slate-200">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Biggest arrears (not seized)</h2>
        {d.top_overdue.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No arrears. ✓</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {d.top_overdue.map((r) => (
              <li key={`${r.source}${r.ref_id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <Link href={r.source === "old" ? `/accounts/${r.ref_id}` : `/loans/${r.ref_id}`} className="min-w-0 flex-1 font-medium text-blue-700">
                  {r.borrower_name} <span className="text-xs font-normal text-slate-500">· {r.folio}</span>
                </Link>
                <span className="num font-semibold text-red-700">{rs(r.arrears)}</span>
                <span className="text-xs text-slate-500">{r.overdue_emis} EMIs overdue</span>
                {r.mobile && /^\d{10}/.test(r.mobile) && (
                  <a href={`tel:${r.mobile.slice(0, 10)}`} className="rounded-lg px-2 py-1 text-xs font-semibold text-blue-700 ring-1 ring-slate-300">
                    Call
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {showStaff && (
        <section className="rounded-xl bg-white ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Staff performance · {monthName(ym, true)}</h2>
            <nav className="flex items-center gap-2 text-sm" aria-label="Month">
              <Link href={`/dashboard?month=${prevMonth}`} className="rounded-lg px-3 py-1.5 font-semibold text-blue-700 ring-1 ring-slate-300">
                ←
              </Link>
              {ym < today.slice(0, 7) && (
                <Link href={`/dashboard?month=${nextMonth}`} className="rounded-lg px-3 py-1.5 font-semibold text-blue-700 ring-1 ring-slate-300">
                  →
                </Link>
              )}
            </nav>
          </div>
          <p className="px-4 pt-3 text-xs text-slate-500">Work done in this app (old-software receipts have no person). Money by the day it was entered.</p>
          {people.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No one did anything this month.</p>
          ) : (
            <div className="overflow-x-auto p-2">
              <table className="num w-full min-w-[760px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-2">Person</th>
                    <th className="px-2 py-2 text-right">Receipts</th>
                    <th className="px-2 py-2 text-right">Collected</th>
                    <th className="px-2 py-2 text-right">Cash short</th>
                    <th className="px-2 py-2 text-right">Days not handed in</th>
                    <th className="px-2 py-2 text-right">New loans</th>
                    <th className="px-2 py-2 text-right">Seized / released</th>
                    <th className="px-2 py-2 text-right">Late fees</th>
                    <th className="px-2 py-2 text-right">Fixes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {people.map((p) => (
                    <tr key={p.user_id} className={p.active ? "" : "opacity-60"}>
                      <td className="px-2 py-2 font-medium">{p.full_name}</td>
                      <td className="px-2 py-2 text-right">{p.receipts}</td>
                      <td className="px-2 py-2 text-right font-semibold text-emerald-700">{rs(p.collected)}</td>
                      <td className={`px-2 py-2 text-right ${p.cash_short > 0 ? "font-semibold text-red-700" : ""}`}>
                        {p.cash_short > 0 ? rs(p.cash_short) : p.cash_short < 0 ? `+${rs(-p.cash_short)}` : "—"}
                      </td>
                      <td className={`px-2 py-2 text-right ${p.days_open > 0 ? "text-amber-700" : ""}`}>{p.days_open || "—"}</td>
                      <td className="px-2 py-2 text-right">
                        {p.loans}
                        {p.loans > 0 && <span className="block text-xs text-slate-500">{short(p.lent)}</span>}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {p.seized} / {p.released}
                      </td>
                      <td className="px-2 py-2 text-right">{p.late_fees ? rs(p.late_fees) : "—"}</td>
                      <td className="px-2 py-2 text-right">{p.fixes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Card({ label, value, sub, tone = "plain", href }: { label: string; value: string; sub?: string; tone?: "plain" | "green" | "red"; href?: string }) {
  const color = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "text-slate-900";
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      {value && <p className={`mt-0.5 text-xl font-bold sm:text-2xl ${color}`}>{value}</p>}
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-xl bg-white p-3 ring-1 ring-slate-200 hover:bg-slate-50 sm:p-4">
      {body}
    </Link>
  ) : (
    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 sm:p-4">{body}</div>
  );
}

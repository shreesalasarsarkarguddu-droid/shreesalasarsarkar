import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getStaff } from "@/lib/staff";
import { can, homeFor } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/format";
import { addMonths, todayIST } from "@/lib/schedule";
import { ReceiveCash } from "./receive-cash";

export const metadata: Metadata = { title: "Daily cash · Shree Salasar Sarkar" };

type Row = {
  user_id: string; full_name: string; receipts: number; cash: number; cheque: number; sbi: number; bank: number; total: number;
  closed: boolean; received_amount: number | null; expected_at_close: number | null; note: string | null; received_by: string | null; received_at: string | null;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const shift = (d: string, days: number) => new Date(Date.parse(d + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
const n = (v: number | null | undefined) => inr(String(v ?? 0));

export default async function CashPage({ searchParams }: PageProps<"/cash">) {
  const staff = await getStaff();
  if (!staff) notFound();
  if (!can(staff, "cash") && !can(staff, "collect")) redirect(homeFor(staff));
  const manager = can(staff, "cash");
  const sp = await searchParams;
  const today = todayIST();
  const raw = one(sp.day);
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= today && raw >= addMonths(today, -24) ? raw : today;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cash_day", { p_day: day });
  if (error) {
    console.error("cash_day failed:", error);
    throw new Error("Could not load the day's cash.");
  }
  const rows = (data ?? []) as Row[];
  const tot = rows.reduce(
    (t, r) => ({ cash: t.cash + Number(r.cash), other: t.other + Number(r.total) - Number(r.cash), received: t.received + Number(r.received_amount ?? 0) }),
    { cash: 0, other: 0, received: 0 },
  );
  const dayLabel = new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Daily cash</h1>
          <p className="text-sm text-slate-500">
            {manager
              ? "What each person collected (by the day they entered it) and the cash they handed in."
              : "What you collected today and whether the office has received your cash."}
          </p>
        </div>
        <nav className="flex items-center gap-2" aria-label="Day">
          <Link href={`/cash?day=${shift(day, -1)}`} className="flex h-10 items-center rounded-lg bg-white px-3 text-sm font-semibold ring-1 ring-slate-300">
            ←
          </Link>
          <form method="get">
            <input type="date" name="day" defaultValue={day} max={today} className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm" />
            <button className="ml-1 h-10 rounded-lg bg-blue-700 px-3 text-sm font-semibold text-white">Go</button>
          </form>
          {day < today && (
            <Link href={`/cash?day=${shift(day, 1)}`} className="flex h-10 items-center rounded-lg bg-white px-3 text-sm font-semibold ring-1 ring-slate-300">
              →
            </Link>
          )}
        </nav>
      </div>

      <p className="text-sm font-semibold text-slate-700">{dayLabel}</p>

      {manager && rows.length > 0 && (
        <dl className="num grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
            <dt className="text-xs text-slate-500">Cash collected</dt>
            <dd className="text-lg font-bold">{n(tot.cash)}</dd>
          </div>
          <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
            <dt className="text-xs text-slate-500">Cash received</dt>
            <dd className={`text-lg font-bold ${tot.received < tot.cash ? "text-red-700" : "text-emerald-700"}`}>{n(tot.received)}</dd>
          </div>
          <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
            <dt className="text-xs text-slate-500">Cheque / bank</dt>
            <dd className="text-lg font-bold">{n(tot.other)}</dd>
          </div>
        </dl>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">No payments were entered on this day.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const short = r.closed ? Number(r.cash) - Number(r.received_amount ?? 0) : null;
            const changed = r.closed && Number(r.expected_at_close) !== Number(r.cash);
            return (
              <li key={r.user_id} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="font-semibold">{r.full_name}</p>
                  <span className="text-sm text-slate-500">{r.receipts} receipt{r.receipts === 1 ? "" : "s"}</span>
                  <span
                    className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      !r.closed ? "bg-amber-50 text-amber-800" : short! > 0 ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    {!r.closed ? "Cash not received yet" : short! > 0 ? `Short ${n(short)}` : short! < 0 ? `Extra ${n(-short!)}` : "Cash received ✓"}
                  </span>
                </div>
                <dl className="num mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
                  <Cell label="Cash" value={n(r.cash)} strong />
                  <Cell label="Cheque" value={n(r.cheque)} />
                  <Cell label="SBI" value={n(r.sbi)} />
                  <Cell label="Bank" value={n(r.bank)} />
                  <Cell label="Total" value={n(r.total)} />
                </dl>
                {r.closed && (
                  <p className="mt-2 text-xs text-slate-500">
                    Received {n(r.received_amount)} by {r.received_by ?? "—"}
                    {r.received_at &&
                      ` on ${new Date(r.received_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}`}
                    {r.note && ` · ${r.note}`}
                    {changed && (
                      <span className="mt-1 block font-semibold text-amber-700">
                        ⚠ Payments changed after the cash was received (was {n(r.expected_at_close)}). Receive again to update.
                      </span>
                    )}
                  </p>
                )}
                {manager && <ReceiveCash userId={r.user_id} day={day} cash={String(r.cash)} again={r.closed} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Cell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={strong ? "font-bold" : "font-medium"}>{value}</dd>
    </div>
  );
}

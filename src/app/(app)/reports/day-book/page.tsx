import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { dmy } from "@/lib/format";
import { todayIST } from "@/lib/schedule";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Day Book · Shree Salasar Sarkar" };

const MAX_DAYS = 93; // keeps the page fast; pick a shorter period for more detail
const CHUNK = 1000; // Supabase returns at most 1000 rows per request

type Entry = {
  entry_date: string;
  kind: "receipt" | "loan";
  particulars: string;
  folio: string | null;
  due_amount: string | null;
  due_date: string | null;
  delay_days: number | null;
  im: number | null;
  mode: string | null;
  receipt_no: number | null;
  debit: string;
  credit: string;
  source: "old" | "new";
  ref_id: number;
};

// ---- exact money (paise as bigint)
function toPaise(v: string | number | null | undefined): bigint {
  if (v == null || v === "") return 0n;
  const s = String(v);
  const neg = s.startsWith("-");
  const [i, f = ""] = s.replace("-", "").split(".");
  const p = BigInt(i || "0") * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -p : p;
}
/** Indian grouping with 2 decimals: 4,50,01,884.01 */
function amt(p: bigint): string {
  const neg = p < 0n;
  const a = neg ? -p : p;
  const rupees = (a / 100n).toString();
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${neg ? "-" : ""}${grouped}.${(a % 100n).toString().padStart(2, "0")}`;
}
const drcr = (p: bigint) => (p < 0n ? `${amt(-p)} Cr` : `${amt(p)} Dr`);

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}
const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export default async function DayBookPage({ searchParams }: PageProps<"/reports/day-book">) {
  const sp = await searchParams;
  const today = todayIST();
  const from = isDate(one(sp.from)) ? one(sp.from)! : today;
  const to = isDate(one(sp.to)) ? one(sp.to)! : from;
  const narration = one(sp.narration) !== "no";

  let problem: string | null = null;
  if (to < from) problem = "“To” date must be on or after “From” date.";
  else if (daysBetween(from, to) > MAX_DAYS) problem = `Choose a period of ${MAX_DAYS} days or less.`;

  let entries: Entry[] = [];
  let openDr = 0n;
  let openCr = 0n;
  if (!problem) {
    const supabase = await createClient();
    const fetchAll = async () => {
      const out: Entry[] = [];
      for (let start = 0; ; start += CHUNK) {
        const { data, error } = await supabase
          .from("day_book_entries")
          .select("entry_date, kind, particulars, folio, due_date, delay_days, im, mode, receipt_no, source, ref_id, due_amount::text, debit::text, credit::text")
          .gte("entry_date", from)
          .lte("entry_date", to)
          .order("entry_date")
          .order("kind_order")
          .order("particulars")
          .order("ref_id")
          .range(start, start + CHUNK - 1);
        if (error) throw error;
        out.push(...((data ?? []) as unknown as Entry[]));
        if (!data || data.length < CHUNK) return out;
      }
    };
    const [rows, opening] = await Promise.all([fetchAll(), supabase.rpc("day_book_opening", { p_from: from }).single()]);
    if (opening.error) {
      console.error("day book opening failed:", opening.error);
      throw new Error("Could not load the day book.");
    }
    entries = rows;
    const o = opening.data as { debit: number | string; credit: number | string };
    openDr = toPaise(o.debit);
    openCr = toPaise(o.credit);
  }

  // group by day
  const days = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = days.get(e.entry_date);
    if (list) list.push(e);
    else days.set(e.entry_date, [e]);
  }
  let running = openDr - openCr;
  let periodDr = 0n;
  let periodCr = 0n;

  const cell = "px-3 py-2 align-top";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <Link href="/reports" className="text-sm font-medium text-blue-700">
            ← Reports
          </Link>
          <h1 className="text-xl font-bold">Day Book</h1>
        </div>
      </div>

      {/* filters (plain GET form: works without JavaScript, shareable URL) */}
      <form className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200 print:hidden" action="/reports/day-book">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">From</span>
          <input type="date" name="from" defaultValue={from} max={today} required className="h-11 rounded-lg border border-slate-300 px-3" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">To</span>
          <input type="date" name="to" defaultValue={to} required className="h-11 rounded-lg border border-slate-300 px-3" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Narration</span>
          <select name="narration" defaultValue={narration ? "yes" : "no"} className="h-11 rounded-lg border border-slate-300 bg-white px-3">
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <button className="h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800">Show</button>
        <PrintButton />
      </form>

      <div className="hidden print:block">
        <p className="text-lg font-bold">Shree Salasar Sarkar — Day Book</p>
        <p className="text-sm">
          {dmy(from)} to {dmy(to)}
        </p>
      </div>

      {problem ? (
        <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
          {problem}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200 print:overflow-visible print:ring-0">
          <table className="num w-full min-w-[720px] text-sm">
            <thead className="bg-emerald-50 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Particulars</th>
                <th className="px-3 py-2.5">Mode</th>
                <th className="px-3 py-2.5 text-right">Debit</th>
                <th className="px-3 py-2.5 text-right">Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50 font-semibold">
                <td className={cell} />
                <td className={cell}>
                  Opening balance
                  <span className="block text-xs font-normal text-slate-500">
                    Received before {dmy(from)}: {amt(openDr)} · Loans given before: {amt(openCr)}
                  </span>
                </td>
                <td className={cell} />
                <td className={`${cell} text-right`}>{amt(openDr)}</td>
                <td className={`${cell} text-right`}>{amt(openCr)}</td>
              </tr>

              {days.size === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                    No transactions in this period.
                  </td>
                </tr>
              )}

              {[...days.entries()].map(([day, list]) => {
                let dayDr = 0n;
                let dayCr = 0n;
                const rows = list.map((e, i) => {
                  const dr = toPaise(e.debit);
                  const cr = toPaise(e.credit);
                  dayDr += dr;
                  dayCr += cr;
                  const href = e.source === "new" && e.kind === "loan" ? `/loans/${e.ref_id}` : e.source === "new" ? null : `/accounts/${e.ref_id}`;
                  return (
                    <tr key={`${day}-${i}`} className="break-inside-avoid">
                      <td className={`${cell} whitespace-nowrap text-slate-600`}>{dmy(day)}</td>
                      <td className={cell}>
                        {href ? (
                          <Link href={href} className="font-semibold hover:underline print:no-underline">
                            {e.particulars}
                          </Link>
                        ) : (
                          <span className="font-semibold">{e.particulars}</span>
                        )}
                        {e.folio && <span className="ml-1.5 text-xs text-slate-500">F-{e.folio}</span>}
                        {narration && (
                          <span className="block text-xs italic text-slate-500">
                            {e.kind === "receipt"
                              ? [
                                  e.due_amount && `Instalment @ ${amt(toPaise(e.due_amount))}`,
                                  e.due_date && `Due ${dmy(e.due_date)}`,
                                  e.im != null && `IM ${e.im}`,
                                  e.delay_days != null && `Late days ${e.delay_days}`,
                                  e.receipt_no != null && `Rcpt ${e.receipt_no}`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")
                              : "Loan given (finance amount)"}
                          </span>
                        )}
                      </td>
                      <td className={`${cell} whitespace-nowrap`}>{e.kind === "receipt" ? `Instalment · ${e.mode ?? ""}` : `Loan · ${e.mode ?? ""}`}</td>
                      <td className={`${cell} text-right`}>{dr ? amt(dr) : "—"}</td>
                      <td className={`${cell} text-right`}>{cr ? amt(cr) : "—"}</td>
                    </tr>
                  );
                });
                running += dayDr - dayCr;
                periodDr += dayDr;
                periodCr += dayCr;
                return [
                  ...rows,
                  <tr key={`${day}-total`} className="break-inside-avoid border-t border-slate-300 bg-emerald-50/60 font-semibold">
                    <td className={cell} />
                    <td className={cell} colSpan={2}>
                      Total for {dmy(day)} ({list.length})
                      <span className="block text-xs font-normal text-slate-600">Closing balance {drcr(running)}</span>
                    </td>
                    <td className={`${cell} text-right`}>{amt(dayDr)}</td>
                    <td className={`${cell} text-right`}>{amt(dayCr)}</td>
                  </tr>,
                ];
              })}
            </tbody>
            <tfoot className="border-t-2 border-slate-400 font-bold">
              <tr>
                <td className={cell} />
                <td className={cell} colSpan={2}>
                  Period total ({entries.length} entries)
                </td>
                <td className={`${cell} text-right`}>{amt(periodDr)}</td>
                <td className={`${cell} text-right`}>{amt(periodCr)}</td>
              </tr>
              <tr className="bg-slate-50">
                <td className={cell} />
                <td className={cell} colSpan={2}>
                  Grand total (opening + period)
                  <span className="block text-xs font-normal text-slate-600">Closing balance {drcr(openDr - openCr + periodDr - periodCr)}</span>
                </td>
                <td className={`${cell} text-right`}>{amt(openDr + periodDr)}</td>
                <td className={`${cell} text-right`}>{amt(openCr + periodCr)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

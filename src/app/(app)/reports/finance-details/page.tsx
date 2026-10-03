import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { dmy, inr, isPositive } from "@/lib/format";
import { fromPaise, toPaise, todayIST } from "@/lib/schedule";
import { PrintButton } from "../day-book/print-button";

export const metadata: Metadata = { title: "Finance Details · Shree Salasar Sarkar" };

const PAGE_SIZE = 100;
const COLS =
  "source, ref_id, folio, borrower_name, vehicle_model, mobile, vehicle_no, seized, search_text, due_emis, agreement_date, tenure, last_paid, late_days," +
  " emi::text, balance::text, arrears::text, finance_amount::text, interest_amount::text, other_charges::text, total_amount::text, total_paid::text";

type Row = {
  source: "old" | "new";
  ref_id: number;
  folio: string;
  borrower_name: string;
  vehicle_model: string | null;
  mobile: string | null;
  vehicle_no: string | null;
  seized: boolean;
  search_text: string;
  due_emis: number | string;
  agreement_date: string | null;
  tenure: number | null;
  last_paid: string | null;
  late_days: number;
  emi: string;
  balance: string;
  arrears: string;
  finance_amount: string;
  interest_amount: string;
  other_charges: string;
  total_amount: string;
  total_paid: string;
};

const SORTS = [
  { key: "name", label: "Name (A–Z)" },
  { key: "agreement", label: "Agreement date (newest)" },
  { key: "balance", label: "Highest balance" },
  { key: "arrears", label: "Highest arrears" },
  { key: "late", label: "Most late days" },
] as const;

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}
const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const cmpMoney = (a: string, b: string) => (toPaise(a) > toPaise(b) ? 1 : toPaise(a) < toPaise(b) ? -1 : 0);

/** One row per pending account from public.due_report (same maths as the account pages). */
async function loadRows(asOf: string): Promise<Row[]> {
  const supabase = await createClient();
  const fetchRange = async (start: number) => {
    const { data, error } = await supabase.rpc("due_report", { p_asof: asOf }).select(COLS).range(start, start + 999);
    if (error) {
      console.error("finance details failed:", error);
      throw new Error("Could not load the report.");
    }
    return (data ?? []) as unknown as Row[];
  };
  const blocks = await Promise.all([fetchRange(0), fetchRange(1000)]);
  for (let start = 2000; blocks[blocks.length - 1].length === 1000; start += 1000) blocks.push(await fetchRange(start));
  return blocks.flat();
}

export default async function FinanceDetailsPage({ searchParams }: PageProps<"/reports/finance-details">) {
  const sp = await searchParams;
  const today = todayIST();
  const asOf = isDate(one(sp.upto)) ? one(sp.upto)! : today;
  const q = (one(sp.q) ?? "").trim().toLowerCase().slice(0, 60);
  const model = (one(sp.model) ?? "").trim();
  const type = ["old", "new"].includes(one(sp.type) ?? "") ? one(sp.type)! : "all";
  const seized = ["exclude", "only"].includes(one(sp.seized) ?? "") ? one(sp.seized)! : "include";
  const agrFrom = isDate(one(sp.afrom)) ? one(sp.afrom)! : "";
  const agrTo = isDate(one(sp.ato)) ? one(sp.ato)! : "";
  const mFrom = Number.parseInt(one(sp.mfrom) ?? "", 10);
  const mTo = Number.parseInt(one(sp.mto) ?? "", 10);
  const minDue = Math.max(0, Number.parseFloat(one(sp.min) ?? "0") || 0);
  const sort = SORTS.some((s) => s.key === one(sp.sort)) ? one(sp.sort)! : "name";
  const showAll = one(sp.all) === "1";
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);

  const all = await loadRows(asOf);
  const models = [...new Set(all.map((r) => r.vehicle_model).filter(Boolean) as string[])].sort();

  const rows = all
    .filter(
      (r) =>
        (type === "all" || r.source === type) &&
        (seized === "include" || (seized === "only" ? r.seized : !r.seized)) &&
        (!model || r.vehicle_model === model) &&
        (!agrFrom || (r.agreement_date != null && r.agreement_date >= agrFrom)) &&
        (!agrTo || (r.agreement_date != null && r.agreement_date <= agrTo)) &&
        (Number.isNaN(mFrom) || (r.tenure ?? 0) >= mFrom) &&
        (Number.isNaN(mTo) || (r.tenure ?? 0) <= mTo) &&
        Number(r.due_emis) >= minDue &&
        (!q || r.search_text.includes(q) || r.borrower_name.toLowerCase().includes(q)),
    )
    .sort(
      sort === "agreement"
        ? (a, b) => (b.agreement_date ?? "").localeCompare(a.agreement_date ?? "")
        : sort === "balance"
          ? (a, b) => cmpMoney(b.balance, a.balance)
          : sort === "arrears"
            ? (a, b) => cmpMoney(b.arrears, a.arrears)
            : sort === "late"
              ? (a, b) => b.late_days - a.late_days
              : (a, b) => a.borrower_name.localeCompare(b.borrower_name),
    );

  const sum = (k: "finance_amount" | "interest_amount" | "other_charges" | "total_amount" | "total_paid" | "arrears" | "balance") =>
    fromPaise(rows.reduce((t, r) => t + toPaise(r[k]), 0n));
  const totals = {
    finance: sum("finance_amount"),
    interest: sum("interest_amount"),
    other: sum("other_charges"),
    total: sum("total_amount"),
    paid: sum("total_paid"),
    arrears: sum("arrears"),
    balance: sum("balance"),
  };
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = showAll ? rows : rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const link = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "page" && k !== "all") p.set(k, v);
    for (const [k, v] of Object.entries(changes)) if (v != null) p.set(k, v);
    return `/reports/finance-details?${p}`;
  };
  const href = (r: Row) => (r.source === "new" ? `/loans/${r.ref_id}` : `/accounts/${r.ref_id}`);
  const input = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm";
  const td = "whitespace-nowrap px-2.5 py-2";

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <Link href="/reports" className="text-sm font-medium text-blue-700">
          ← Reports
        </Link>
        <h1 className="text-xl font-bold">Finance Details</h1>
        <p className="text-sm text-slate-500">Every pending account: loan amounts, received, arrears and balance as of the chosen date</p>
      </div>

      <form action="/reports/finance-details" className="grid grid-cols-2 gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:grid-cols-4 lg:grid-cols-6 print:hidden">
        <label className="col-span-2 block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Search</span>
          <input name="q" defaultValue={q} placeholder="Name, folio, mobile, vehicle…" className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">As of date</span>
          <input type="date" name="upto" defaultValue={asOf} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Model</span>
          <select name="model" defaultValue={model} className={input}>
            <option value="">All models</option>
            {models.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Agreement from</span>
          <input type="date" name="afrom" defaultValue={agrFrom} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Agreement to</span>
          <input type="date" name="ato" defaultValue={agrTo} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Months from</span>
          <input name="mfrom" inputMode="numeric" defaultValue={Number.isNaN(mFrom) ? "" : String(mFrom)} placeholder="1" className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Months to</span>
          <input name="mto" inputMode="numeric" defaultValue={Number.isNaN(mTo) ? "" : String(mTo)} placeholder="60" className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Old / New</span>
          <select name="type" defaultValue={type} className={input}>
            <option value="all">Old + New</option>
            <option value="old">Old</option>
            <option value="new">New</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Seized</span>
          <select name="seized" defaultValue={seized} className={input}>
            <option value="include">Include</option>
            <option value="exclude">Exclude</option>
            <option value="only">Only seized</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Due EMIs at least</span>
          <input name="min" inputMode="decimal" defaultValue={minDue ? String(minDue) : ""} placeholder="0" className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Sort</span>
          <select name="sort" defaultValue={sort} className={input}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="col-span-2 flex items-end gap-2 sm:col-span-4 lg:col-span-6">
          <button className="h-11 rounded-lg bg-blue-700 px-6 text-sm font-semibold text-white hover:bg-blue-800">Show</button>
          <Link href="/reports/finance-details" className="flex h-11 items-center rounded-lg px-3 text-sm font-medium text-slate-600 ring-1 ring-slate-300">
            Reset
          </Link>
          <PrintButton />
        </div>
      </form>

      <div className="hidden print:block">
        <p className="text-lg font-bold">Shree Salasar Sarkar — Finance Details</p>
        <p className="text-sm">As of {dmy(asOf)}</p>
      </div>

      <dl className="num grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Accounts" value={rows.length.toLocaleString("en-IN")} />
        <Stat label="Total payable" value={inr(totals.total)} />
        <Stat label="Received" value={inr(totals.paid)} green />
        <Stat label="Arrears" value={inr(totals.arrears)} red />
        <Stat label="Balance" value={inr(totals.balance)} />
      </dl>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="font-medium">No accounts for these filters</p>
        </div>
      ) : (
        <>
          {/* phone: cards */}
          {!showAll && (
            <ul className="space-y-2 md:hidden print:hidden">
              {shown.map((r) => (
                <li key={`${r.source}-${r.ref_id}`} className={`rounded-xl bg-white p-3 ring-1 ${r.seized ? "ring-red-300" : "ring-slate-200"}`}>
                  <Link href={href(r)} className="block">
                    <span className={`block truncate font-semibold ${r.seized ? "text-red-700" : ""}`}>{r.borrower_name}</span>
                    <span className="block text-xs text-slate-500">
                      Folio {r.folio}
                      {r.vehicle_model && <> · {r.vehicle_model}</>} · {dmy(r.agreement_date)} · {r.tenure ?? "—"} months
                    </span>
                  </Link>
                  <dl className="num mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-slate-500">Total</dt>
                      <dd className="font-semibold">{inr(r.total_amount)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Received</dt>
                      <dd className="font-semibold text-emerald-700">{inr(r.total_paid)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Balance</dt>
                      <dd className="font-semibold">{inr(r.balance)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Arrears</dt>
                      <dd className="font-semibold text-red-700">{inr(r.arrears)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Last paid</dt>
                      <dd className="font-semibold">{dmy(r.last_paid)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Late days</dt>
                      <dd className={`font-semibold ${r.late_days > 0 ? "text-red-700" : ""}`}>{r.late_days}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}

          {/* tablet / desktop / print */}
          <div className={`overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200 print:block print:overflow-visible print:ring-0 ${showAll ? "" : "hidden md:block"}`}>
            <table className="num w-full text-[13px] print:text-[10px]">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-2.5 py-2.5">Folio</th>
                  <th className="px-2.5 py-2.5">Borrower</th>
                  <th className="px-2.5 py-2.5">Model</th>
                  <th className="px-2.5 py-2.5">Agreement</th>
                  <th className="px-2.5 py-2.5 text-right">Months</th>
                  <th className="px-2.5 py-2.5 text-right">Finance</th>
                  <th className="px-2.5 py-2.5 text-right">Interest</th>
                  <th className="px-2.5 py-2.5 text-right">Other</th>
                  <th className="px-2.5 py-2.5 text-right">Total</th>
                  <th className="px-2.5 py-2.5 text-right">EMI</th>
                  <th className="px-2.5 py-2.5 text-right">Received</th>
                  <th className="px-2.5 py-2.5">Last paid</th>
                  <th className="px-2.5 py-2.5 text-right">Arrears</th>
                  <th className="px-2.5 py-2.5 text-right">Balance</th>
                  <th className="px-2.5 py-2.5 text-right">Late days</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={`${r.source}-${r.ref_id}`} className={`break-inside-avoid ${r.seized ? "bg-red-50/60 text-red-800" : "hover:bg-slate-50"}`}>
                    <td className={`${td} font-semibold`}>
                      <Link href={href(r)} className="hover:underline">
                        {r.folio}
                      </Link>
                    </td>
                    <td className="px-2.5 py-2">
                      <Link href={href(r)} className="font-medium hover:underline">
                        {r.borrower_name}
                      </Link>
                      {r.source === "new" && <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] font-bold text-blue-800">NEW</span>}
                      {r.seized && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] font-bold text-red-800">SEIZED</span>}
                    </td>
                    <td className={td}>{r.vehicle_model ?? ""}</td>
                    <td className={td}>{dmy(r.agreement_date)}</td>
                    <td className={`${td} text-right`}>{r.tenure ?? ""}</td>
                    <td className={`${td} text-right`}>{inr(r.finance_amount)}</td>
                    <td className={`${td} text-right`}>{inr(r.interest_amount)}</td>
                    <td className={`${td} text-right text-slate-500`}>{isPositive(r.other_charges) ? inr(r.other_charges) : "—"}</td>
                    <td className={`${td} text-right font-medium`}>{inr(r.total_amount)}</td>
                    <td className={`${td} text-right`}>{inr(r.emi)}</td>
                    <td className={`${td} text-right text-emerald-700`}>{inr(r.total_paid)}</td>
                    <td className={td}>{dmy(r.last_paid)}</td>
                    <td className={`${td} text-right font-semibold text-red-700`}>{isPositive(r.arrears) ? inr(r.arrears) : "—"}</td>
                    <td className={`${td} text-right font-semibold`}>{inr(r.balance)}</td>
                    <td className={`${td} text-right ${r.late_days > 0 ? "font-semibold text-red-700" : "text-slate-500"}`}>{r.late_days}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-bold">
                <tr>
                  <td className="px-2.5 py-2.5" colSpan={5}>
                    Total ({rows.length} accounts)
                  </td>
                  <td className={`${td} text-right`}>{inr(totals.finance)}</td>
                  <td className={`${td} text-right`}>{inr(totals.interest)}</td>
                  <td className={`${td} text-right`}>{inr(totals.other)}</td>
                  <td className={`${td} text-right`}>{inr(totals.total)}</td>
                  <td className="px-2.5 py-2.5" />
                  <td className={`${td} text-right text-emerald-700`}>{inr(totals.paid)}</td>
                  <td className="px-2.5 py-2.5" />
                  <td className={`${td} text-right text-red-700`}>{inr(totals.arrears)}</td>
                  <td className={`${td} text-right`}>{inr(totals.balance)}</td>
                  <td className="px-2.5 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>

          <nav className="flex flex-wrap items-center justify-between gap-3 print:hidden" aria-label="Pages">
            <span className="text-sm text-slate-500">
              {showAll ? `All ${rows.length} rows` : `Rows ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, rows.length)} of ${rows.length}`}
            </span>
            <div className="flex gap-2">
              {!showAll && page > 1 && <Pager href={link({ page: String(page - 1) })}>← Previous</Pager>}
              {!showAll && page < pages && <Pager href={link({ page: String(page + 1) })}>Next →</Pager>}
              {showAll ? <Pager href={link({})}>Show 100 per page</Pager> : pages > 1 && <Pager href={link({ all: "1" })}>Show all (for printing)</Pager>}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

function Pager({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex h-11 items-center rounded-lg bg-white px-4 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
      {children}
    </Link>
  );
}

function Stat({ label, value, red, green }: { label: string; value: string; red?: boolean; green?: boolean }) {
  return (
    <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-lg font-bold ${red ? "text-red-700" : green ? "text-emerald-700" : ""}`}>{value}</dd>
    </div>
  );
}

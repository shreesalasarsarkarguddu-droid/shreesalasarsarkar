import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

import { dmy, inr } from "@/lib/format";
import { fromPaise, toPaise, todayIST } from "@/lib/schedule";
import { PrintButton } from "../day-book/print-button";

export const metadata: Metadata = { title: "Due Installments · Shree Salasar Sarkar" };

const PAGE_SIZE = 100;

type DueLine = {
  source: "old" | "new";
  refId: number;
  folio: string;
  name: string;
  model: string | null;
  mobile: string | null;
  vehicleNo: string | null;
  searchText: string;
  seized: boolean;
  emi: string;
  balance: string;
  arrears: string;
  overdueEmis: number;
  dueEmis: number;
  nextDue: string | null;
};

type Row = {
  source: "old" | "new"; ref_id: number; folio: string; borrower_name: string; vehicle_model: string | null; mobile: string | null;
  vehicle_no: string | null; seized: boolean; search_text: string; emi: string; balance: string; arrears: string;
  overdue_emis: number; due_emis: number | string; next_due: string | null;
};

/** One small row per pending account, calculated in the database (public.due_report = same maths as the account page). */
async function loadLines(asOf: string): Promise<DueLine[]> {
  const supabase = await createClient();
  const cols =
    "source, ref_id, folio, borrower_name, vehicle_model, mobile, vehicle_no, seized, search_text, overdue_emis, due_emis, next_due," +
    " emi::text, balance::text, arrears::text";
  const fetchRange = async (start: number) => {
    const { data, error } = await supabase.rpc("due_report", { p_asof: asOf }).select(cols).range(start, start + 999);
    if (error) {
      console.error("due report failed:", error);
      throw new Error("Could not load the report.");
    }
    return (data ?? []) as unknown as Row[];
  };
  // Supabase returns at most 1000 rows per request: fetch the first two blocks in parallel.
  const blocks = await Promise.all([fetchRange(0), fetchRange(1000)]);
  for (let start = 2000; blocks[blocks.length - 1].length === 1000; start += 1000) blocks.push(await fetchRange(start));
  const rows = blocks.flat();
  return rows.map((r) => ({
    source: r.source, refId: r.ref_id, folio: r.folio, name: r.borrower_name, model: r.vehicle_model, mobile: r.mobile,
    vehicleNo: r.vehicle_no, searchText: r.search_text, seized: r.seized, emi: r.emi, balance: r.balance, arrears: r.arrears,
    overdueEmis: r.overdue_emis, dueEmis: Number(r.due_emis), nextDue: r.next_due,
  }));
}

const SORTS = [
  { key: "due", label: "Due date (oldest first)" },
  { key: "emis", label: "Most due EMIs first" },
  { key: "arrears", label: "Highest arrears first" },
  { key: "name", label: "Name (A–Z)" },
] as const;

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}
const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export default async function DueInstallmentsPage({ searchParams }: PageProps<"/reports/due-installments">) {
  const sp = await searchParams;
  const today = todayIST();
  const asOf = isDate(one(sp.upto)) ? one(sp.upto)! : today;
  const from = isDate(one(sp.from)) ? one(sp.from)! : "";
  const q = (one(sp.q) ?? "").trim().toLowerCase().slice(0, 60);
  const model = (one(sp.model) ?? "").trim();
  const type = ["old", "new"].includes(one(sp.type) ?? "") ? one(sp.type)! : "all";
  const seized = ["exclude", "only"].includes(one(sp.seized) ?? "") ? one(sp.seized)! : "include";
  const min = Math.max(0, Number.parseFloat(one(sp.min) ?? "0") || 0);
  const sort = SORTS.some((s) => s.key === one(sp.sort)) ? one(sp.sort)! : "due";
  const showAll = one(sp.all) === "1";
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);

  const all = await loadLines(asOf);
  const models = [...new Set(all.map((l) => l.model).filter(Boolean) as string[])].sort();

  let lines = all.filter(
    (l) =>
      ((l.nextDue != null && l.nextDue <= asOf) || toPaise(l.arrears) > 0n) &&
      (!from || (l.nextDue != null && l.nextDue >= from)) &&
      l.dueEmis >= min &&
      (type === "all" || l.source === type) &&
      (seized === "include" || (seized === "only" ? l.seized : !l.seized)) &&
      (!model || l.model === model) &&
      (!q || l.searchText.includes(q) || l.name.toLowerCase().includes(q)),
  );
  const byDue = (a: DueLine, b: DueLine) => (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999") || a.name.localeCompare(b.name);
  lines = lines.sort(
    sort === "emis"
      ? (a, b) => b.dueEmis - a.dueEmis || byDue(a, b)
      : sort === "arrears"
        ? (a, b) => (toPaise(b.arrears) > toPaise(a.arrears) ? 1 : toPaise(b.arrears) < toPaise(a.arrears) ? -1 : byDue(a, b))
        : sort === "name"
          ? (a, b) => a.name.localeCompare(b.name)
          : byDue,
  );

  const sum = (k: "emi" | "balance" | "arrears") => fromPaise(lines.reduce((t, l) => t + toPaise(l[k]), 0n));
  const totals = { emi: sum("emi"), balance: sum("balance"), arrears: sum("arrears") };
  const pages = Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
  const shown = showAll ? lines : lines.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageLink = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "page" && k !== "all") p.set(k, v);
    for (const [k, v] of Object.entries(changes)) if (v != null) p.set(k, v);
    return `/reports/due-installments?${p}`;
  };
  const href = (l: DueLine) => (l.source === "new" ? `/loans/${l.refId}` : `/accounts/${l.refId}`);
  const input = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm";

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <Link href="/reports" className="text-sm font-medium text-blue-700">
          ← Reports
        </Link>
        <h1 className="text-xl font-bold">Due Installments</h1>
        <p className="text-sm text-slate-500">Pending accounts with an EMI due (or short-paid) up to the chosen date</p>
      </div>

      {/* filters: plain GET form (shareable URL, works without JavaScript) */}
      <form action="/reports/due-installments" className="grid grid-cols-2 gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:grid-cols-3 lg:grid-cols-6 print:hidden">
        <label className="col-span-2 block sm:col-span-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Search</span>
          <input name="q" defaultValue={q} placeholder="Name, folio, mobile, vehicle…" className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Due from</span>
          <input type="date" name="from" defaultValue={from} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Due up to</span>
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
          <input name="min" inputMode="decimal" defaultValue={min ? String(min) : ""} placeholder="0" className={input} />
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
        <div className="col-span-2 flex items-end gap-2 sm:col-span-1 lg:col-span-2">
          <button className="h-11 flex-1 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800">Show</button>
          <Link href="/reports/due-installments" className="flex h-11 items-center rounded-lg px-3 text-sm font-medium text-slate-600 ring-1 ring-slate-300">
            Reset
          </Link>
          <PrintButton />
        </div>
      </form>

      <div className="hidden print:block">
        <p className="text-lg font-bold">Shree Salasar Sarkar — Due Installments</p>
        <p className="text-sm">Due up to {dmy(asOf)}</p>
      </div>

      <dl className="num grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Accounts" value={lines.length.toLocaleString("en-IN")} />
        <Stat label="Total EMI" value={inr(totals.emi)} />
        <Stat label="Total balance" value={inr(totals.balance)} />
        <Stat label="Total arrears" value={inr(totals.arrears)} red />
      </dl>

      {lines.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="font-medium">No due installments for these filters</p>
        </div>
      ) : (
        <>
          {/* phone: cards */}
          {!showAll && (
          <ul className="space-y-2 md:hidden print:hidden">
            {shown.map((l) => (
              <li key={`${l.source}-${l.refId}`} className={`rounded-xl bg-white p-3 ring-1 ${l.seized ? "ring-red-300" : "ring-slate-200"}`}>
                <div className="flex items-start justify-between gap-2">
                  <Link href={href(l)} className={`min-w-0 font-semibold ${l.seized ? "text-red-700" : ""}`}>
                    <span className="block truncate">{l.name}</span>
                    <span className="block text-xs font-normal text-slate-500">
                      Folio {l.folio}
                      {l.model && <> · {l.model}</>}
                      {l.vehicleNo && <> · {l.vehicleNo}</>}
                    </span>
                  </Link>
                  {l.seized ? (
                    <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">Seized</span>
                  ) : (
                    <span className="num shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-800">
                      {l.dueEmis >= 0.1 ? `${l.dueEmis.toFixed(1)} EMI` : "Short paid"}
                    </span>
                  )}
                </div>
                <dl className="num mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-slate-500">Next due</dt>
                    <dd className="font-semibold">{dmy(l.nextDue)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Arrears</dt>
                    <dd className="font-semibold text-red-700">{inr(l.arrears)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Balance</dt>
                    <dd className="font-semibold">{inr(l.balance)}</dd>
                  </div>
                </dl>
                <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                  {l.mobile ? (
                    <a href={`tel:${l.mobile.split(",")[0].trim()}`} className="num font-medium text-blue-700">
                      📞 {l.mobile.split(",")[0].trim()}
                    </a>
                  ) : (
                    <span className="text-slate-400">No mobile</span>
                  )}
                  <span className="num text-xs text-slate-500">EMI {inr(l.emi)}</span>
                </div>
              </li>
            ))}
          </ul>
          )}

          {/* tablet / desktop / print: table (always shown when "Show all" is used for printing) */}
          <div className={`overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200 print:block print:overflow-visible print:ring-0 ${showAll ? "" : "hidden md:block"}`}>
            <table className="num w-full text-sm print:text-[11px]">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">Folio</th>
                  <th className="px-3 py-2.5">Borrower</th>
                  <th className="px-3 py-2.5">Model</th>
                  <th className="px-3 py-2.5">Next due</th>
                  <th className="px-3 py-2.5 text-right">EMI</th>
                  <th className="px-3 py-2.5 text-right">Balance</th>
                  <th className="px-3 py-2.5 text-right">Arrears</th>
                  <th className="px-3 py-2.5 text-right">Due EMIs</th>
                  <th className="px-3 py-2.5">Mobile</th>
                  <th className="px-3 py-2.5">Vehicle no.</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={`${l.source}-${l.refId}`} className={`break-inside-avoid ${l.seized ? "bg-red-50/60 text-red-800" : "hover:bg-slate-50"}`}>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold">
                      <Link href={href(l)} className="hover:underline">
                        {l.folio}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={href(l)} className="font-medium hover:underline">
                        {l.name}
                      </Link>
                      {l.source === "new" && <span className="ml-1.5 rounded bg-blue-100 px-1 text-[10px] font-bold text-blue-800">NEW</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{l.model ?? ""}</td>
                    <td className="whitespace-nowrap px-3 py-2">{dmy(l.nextDue)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{inr(l.emi)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                      {l.seized ? <span className="rounded bg-red-100 px-1.5 text-xs font-bold text-red-800">Seized</span> : inr(l.balance)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-red-700">{inr(l.arrears)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{l.dueEmis.toFixed(1)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {l.mobile ? (
                        <a href={`tel:${l.mobile.split(",")[0].trim()}`} className="text-blue-700 hover:underline print:text-black">
                          {l.mobile}
                        </a>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{l.vehicleNo ?? ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-bold">
                <tr>
                  <td className="px-3 py-2.5" colSpan={4}>
                    Total ({lines.length} accounts)
                  </td>
                  <td className="px-3 py-2.5 text-right">{inr(totals.emi)}</td>
                  <td className="px-3 py-2.5 text-right">{inr(totals.balance)}</td>
                  <td className="px-3 py-2.5 text-right text-red-700">{inr(totals.arrears)}</td>
                  <td className="px-3 py-2.5" colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>

          <nav className="flex flex-wrap items-center justify-between gap-3 print:hidden" aria-label="Pages">
            <span className="text-sm text-slate-500">
              {showAll ? `All ${lines.length} rows` : `Rows ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, lines.length)} of ${lines.length}`}
            </span>
            <div className="flex gap-2">
              {!showAll && page > 1 && <Pager href={pageLink({ page: String(page - 1) })}>← Previous</Pager>}
              {!showAll && page < pages && <Pager href={pageLink({ page: String(page + 1) })}>Next →</Pager>}
              {showAll ? <Pager href={pageLink({})}>Show 100 per page</Pager> : pages > 1 && <Pager href={pageLink({ all: "1" })}>Show all (for printing)</Pager>}
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

function Stat({ label, value, red }: { label: string; value: string; red?: boolean }) {
  return (
    <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-lg font-bold ${red ? "text-red-700" : ""}`}>{value}</dd>
    </div>
  );
}

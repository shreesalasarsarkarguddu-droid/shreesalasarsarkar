import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { dmy, inr, isPositive } from "@/lib/format";
import { fromPaise, toPaise } from "@/lib/schedule";
import { PrintButton } from "../day-book/print-button";

export const metadata: Metadata = { title: "Seized Vehicles · Shree Salasar Sarkar" };

type Row = {
  source: "old" | "new";
  ref_id: number;
  folio: string;
  ledger: "pending" | "closed";
  borrower_name: string;
  mobile: string | null;
  vehicle_model: string | null;
  vehicle_no: string | null;
  seized_on: string | null;
  remarks: string | null;
  from_old_software: boolean;
  search_text: string;
  total_amount: string;
  total_paid: string;
  balance: string;
};

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function SeizedReportPage({ searchParams }: PageProps<"/reports/seized">) {
  const sp = await searchParams;
  const q = (one(sp.q) ?? "").trim().toLowerCase().slice(0, 60);
  const status = ["pending", "closed"].includes(one(sp.status) ?? "") ? one(sp.status)! : "pending";

  const supabase = await createClient();
  let query = supabase
    .from("seized_accounts")
    .select(
      "source, ref_id, folio, ledger, borrower_name, mobile, vehicle_model, vehicle_no, seized_on, remarks, from_old_software, search_text," +
        " total_amount::text, total_paid::text, balance::text",
    )
    .order("seized_on", { ascending: false, nullsFirst: false })
    .order("ref_id", { ascending: false })
    .limit(1000);
  if (status !== "all") query = query.eq("ledger", status);
  if (q) query = query.ilike("search_text", `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
  const { data, error } = await query;
  if (error) {
    console.error("seized report failed:", error);
    throw new Error("Could not load the report.");
  }
  const rows = (data ?? []) as unknown as Row[];
  const sum = (k: "total_amount" | "total_paid" | "balance") => fromPaise(rows.reduce((t, r) => t + toPaise(r[k]), 0n));
  const href = (r: Row) => (r.source === "new" ? `/loans/${r.ref_id}` : `/accounts/${r.ref_id}`);
  const tabs = [
    { key: "pending", label: "Balance pending" },
    { key: "closed", label: "Fully paid" },
    { key: "all", label: "All" },
  ];
  const tabHref = (k: string) => `/reports/seized?${new URLSearchParams({ ...(q ? { q } : {}), status: k })}`;

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <Link href="/reports" className="text-sm font-medium text-blue-700">
          ← Reports
        </Link>
        <h1 className="text-xl font-bold">Seized Vehicles</h1>
        <p className="text-sm text-slate-500">Accounts whose vehicle is seized right now. Open an account to release it.</p>
      </div>

      <form action="/reports/seized" className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200 print:hidden">
        <input type="hidden" name="status" value={status} />
        <label className="block min-w-56 flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Search</span>
          <input name="q" defaultValue={q} placeholder="Name, folio, mobile, vehicle…" className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" />
        </label>
        <button className="h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800">Show</button>
        <PrintButton />
      </form>

      <nav className="flex flex-wrap gap-2 print:hidden" aria-label="Filter">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            className={`flex h-10 items-center rounded-full px-4 text-sm font-medium ring-1 ${
              status === t.key ? "bg-blue-700 text-white ring-blue-700" : "bg-white text-slate-700 ring-slate-300"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="hidden print:block">
        <p className="text-lg font-bold">Shree Salasar Sarkar — Seized Vehicles</p>
      </div>

      <dl className="num grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Vehicles" value={rows.length.toLocaleString("en-IN")} />
        <Stat label="Total payable" value={inr(sum("total_amount"))} />
        <Stat label="Paid" value={inr(sum("total_paid"))} />
        <Stat label="Balance" value={inr(sum("balance"))} red />
      </dl>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="font-medium">No seized vehicles here</p>
        </div>
      ) : (
        <>
          {/* phone */}
          <ul className="space-y-2 md:hidden print:hidden">
            {rows.map((r) => (
              <li key={`${r.source}-${r.ref_id}`} className="rounded-xl bg-white p-3 ring-1 ring-red-200">
                <Link href={href(r)} className="block">
                  <span className="block truncate font-semibold text-red-800">{r.borrower_name}</span>
                  <span className="block text-xs text-slate-500">
                    Folio {r.folio}
                    {r.vehicle_model && <> · {r.vehicle_model}</>}
                    {r.vehicle_no && <> · {r.vehicle_no}</>}
                  </span>
                </Link>
                <p className="mt-1 text-xs text-slate-600">
                  Seized {r.seized_on ? dmy(r.seized_on) : "(old software)"}
                  {r.remarks && <> · {r.remarks}</>}
                </p>
                <div className="num mt-2 flex items-center justify-between text-sm">
                  <span>
                    Balance <b className={isPositive(r.balance) ? "text-red-700" : ""}>{inr(r.balance)}</b>
                  </span>
                  {r.mobile && (
                    <a href={`tel:${r.mobile.split(",")[0].trim()}`} className="font-medium text-blue-700">
                      📞 {r.mobile.split(",")[0].trim()}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* tablet / desktop / print */}
          <div className="hidden overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200 md:block print:block print:overflow-visible print:ring-0">
            <table className="num w-full text-sm print:text-[11px]">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">Folio</th>
                  <th className="px-3 py-2.5">Borrower</th>
                  <th className="px-3 py-2.5">Model</th>
                  <th className="px-3 py-2.5">Vehicle no.</th>
                  <th className="px-3 py-2.5">Seized on</th>
                  <th className="px-3 py-2.5">Remarks</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5 text-right">Paid</th>
                  <th className="px-3 py-2.5 text-right">Balance</th>
                  <th className="px-3 py-2.5">Mobile</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.source}-${r.ref_id}`} className="break-inside-avoid hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-2 font-semibold">
                      <Link href={href(r)} className="text-red-800 hover:underline">
                        {r.folio}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={href(r)} className="font-medium hover:underline">
                        {r.borrower_name}
                      </Link>
                      {r.ledger === "closed" && <span className="ml-1.5 rounded bg-emerald-100 px-1 text-[10px] font-bold text-emerald-800">FULLY PAID</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{r.vehicle_model ?? ""}</td>
                    <td className="whitespace-nowrap px-3 py-2">{r.vehicle_no ?? ""}</td>
                    <td className="whitespace-nowrap px-3 py-2">{r.seized_on ? dmy(r.seized_on) : <span className="text-xs text-slate-400">old software</span>}</td>
                    <td className="max-w-64 px-3 py-2 text-slate-600">{r.remarks ?? ""}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{inr(r.total_amount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-emerald-700">{inr(r.total_paid)}</td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${isPositive(r.balance) ? "text-red-700" : ""}`}>{inr(r.balance)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {r.mobile ? (
                        <a href={`tel:${r.mobile.split(",")[0].trim()}`} className="text-blue-700 hover:underline print:text-black">
                          {r.mobile}
                        </a>
                      ) : (
                        ""
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-bold">
                <tr>
                  <td className="px-3 py-2.5" colSpan={6}>
                    Total ({rows.length} vehicles)
                  </td>
                  <td className="px-3 py-2.5 text-right">{inr(sum("total_amount"))}</td>
                  <td className="px-3 py-2.5 text-right">{inr(sum("total_paid"))}</td>
                  <td className="px-3 py-2.5 text-right text-red-700">{inr(sum("balance"))}</td>
                  <td className="px-3 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
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

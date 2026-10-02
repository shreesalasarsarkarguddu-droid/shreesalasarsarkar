import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { inr, isPositive } from "@/lib/format";
import { SearchBox } from "./search-box";
import { StatusBadge } from "./status-badge";

export const metadata: Metadata = { title: "Accounts · Shree Salasar Sarkar" };

const PAGE_SIZE = 20;
const LEDGERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "closed", label: "Fully paid" },
] as const;

type Row = {
  sno: number;
  fno: number;
  ledger: "pending" | "closed";
  borrower_name: string;
  borrower_father: string | null;
  borrower_mobile: string | null;
  registration_no: string | null;
  vehicle_model: string | null;
  tenure_months: number | null;
  total_amount: string;
  emi_amount: string;
  total_paid: string;
  balance: string;
  payments_count: number;
  seized: boolean | null;
};

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

export default async function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  const sp = await searchParams;
  const q = (one(sp.q) ?? "").trim().toLowerCase().slice(0, 60);
  const ledger = LEDGERS.some((l) => l.key === one(sp.ledger)) ? one(sp.ledger)! : "all";
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);

  const supabase = await createClient();
  let query = supabase
    .from("legacy_account_summary")
    .select(
      "sno, fno, ledger, borrower_name, borrower_father, borrower_mobile, registration_no, vehicle_model," +
        " tenure_months, payments_count, seized, total_amount::text, emi_amount::text, total_paid::text, balance::text",
      { count: "exact" },
    )
    .order("sno", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (ledger !== "all") query = query.eq("ledger", ledger);
  if (q) query = query.ilike("search_text", `%${escapeLike(q)}%`);

  const { data, count, error } = await query;
  if (error) {
    console.error("accounts query failed:", error);
    throw new Error("Could not load accounts.");
  }
  const rows = (data ?? []) as unknown as Row[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (ledger !== "all") next.set("ledger", ledger);
    for (const [k, v] of Object.entries(changes)) {
      if (v == null) next.delete(k);
      else next.set(k, v);
    }
    const s = next.toString();
    return s ? `/accounts?${s}` : "/accounts";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Accounts</h1>
          <p className="text-sm text-slate-500">Imported from the old software</p>
        </div>
      </div>

      <Suspense>
        <SearchBox />
      </Suspense>

      <nav className="flex gap-2" aria-label="Filter by status">
        {LEDGERS.map((l) => (
          <Link
            key={l.key}
            href={href({ ledger: l.key === "all" ? null : l.key, page: null })}
            className={`flex h-10 items-center rounded-full px-4 text-sm font-medium ring-1 ${
              ledger === l.key ? "bg-blue-700 text-white ring-blue-700" : "bg-white text-slate-700 ring-slate-300"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>

      <p className="text-sm text-slate-500">
        {total.toLocaleString("en-IN")} account{total === 1 ? "" : "s"}
        {q && <> matching “{q}”</>}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="font-medium">No accounts found</p>
          <p className="mt-1 text-sm text-slate-500">Try a different name, FNO, mobile or vehicle number.</p>
        </div>
      ) : (
        <>
          {/* phone: cards */}
          <ul className="space-y-3 md:hidden">
            {rows.map((r) => (
              <li key={r.sno}>
                <Link
                  href={`/accounts/${r.sno}`}
                  className="block rounded-xl bg-white p-4 ring-1 ring-slate-200 active:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{r.borrower_name}</p>
                      <p className="truncate text-sm text-slate-500">
                        FNO {r.fno}
                        {r.borrower_mobile && <> · {r.borrower_mobile}</>}
                      </p>
                    </div>
                    <StatusBadge ledger={r.ledger} seized={r.seized} />
                  </div>
                  <dl className="num mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">Total</dt>
                      <dd className="font-medium">{inr(r.total_amount)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Paid</dt>
                      <dd className="font-medium text-emerald-700">{inr(r.total_paid)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Balance</dt>
                      <dd className={`font-semibold ${isPositive(r.balance) ? "text-red-700" : "text-slate-700"}`}>
                        {inr(r.balance)}
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>

          {/* tablet / desktop: table */}
          <div className="hidden overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">FNO</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">EMI</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="num divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.sno} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/accounts/${r.sno}`} className="text-blue-700 hover:underline">
                        {r.fno}
                      </Link>
                    </td>
                    <td className="max-w-64 px-4 py-3">
                      <Link href={`/accounts/${r.sno}`} className="block truncate font-medium hover:underline">
                        {r.borrower_name}
                      </Link>
                      <span className="block truncate text-xs text-slate-500">
                        {r.borrower_father ?? ""}
                        {r.borrower_mobile && <> · {r.borrower_mobile}</>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <span className="block">{r.registration_no ?? "—"}</span>
                      <span className="block text-xs text-slate-500">{r.vehicle_model ?? ""}</span>
                    </td>
                    <td className="px-4 py-3 text-right">{inr(r.total_amount)}</td>
                    <td className="px-4 py-3 text-right">
                      {inr(r.emi_amount)}
                      <span className="block text-xs text-slate-500">× {r.tenure_months ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-700">{inr(r.total_paid)}</td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${isPositive(r.balance) ? "text-red-700" : "text-slate-700"}`}
                    >
                      {inr(r.balance)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge ledger={r.ledger} seized={r.seized} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Pages">
          <PageLink href={page > 1 ? href({ page: String(page - 1) }) : null}>← Previous</PageLink>
          <span className="text-sm text-slate-500">
            Page {page} of {pages}
          </span>
          <PageLink href={page < pages ? href({ page: String(page + 1) }) : null}>Next →</PageLink>
        </nav>
      )}
    </div>
  );
}

function PageLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  const cls = "flex h-11 items-center rounded-lg px-4 text-sm font-medium ring-1";
  return href ? (
    <Link href={href} className={`${cls} bg-white text-slate-700 ring-slate-300 hover:bg-slate-50`}>
      {children}
    </Link>
  ) : (
    <span className={`${cls} bg-slate-50 text-slate-300 ring-slate-200`}>{children}</span>
  );
}

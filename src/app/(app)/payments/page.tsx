import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { SearchBox } from "../accounts/search-box";
import { CollectList, type PendingRow } from "./collect-list";

export const metadata: Metadata = { title: "Collect payment · Shree Salasar Sarkar" };

const PAGE_SIZE = 30;

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const sp = await searchParams;
  const q = (one(sp.q) ?? "").trim().toLowerCase().slice(0, 60);
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);

  const supabase = await createClient();
  // Only the three columns the list shows - the full ledger loads when a row is opened.
  let query = supabase
    .from("pending_borrowers")
    .select("source, ref_id, folio, borrower_name, borrower_mobile", { count: "exact" })
    .order("sort_key", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) query = query.ilike("search_text", `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
  const { data, count, error } = await query;
  if (error) {
    console.error("pending list failed:", error);
    throw new Error("Could not load pending borrowers.");
  }
  const rows = (data ?? []) as unknown as PendingRow[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (n: number) => `/payments?${new URLSearchParams({ ...(q ? { q } : {}), ...(n > 1 ? { page: String(n) } : {}) })}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Collect payment</h1>
        <p className="text-sm text-slate-500">Pending borrowers · tap a name to take a payment</p>
      </div>

      <Suspense>
        <SearchBox basePath="/payments" placeholder="Folio, name or mobile" />
      </Suspense>

      <p className="text-sm text-slate-500">
        {total.toLocaleString("en-IN")} pending{q && <> matching “{q}”</>}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="font-medium">No pending borrowers found</p>
          <p className="mt-1 text-sm text-slate-500">Try a different folio, name or mobile.</p>
        </div>
      ) : (
        <CollectList rows={rows} />
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Pages">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="flex h-11 items-center rounded-lg bg-white px-4 text-sm font-medium ring-1 ring-slate-300">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-slate-500">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className="flex h-11 items-center rounded-lg bg-white px-4 text-sm font-medium ring-1 ring-slate-300">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}

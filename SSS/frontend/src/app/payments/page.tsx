import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/lib/use-api";
import { SearchBox } from "../accounts/search-box";
import { CollectList, type PendingRow } from "./collect-list";
import Loading from "../loading";

const PAGE_SIZE = 30;

export default function PaymentsPage() {
  const sp = useSearchParams();
  const q = (sp.get("q") ?? "").trim().toLowerCase().slice(0, 60);
  const page = Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1);
  // Only the columns the list shows - the full ledger loads when a row is opened.
  const res = useApi<{ rows: PendingRow[]; total: number }>(`/payments/pending?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page) })}`, { keep: true });
  if (res.isPending) return <Loading />;
  if (res.error) throw res.error;
  const rows = res.data.rows;
  const total = res.data.total;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (n: number) => `/payments?${new URLSearchParams({ ...(q ? { q } : {}), ...(n > 1 ? { page: String(n) } : {}) })}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <title>Collect payment · Shree Salasar Sarkar</title>
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

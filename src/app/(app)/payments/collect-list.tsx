"use client";

import { useState } from "react";
import { PaymentDialog } from "./payment-dialog";

export type PendingRow = {
  source: "old" | "new";
  ref_id: number;
  folio: string;
  borrower_name: string;
  borrower_mobile: string | null;
};

export function CollectList({ rows }: { rows: PendingRow[] }) {
  const [open, setOpen] = useState<PendingRow | null>(null);

  return (
    <>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
        {rows.map((r) => (
          <li key={`${r.source}-${r.ref_id}`}>
            <button
              type="button"
              onClick={() => setOpen(r)}
              className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 active:bg-slate-100"
            >
              <span className="num w-16 shrink-0 text-sm font-semibold text-blue-700">{r.folio}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.borrower_name}</span>
                <span className="num block text-sm text-slate-500">{r.borrower_mobile ?? "No mobile"}</span>
              </span>
              {r.source === "new" && (
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-bold uppercase text-blue-800">New</span>
              )}
              <span aria-hidden className="text-slate-300">
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && <PaymentDialog key={`${open.source}-${open.ref_id}`} row={open} onClose={() => setOpen(null)} />}
    </>
  );
}

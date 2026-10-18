"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteLoan, type FixResult } from "../../fix-actions";

const input =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";

/** Admin only, and only while the loan has no payments: remove a loan entered by mistake. */
export function DeleteLoan({ id, folio }: { id: number; folio: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const [typed, setTyped] = useState("");
  const [r, setR] = useState<FixResult | null>(null);
  const [pending, start] = useTransition();

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-11 rounded-lg bg-white px-4 text-sm font-semibold text-red-700 ring-1 ring-slate-300 hover:bg-red-50"
      >
        Delete loan
      </button>
    );

  return (
    <section className="space-y-3 rounded-xl bg-red-50 p-4 ring-1 ring-red-200">
      <p className="text-sm font-semibold text-red-800">Delete loan folio {folio}?</p>
      <p className="text-sm text-red-800">
        Use this only for a loan entered by mistake. The loan, its borrower (if they have no other loan) and its seize history are
        removed. A full copy is kept in the activity log.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Reason *</span>
          <input className={input} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. entered twice" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Type <b>DELETE</b> to confirm
          </span>
          <input className={input} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || typed !== "DELETE"}
          onClick={() =>
            start(async () => {
              const res = await deleteLoan(id, why, typed);
              setR(res);
              if (res.ok) router.replace("/accounts?deleted=1");
            })
          }
          className="h-11 rounded-lg bg-red-700 px-5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Delete loan"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-lg px-4 text-sm font-semibold text-slate-600">
          Keep it
        </button>
        {r && !r.ok && <span className="text-sm text-red-700">{r.error}</span>}
      </div>
    </section>
  );
}

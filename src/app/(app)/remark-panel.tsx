"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateInput } from "@/components/date-input";
import { dateTimeIST, dmy } from "@/lib/format";
import type { Remark } from "@/lib/remarks";
import { addMonths, todayIST } from "@/lib/schedule";
import { addRemark, deleteRemark, type RemarkResult } from "./remark-actions";

const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/**
 * "Payment not received": the customer did not pay today. Write what he said and when he will pay.
 * The remark shows on the unpaid EMI row until it is paid, and on the Remarks page.
 */
export function RemarkPanel({
  source, refId, installmentNo, onSaved, startOpen = false,
}: {
  source: "old" | "new"; refId: number; installmentNo: number | null; onSaved?: () => void; startOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [remark, setRemark] = useState("");
  const [promise, setPromise] = useState("");
  const [r, setR] = useState<RemarkResult | null>(null);
  const [pending, start] = useTransition();
  const today = todayIST();
  const quick: [string, string][] = [
    ["2 days", addDays(today, 2)],
    ["3 days", addDays(today, 3)],
    ["1 week", addDays(today, 7)],
    ["1 month", addMonths(today, 1)],
  ];

  if (!open)
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setR(null);
          }}
          className="h-11 w-full rounded-xl bg-white text-sm font-semibold text-amber-800 ring-1 ring-amber-300 hover:bg-amber-50"
        >
          🗒 Payment not received? Write remark
        </button>
        {r?.ok && <p className="text-center text-sm text-emerald-700">✓ {r.message}</p>}
      </div>
    );

  return (
    <form
      className="space-y-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await addRemark({ source, refId, installmentNo, remark, promiseDate: promise });
          setR(res);
          if (res.ok) {
            setOpen(startOpen);
            setRemark("");
            setPromise("");
            onSaved?.();
            router.refresh();
          }
        });
      }}
    >
      <p className="text-sm font-semibold text-amber-900">Payment not received{installmentNo ? ` (EMI #${installmentNo})` : ""}</p>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">What did the customer say? *</span>
        <textarea
          rows={2}
          maxLength={300}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="e.g. will pay after salary / not at home / out of station"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
        />
      </label>
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Will pay on (optional)</span>
        <div className="mb-2 flex flex-wrap gap-2">
          {quick.map(([label, d]) => (
            <button
              key={label}
              type="button"
              onClick={() => setPromise(d)}
              className={`h-9 rounded-lg px-3 text-sm font-semibold ring-1 ${promise === d ? "bg-amber-700 text-white ring-amber-700" : "bg-white text-slate-700 ring-slate-300"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <DateInput
          value={promise}
          min={today}
          onChange={setPromise}
          className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className="h-11 rounded-lg bg-amber-700 px-5 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? "Saving…" : "Save remark"}
        </button>
        {!startOpen && (
          <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-lg px-3 text-sm font-semibold text-slate-600">
            Cancel
          </button>
        )}
        {r && !r.ok && <span className="text-sm text-red-700">{r.error}</span>}
        {r?.ok && startOpen && <span className="text-sm text-emerald-700">✓ {r.message}</span>}
      </div>
    </form>
  );
}

/** All remarks on one account (account / loan page), newest first, with Delete where allowed. */
export function RemarkHistory({ remarks, path, canFix }: { remarks: Remark[]; path: string; canFix: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const today = todayIST();
  if (remarks.length === 0) return <p className="px-4 py-3 text-sm text-slate-500">No remarks yet.</p>;
  return (
    <>
      {err && <p className="mx-4 mt-2 text-sm text-red-700">{err}</p>}
      <ul className="divide-y divide-slate-100">
        {remarks.map((r) => {
          const broken = !r.paid_after && r.promise_date != null && r.promise_date < today;
          const canDelete = canFix || (r.mine && dateTimeIST(r.created_at).slice(0, 10) === dmy(today));
          return (
            <li key={r.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p>
                  <b>{r.by_name}</b> · <span className="num text-slate-500">{dateTimeIST(r.created_at)}</span>
                  {r.installment_no && <span className="text-slate-500"> · EMI #{r.installment_no}</span>}
                </p>
                <p className="text-slate-800">“{r.remark}”</p>
                {r.promise_date && (
                  <p className={`num text-xs ${broken ? "font-semibold text-red-700" : "text-slate-600"}`}>
                    Will pay {dmy(r.promise_date)}
                    {r.paid_after ? " · ✓ paid after this" : broken ? " · not paid" : ""}
                  </p>
                )}
                {!r.promise_date && r.paid_after && <p className="text-xs text-emerald-700">✓ paid after this</p>}
              </div>
              {canDelete && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await deleteRemark(r.id, path);
                      setErr(res.ok ? null : res.error);
                      if (res.ok) router.refresh();
                    })
                  }
                  className="h-8 rounded-lg bg-white px-3 text-xs font-semibold text-red-700 ring-1 ring-slate-300 disabled:opacity-60"
                >
                  Delete
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

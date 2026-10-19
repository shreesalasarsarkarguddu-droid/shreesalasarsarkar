"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dmy, inr, rcpt, timeIST } from "@/lib/format";
import { reviewPending, type CtlResult } from "../control-actions";

export type Waiting = {
  id: number; user_id: string; subject: string | null; source: "old" | "new"; ref_id: number; paid_amount: number; paid_date: string;
  receipt_no: number; receipt_book: string | null; payment_mode: string; reason: string | null; by_name: string; created_at: string;
  /** cash in this payment (all of it for CASH, the cash part of a split payment) */
  cash_part: number;
};

const rs = (v: number) => inr(String(v));

/** One collection man's waiting payments for one day: tick, then approve or reject. */
export function ApproveGroup({ rows }: { rows: Waiting[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<number>>(() => new Set(rows.map((r) => r.id)));
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [r, setR] = useState<CtlResult | null>(null);
  const [pending, start] = useTransition();

  const ticked = rows.filter((w) => picked.has(w.id));
  const cash = ticked.reduce((t, w) => t + Number(w.cash_part), 0);
  const other = ticked.reduce((t, w) => t + Number(w.paid_amount) - Number(w.cash_part), 0);
  const allOn = rows.every((w) => picked.has(w.id));
  const go = (approve: boolean) =>
    start(async () => {
      const res = await reviewPending([...picked], approve, note);
      setR(res);
      if (res.ok) {
        setRejecting(false);
        setNote("");
        router.refresh();
      }
    });

  return (
    <div className="rounded-xl bg-white ring-1 ring-amber-200">
      <label className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5 accent-blue-700"
          checked={allOn}
          onChange={() => setPicked(allOn ? new Set() : new Set(rows.map((w) => w.id)))}
        />
        <span className="flex-1">Tick all {rows.length}</span>
        <span className="num text-xs text-slate-600">
          ticked: cash <b className="text-slate-900">{rs(cash)}</b>
          {other > 0 && (
            <>
              {" "}
              · cheque/bank <b className="text-slate-900">{rs(other)}</b>
            </>
          )}
        </span>
      </label>
      <ul className="divide-y divide-slate-100">
        {rows.map((w) => (
          <li key={w.id}>
            <label className={`flex cursor-pointer items-start gap-3 px-3 py-2 text-sm ${picked.has(w.id) ? "" : "opacity-60"}`}>
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 accent-blue-700"
                checked={picked.has(w.id)}
                onChange={() =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (n.has(w.id)) n.delete(w.id);
                    else n.add(w.id);
                    return n;
                  })
                }
              />
              <span className="min-w-0 flex-1">
                <a href={w.source === "old" ? `/accounts/${w.ref_id}` : `/loans/${w.ref_id}`} className="font-medium text-blue-700">
                  {w.subject ?? `${w.source} ${w.ref_id}`}
                </a>
                <span className="num block text-xs text-slate-500">
                  Rcpt {rcpt(w.receipt_no, w.receipt_book)} · {w.payment_mode} · paid {dmy(w.paid_date)} ·{" "}
                  {timeIST(w.created_at)}
                  {w.reason && w.reason !== "waiting for cash count" && <span className="text-amber-700"> · {w.reason.replace("waiting for cash count · ", "")}</span>}
                </span>
              </span>
              <span className="num shrink-0 font-semibold">{rs(Number(w.paid_amount))}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="space-y-2 border-t border-slate-100 p-3">
        {rejecting && (
          <input
            className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why reject? e.g. cash not handed in"
            autoFocus
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {!rejecting ? (
            <>
              <button
                type="button"
                disabled={pending || picked.size === 0}
                onClick={() => go(true)}
                className="h-11 rounded-lg bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {pending ? "Approving…" : `Approve ${picked.size} · ${rs(cash + other)}`}
              </button>
              <button
                type="button"
                disabled={picked.size === 0}
                onClick={() => setRejecting(true)}
                className="h-11 rounded-lg bg-white px-4 text-sm font-semibold text-red-700 ring-1 ring-slate-300 hover:bg-red-50 disabled:opacity-50"
              >
                Reject ticked…
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => go(false)}
                className="h-11 rounded-lg bg-red-700 px-5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                {pending ? "Rejecting…" : `Reject ${picked.size}`}
              </button>
              <button type="button" onClick={() => setRejecting(false)} className="h-11 rounded-lg px-3 text-sm font-semibold text-slate-600">
                Back
              </button>
            </>
          )}
          {r && <span className={`text-sm ${r.ok ? "text-emerald-700" : "text-red-700"}`}>{r.ok ? r.message : r.error}</span>}
        </div>
      </div>
    </div>
  );
}

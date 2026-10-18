"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewPayment, type CtlResult } from "../control-actions";

export function ReviewButtons({ id }: { id: number }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [r, setR] = useState<CtlResult | null>(null);
  const [pending, start] = useTransition();
  const go = (approve: boolean) =>
    start(async () => {
      const res = await reviewPayment(id, approve, note);
      setR(res);
      if (res.ok) router.refresh();
    });

  return (
    <div className="mt-3 space-y-2">
      {rejecting && (
        <input
          className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why reject? (the payment will be cancelled)"
          autoFocus
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!rejecting ? (
          <>
            <button type="button" disabled={pending} onClick={() => go(true)} className="h-10 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
              {pending ? "Saving…" : "Approve"}
            </button>
            <button type="button" onClick={() => setRejecting(true)} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-red-700 ring-1 ring-slate-300 hover:bg-red-50">
              Reject…
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={pending} onClick={() => go(false)} className="h-10 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">
              {pending ? "Saving…" : "Reject and cancel payment"}
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="h-10 rounded-lg px-3 text-sm font-semibold text-slate-600">
              Back
            </button>
          </>
        )}
        {r && <span className={`text-sm ${r.ok ? "text-emerald-700" : "text-red-700"}`}>{r.ok ? r.message : r.error}</span>}
      </div>
    </div>
  );
}

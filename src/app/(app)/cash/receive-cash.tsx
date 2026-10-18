"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { receiveCash, type CtlResult } from "../control-actions";

export function ReceiveCash({ userId, day, cash, again }: { userId: string; day: string; cash: string; again: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(Number(cash)));
  const [note, setNote] = useState("");
  const [r, setR] = useState<CtlResult | null>(null);
  const [pending, start] = useTransition();

  if (!open)
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`h-10 rounded-lg px-4 text-sm font-semibold ${again ? "bg-white text-blue-700 ring-1 ring-slate-300" : "bg-blue-700 text-white hover:bg-blue-800"}`}
        >
          {again ? "Change received amount" : "Receive cash"}
        </button>
        {r && <span className={`text-sm ${r.ok ? "text-emerald-700" : "text-red-700"}`}>{r.ok ? r.message : r.error}</span>}
      </div>
    );

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await receiveCash(userId, day, amount, note);
          setR(res);
          if (res.ok) {
            setOpen(false);
            router.refresh();
          }
        });
      }}
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Cash handed in (₹)</span>
        <input
          className="num h-11 w-36 rounded-lg border border-slate-300 bg-white px-3 text-base"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
        />
      </label>
      <label className="block min-w-48 flex-1">
        <span className="mb-1 block text-xs font-medium text-slate-600">Note (optional)</span>
        <input className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="submit" disabled={pending} className="h-11 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-lg px-3 text-sm font-semibold text-slate-600">
        Cancel
      </button>
      {r && !r.ok && <p className="w-full text-sm text-red-700">{r.error}</p>}
    </form>
  );
}

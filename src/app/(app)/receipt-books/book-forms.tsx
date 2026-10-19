"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { receiptBook, type CtlResult } from "../control-actions";

const input = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";

export function NewBook({ staff, series }: { staff: { id: string; name: string }[]; series: { id: number; code: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [seriesId, setSeriesId] = useState(series[0]?.id ?? 0);
  const [r, setR] = useState<CtlResult | null>(null);
  const [pending, start] = useTransition();

  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setOpen(true)} className="h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800">
          + Give a receipt book
        </button>
        {r?.ok && <span className="text-sm text-emerald-700">{r.message}</span>}
      </div>
    );

  return (
    <form
      className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-slate-200"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await receiptBook({ action: "add", user_id: userId, from_no: from, to_no: to, note, series_id: seriesId || undefined });
          setR(res);
          if (res.ok) {
            setOpen(false);
            setFrom("");
            setTo("");
            setNote("");
            router.refresh();
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Person</span>
          <select className={input} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose…</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">First receipt no.</span>
          <input className={`${input} num`} inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Last receipt no.</span>
          <input className={`${input} num`} inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ""))} />
        </label>
      </div>
      {series.length > 1 && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Which receipt book (zone)</span>
          <select className={input} value={seriesId} onChange={(e) => setSeriesId(Number(e.target.value))}>
            {series.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Note (optional)</span>
        <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Book no. 12" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? "Saving…" : "Give book"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-lg px-3 text-sm font-semibold text-slate-600">
          Cancel
        </button>
        {r && !r.ok && <span className="text-sm text-red-700">{r.error}</span>}
      </div>
    </form>
  );
}

export function BookActions({ id, closed, unused }: { id: number; closed: boolean; unused: boolean }) {
  const router = useRouter();
  const [r, setR] = useState<CtlResult | null>(null);
  const [pending, start] = useTransition();
  const run = (action: "close" | "reopen" | "delete") =>
    start(async () => {
      const res = await receiptBook({ action, id });
      setR(res);
      if (res.ok) router.refresh();
    });
  const b = "h-9 rounded-lg bg-white px-3 text-sm font-semibold ring-1 ring-slate-300 disabled:opacity-60";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {closed ? (
        <button type="button" disabled={pending} onClick={() => run("reopen")} className={`${b} text-blue-700`}>
          Reopen
        </button>
      ) : (
        <button type="button" disabled={pending} onClick={() => run("close")} className={`${b} text-slate-700`}>
          Close book
        </button>
      )}
      {unused && (
        <button type="button" disabled={pending} onClick={() => run("delete")} className={`${b} text-red-700`}>
          Delete
        </button>
      )}
      {r && !r.ok && <span className="text-sm text-red-700">{r.error}</span>}
    </div>
  );
}

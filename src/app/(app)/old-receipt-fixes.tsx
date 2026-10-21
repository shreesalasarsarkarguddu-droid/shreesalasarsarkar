"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dmy, inr, rcpt } from "@/lib/format";
import { todayIST } from "@/lib/schedule";
import { DateInput } from "@/components/date-input";
import { OLD_RECEIPT_MODES, plainMoney, type OldReceiptInput } from "@/lib/old-account";
import { cancelOldReceipt, editOldReceipt, type OldFixResult } from "./old-fix-actions";

export type OldReceipt = {
  id: number;
  installment_no: number;
  paid_amount: string;
  paid_date: string | null;
  payment_mode: string | null;
  cheque_no: string | null;
  receipt_no: number | null;
  receipt_book: string | null;
};

const input =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";

/** Admin only: the receipts from the old software on one account, each with Edit and Cancel. */
export function OldReceiptFixes({ receipts, sno, onChanged }: { receipts: OldReceipt[]; sno: number; onChanged?: () => void }) {
  const [open, setOpen] = useState<{ id: number; mode: "edit" | "cancel" } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const sorted = [...receipts].sort((a, b) => b.installment_no - a.installment_no); // newest first
  if (sorted.length === 0) return null;
  const shown = showAll ? sorted : sorted.slice(0, 5);
  const toggle = (id: number, mode: "edit" | "cancel") => {
    setDone(null);
    setOpen(open?.id === id && open.mode === mode ? null : { id, mode });
  };
  const finished = (m: string) => {
    setOpen(null);
    setDone(m);
    onChanged?.();
  };
  return (
    <section className="rounded-xl bg-white ring-1 ring-amber-200">
      <div className="border-b border-amber-100 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">Fix old software receipts (admin)</h2>
        <p className="text-xs text-slate-500">
          Change a wrong amount, date, mode or receipt no., or cancel a receipt. A reason is required and saved in the activity log. The
          balance and later payments are recalculated.
        </p>
      </div>
      {done && (
        <p role="status" className="mx-4 mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {done}
        </p>
      )}
      <ul className="divide-y divide-slate-100">
        {shown.map((p) => (
          <li key={p.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="num min-w-0 flex-1 text-sm">
                <b>#{p.installment_no}</b> · <span className="font-semibold text-emerald-700">{inr(p.paid_amount)}</span> · {dmy(p.paid_date)} ·{" "}
                {p.payment_mode ?? "CASH"} · Rcpt {p.receipt_no != null ? rcpt(p.receipt_no, p.receipt_book) : "—"}
              </p>
              <button
                type="button"
                onClick={() => toggle(p.id, "edit")}
                className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => toggle(p.id, "cancel")}
                className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-red-700 ring-1 ring-slate-300 hover:bg-red-50"
              >
                Cancel receipt
              </button>
            </div>
            {open?.id === p.id && open.mode === "edit" && <EditForm p={p} sno={sno} onDone={finished} />}
            {open?.id === p.id && open.mode === "cancel" && <CancelForm p={p} sno={sno} onDone={finished} />}
          </li>
        ))}
      </ul>
      {sorted.length > 5 && (
        <button type="button" onClick={() => setShowAll(!showAll)} className="w-full border-t border-slate-100 px-4 py-3 text-sm font-medium text-blue-700">
          {showAll ? "Show the latest 5" : `Show all ${sorted.length} receipts`}
        </button>
      )}
    </section>
  );
}

function EditForm({ p, sno, onDone }: { p: OldReceipt; sno: number; onDone: (m: string) => void }) {
  const router = useRouter();
  const [f, setF] = useState<OldReceiptInput & { reason: string }>({
    paid_amount: plainMoney(p.paid_amount),
    paid_date: p.paid_date ?? "",
    payment_mode: p.payment_mode ?? "CASH",
    receipt_no: p.receipt_no == null ? "" : String(p.receipt_no),
    cheque_no: p.cheque_no ?? "",
    reason: "",
  });
  const [r, setR] = useState<OldFixResult | null>(null);
  const [pending, start] = useTransition();
  const err = (k: string) => (r && !r.ok ? r.fieldErrors?.[k] : undefined);
  const set = (k: keyof typeof f, v: string) => setF((o) => ({ ...o, [k]: v }));
  const [oldMode] = useState(f.payment_mode); // a mode not in the list stays choosable
  const modes = (OLD_RECEIPT_MODES as readonly string[]).includes(oldMode) ? OLD_RECEIPT_MODES : [...OLD_RECEIPT_MODES, oldMode];

  return (
    <form
      className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await editOldReceipt(p.id, sno, f);
          setR(res);
          if (res.ok) {
            router.refresh();
            onDone(res.message);
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <L label="Amount (₹)" error={err("paid_amount")}>
          <input className={input} inputMode="decimal" value={f.paid_amount} onChange={(e) => set("paid_amount", e.target.value.replace(/[^\d.]/g, ""))} />
        </L>
        <L label="Paid date" error={err("paid_date")}>
          <DateInput className={input} max={todayIST()} value={f.paid_date} onChange={(v) => set("paid_date", v)} />
        </L>
        <L label="Mode" error={err("payment_mode")}>
          <select className={input} value={f.payment_mode} onChange={(e) => set("payment_mode", e.target.value)}>
            {modes.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </L>
        <L label="Receipt no." error={err("receipt_no")}>
          <input className={input} inputMode="numeric" value={f.receipt_no} onChange={(e) => set("receipt_no", e.target.value.replace(/\D/g, ""))} />
        </L>
        {f.payment_mode !== "CASH" && (
          <L label="Cheque / ref no." error={err("cheque_no")}>
            <input className={input} value={f.cheque_no} onChange={(e) => set("cheque_no", e.target.value)} />
          </L>
        )}
      </div>
      <L label="Reason for the change *" error={err("reason")}>
        <input className={input} value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="e.g. amount typed wrong in the old software" />
      </L>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
          {pending ? "Saving…" : "Save change"}
        </button>
        {r && !r.ok && <span className="text-sm text-red-700">{r.error}</span>}
      </div>
    </form>
  );
}

function CancelForm({ p, sno, onDone }: { p: OldReceipt; sno: number; onDone: (m: string) => void }) {
  const router = useRouter();
  const [why, setWhy] = useState("");
  const [sure, setSure] = useState(false);
  const [r, setR] = useState<OldFixResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-red-50 p-3">
      <p className="text-sm text-red-800">
        Cancel receipt #{p.installment_no} of <b>{inr(p.paid_amount)}</b> on {dmy(p.paid_date)}? The balance goes back up by this amount.
      </p>
      <L label="Reason *" error={r && !r.ok ? r.fieldErrors?.reason : undefined}>
        <input className={input} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. entered twice in the old software" />
      </L>
      <label className="flex items-center gap-2 text-sm text-red-900">
        <input type="checkbox" className="h-5 w-5 accent-red-700" checked={sure} onChange={(e) => setSure(e.target.checked)} />
        Yes, cancel this receipt
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || !sure}
          onClick={() =>
            start(async () => {
              const res = await cancelOldReceipt(p.id, sno, why);
              setR(res);
              if (res.ok) {
                router.refresh();
                onDone(res.message);
              }
            })
          }
          className="h-11 rounded-lg bg-red-700 px-5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
        >
          {pending ? "Cancelling…" : "Cancel receipt"}
        </button>
        {r && !r.ok && <span className="text-sm text-red-700">{r.error}</span>}
      </div>
    </div>
  );
}

function L({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error && <span className="mt-1 block text-sm text-red-700">{error}</span>}
    </label>
  );
}

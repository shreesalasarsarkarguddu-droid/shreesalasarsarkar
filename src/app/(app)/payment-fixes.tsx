"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dmy, inr, rcpt } from "@/lib/format";
import { PAYMENT_MODES, chargesText, paymentModeText } from "@/lib/payment";
import { todayIST } from "@/lib/schedule";
import { DateInput } from "@/components/date-input";
import type { NewPaymentRecord } from "@/lib/ledger";
import { cancelPayment, editPayment, type FixResult, type PaymentFixInput } from "./fix-actions";

const input =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";

/** Admin only: the payments taken in this app on one account, each with Edit and Cancel. */
export function PaymentFixes({ payments, path, onChanged }: { payments: NewPaymentRecord[]; path: string; onChanged?: () => void }) {
  const [open, setOpen] = useState<{ id: number; mode: "edit" | "cancel" } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const sorted = [...payments].sort((a, b) => a.installment_no - b.installment_no);
  if (sorted.length === 0) return null;
  return (
    <section className="rounded-xl bg-white ring-1 ring-amber-200">
      <div className="border-b border-amber-100 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">Fix payments taken in this app (admin)</h2>
        <p className="text-xs text-slate-500">
          Change a wrong amount, date, mode or receipt no., or cancel a payment entered by mistake. A reason is required and saved in
          the activity log. Later payments on this account are recalculated.
        </p>
      </div>
      {done && (
        <p role="status" className="mx-4 mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {done}
        </p>
      )}
      <ul className="divide-y divide-slate-100">
        {sorted.map((p) => (
          <li key={p.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="num min-w-0 flex-1 text-sm">
                <b>#{p.installment_no}</b> · <span className="font-semibold text-emerald-700">{inr(p.paid_amount)}</span> · {dmy(p.paid_date)} ·{" "}
                {paymentModeText(p.payment_mode, p.bank_name, p.parts)} · Rcpt {rcpt(p.receipt_no, p.receipt_book)}
                {chargesText(p) && <span className="text-amber-800"> · + {chargesText(p)}</span>}
                {p.installments_covered > 1 && ` · ${p.installments_covered} EMIs`}
              </p>
              <button
                type="button"
                onClick={() => {
                  setDone(null);
                  setOpen(open?.id === p.id && open.mode === "edit" ? null : { id: p.id, mode: "edit" });
                }}
                className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  setDone(null);
                  setOpen(open?.id === p.id && open.mode === "cancel" ? null : { id: p.id, mode: "cancel" });
                }}
                className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-red-700 ring-1 ring-slate-300 hover:bg-red-50"
              >
                Cancel payment
              </button>
            </div>
            {open?.id === p.id && open.mode === "edit" && (
              <EditForm
                p={p}
                path={path}
                onDone={(m) => {
                  setOpen(null);
                  setDone(m);
                  onChanged?.();
                }}
              />
            )}
            {open?.id === p.id && open.mode === "cancel" && (
              <CancelForm
                p={p}
                path={path}
                onDone={(m) => {
                  setOpen(null);
                  setDone(m);
                  onChanged?.();
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

type Part = { mode: (typeof PAYMENT_MODES)[number]; amount: string; bank_name: string; reference_no: string };

function EditForm({ p, path, onDone }: { p: NewPaymentRecord; path: string; onDone: (m: string) => void }) {
  const router = useRouter();
  const [f, setF] = useState<PaymentFixInput>({
    paid_amount: String(Number(p.paid_amount)),
    paid_date: p.paid_date,
    payment_mode: p.payment_mode as PaymentFixInput["payment_mode"],
    receipt_no: String(p.receipt_no),
    reference_no: p.reference_no ?? "",
    bank_name: p.bank_name ?? "",
    installments_covered: String(p.installments_covered),
    reason: "",
    od_amount: String(Number(p.od_amount ?? 0)),
    seize_amount: String(Number(p.seize_amount ?? 0)),
    other_amount: String(Number(p.other_amount ?? 0)),
    other_note: p.other_note ?? "",
  });
  // split: part 1 typed, part 2 = the rest of the amount
  const [parts, setParts] = useState<Part[]>(() =>
    p.parts?.length
      ? p.parts.slice(0, 2).map((x) => ({ mode: x.mode, amount: String(Number(x.amount)), bank_name: x.bank_name ?? "", reference_no: x.reference_no ?? "" }))
      : [
          { mode: "CASH", amount: "", bank_name: "", reference_no: "" },
          { mode: "BANK", amount: "", bank_name: "", reference_no: "" },
        ],
  );
  const [r, setR] = useState<FixResult | null>(null);
  const [pending, start] = useTransition();
  const err = (k: string) => (r && !r.ok ? r.fieldErrors?.[k] : undefined);
  const set = (k: keyof PaymentFixInput, v: string) => setF((o) => ({ ...o, [k]: v }));
  const split = f.payment_mode === "SPLIT";
  const charges = Math.round((Number(f.od_amount || 0) + Number(f.seize_amount || 0) + Number(f.other_amount || 0)) * 100) / 100;
  const rest = Math.round((Number(f.paid_amount || 0) + charges - Number(parts[0].amount || 0)) * 100) / 100;
  const setPart = (i: number, k: keyof Part, v: string) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const splitParts: Part[] = [parts[0], { ...parts[1], amount: rest > 0 ? String(rest) : "" }];

  return (
    <form
      className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await editPayment(p.id, path, split ? { ...f, parts: splitParts, reference_no: "", bank_name: "", charges: String(charges) } : { ...f, charges: String(charges) });
          setR(res);
          if (res.ok) {
            router.refresh();
            onDone(res.message);
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <L label="EMI amount (₹)" error={err("paid_amount")}>
          <input className={input} inputMode="decimal" value={f.paid_amount} onChange={(e) => set("paid_amount", e.target.value.replace(/[^\d.]/g, ""))} />
        </L>
        <L label="Mode" error={err("payment_mode")}>
          <select className={input} value={f.payment_mode} onChange={(e) => set("payment_mode", e.target.value)}>
            {PAYMENT_MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
            <option value="SPLIT">SPLIT (cash + online)</option>
          </select>
        </L>
        <L label="Paid date" error={err("paid_date")}>
          <DateInput className={input} max={todayIST()} value={f.paid_date} onChange={(v) => set("paid_date", v)} />
        </L>
        <L label="Receipt no." error={err("receipt_no")}>
          <input className={input} inputMode="numeric" value={f.receipt_no} onChange={(e) => set("receipt_no", e.target.value.replace(/\D/g, ""))} />
        </L>
        {!split && f.payment_mode !== "CASH" && (
          <L label="Cheque / ref no." error={err("reference_no")}>
            <input className={input} value={f.reference_no} onChange={(e) => set("reference_no", e.target.value)} />
          </L>
        )}
        {f.payment_mode === "BANK" && (
          <L label="Bank name" error={err("bank_name")}>
            <input className={input} value={f.bank_name} onChange={(e) => set("bank_name", e.target.value)} />
          </L>
        )}
        <L label="EMIs covered" error={err("installments_covered")}>
          <input
            className={input}
            inputMode="numeric"
            value={f.installments_covered}
            onChange={(e) => set("installments_covered", e.target.value.replace(/\D/g, ""))}
          />
        </L>
        {/* charges on the same receipt (not in the balance) */}
        <L label={`OD (₹)${p.od_days ? ` · ${p.od_days} days late` : ""}`} error={err("od_amount")}>
          <input className={input} inputMode="decimal" value={f.od_amount} onChange={(e) => set("od_amount", e.target.value.replace(/[^\d.]/g, ""))} />
        </L>
        <L label="Seize charge (₹)" error={err("seize_amount")}>
          <input className={input} inputMode="decimal" value={f.seize_amount} onChange={(e) => set("seize_amount", e.target.value.replace(/[^\d.]/g, ""))} />
        </L>
        <L label="Other charge (₹)" error={err("other_amount")}>
          <input className={input} inputMode="decimal" value={f.other_amount} onChange={(e) => set("other_amount", e.target.value.replace(/[^\d.]/g, ""))} />
        </L>
        {Number(f.other_amount || 0) > 0 && (
          <L label="Other charge is for" error={err("other_note")}>
            <input className={input} maxLength={100} value={f.other_note} onChange={(e) => set("other_note", e.target.value)} />
          </L>
        )}
      </div>

      {split && (
        <div className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-slate-200">
          <p className="text-sm font-medium text-slate-700">Split: part 1 + part 2 = {f.paid_amount ? `₹${Math.round((Number(f.paid_amount) + charges) * 100) / 100}` : "the amount"}{charges > 0 && " (EMI + charges)"}</p>
          {splitParts.map((x, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-4">
              <select className={input} value={x.mode} onChange={(e) => setPart(i, "mode", e.target.value)} aria-label={`Part ${i + 1} mode`}>
                {PAYMENT_MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              {i === 0 ? (
                <input
                  className={input}
                  inputMode="decimal"
                  placeholder="Amount"
                  aria-label="Part 1 amount"
                  value={x.amount}
                  onChange={(e) => setPart(0, "amount", e.target.value.replace(/[^\d.]/g, ""))}
                />
              ) : (
                <p className="num flex h-11 items-center rounded-lg bg-slate-100 px-3 text-base">{rest > 0 ? `₹${rest}` : "—"}</p>
              )}
              {x.mode === "BANK" && (
                <input className={input} placeholder="Bank name" aria-label={`Part ${i + 1} bank`} value={x.bank_name} onChange={(e) => setPart(i, "bank_name", e.target.value)} />
              )}
              {x.mode !== "CASH" && (
                <input
                  className={input}
                  placeholder={x.mode === "CHEQUE" ? "Cheque no." : "Ref no. (optional)"}
                  aria-label={`Part ${i + 1} reference`}
                  value={x.reference_no}
                  onChange={(e) => setPart(i, "reference_no", e.target.value)}
                />
              )}
            </div>
          ))}
          {err("parts") && <p className="text-sm text-red-700">{err("parts")}</p>}
        </div>
      )}

      <L label="Reason for the change *" error={err("reason")}>
        <input className={input} value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="e.g. amount typed wrong" />
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

function CancelForm({ p, path, onDone }: { p: NewPaymentRecord; path: string; onDone: (m: string) => void }) {
  const router = useRouter();
  const [why, setWhy] = useState("");
  const [sure, setSure] = useState(false);
  const [r, setR] = useState<FixResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-red-50 p-3">
      <p className="text-sm text-red-800">
        Cancel receipt <b>{rcpt(p.receipt_no, p.receipt_book)}</b> of <b>{inr(p.paid_amount)}</b> on {dmy(p.paid_date)}? The balance goes back up by this amount.
      </p>
      <L label="Reason *" error={r && !r.ok ? r.fieldErrors?.reason : undefined}>
        <input className={input} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. entered twice" />
      </L>
      <label className="flex items-center gap-2 text-sm text-red-900">
        <input type="checkbox" className="h-5 w-5 accent-red-700" checked={sure} onChange={(e) => setSure(e.target.checked)} />
        Yes, cancel this payment
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || !sure}
          onClick={() =>
            start(async () => {
              const res = await cancelPayment(p.id, path, why);
              setR(res);
              if (res.ok) {
                router.refresh();
                onDone(res.message);
              }
            })
          }
          className="h-11 rounded-lg bg-red-700 px-5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
        >
          {pending ? "Cancelling…" : "Cancel payment"}
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

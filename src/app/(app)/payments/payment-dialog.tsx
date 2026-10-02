"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inr, isPositive } from "@/lib/format";
import { todayIST } from "@/lib/schedule";
import { PAYMENT_MODES } from "@/lib/payment";
import type { Ledger } from "@/lib/ledger";
import { EmiSummary, InstallmentTable } from "../installments";
import { loadLedger, recordPayment, type PaymentField } from "./actions";
import type { PendingRow } from "./collect-list";

type Form = { paid_amount: string; paid_date: string; payment_mode: string; receipt_no: string; reference_no: string };
const emptyForm = (): Form => ({ paid_amount: "", paid_date: todayIST(), payment_mode: "", receipt_no: "", reference_no: "" });

// ---- exact money helpers (paise as bigint, never floats)
function toPaise(v: string): bigint {
  const neg = v.startsWith("-");
  const [i, f = ""] = v.replace("-", "").split(".");
  const p = BigInt(i || "0") * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -p : p;
}
function fromPaise(p: bigint): string {
  const neg = p < 0n;
  const a = neg ? -p : p;
  return `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}
const plain = (p: bigint) => (p % 100n === 0n ? String(p / 100n) : fromPaise(p));

export function PaymentDialog({ row, onClose }: { row: PendingRow; onClose: () => void }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<PaymentField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  // New key per payment attempt: a double-tap or retry of the same attempt can never save twice.
  const [key, setKey] = useState(() => crypto.randomUUID());

  const load = useCallback(async () => {
    setLoadError(null);
    const res = await loadLedger(row.source, row.ref_id);
    if (res.ok) setLedger(res.ledger);
    else setLoadError(res.error);
  }, [row.source, row.ref_id]);

  useEffect(() => {
    dialogRef.current?.showModal();
    document.body.style.overflow = "hidden";
    let alive = true;
    loadLedger(row.source, row.ref_id)
      .then((res) => {
        if (!alive) return;
        if (res.ok) setLedger(res.ledger);
        else setLoadError(res.error);
      })
      .catch(() => alive && setLoadError("Could not load. Check your internet and try again."));
    return () => {
      alive = false;
      document.body.style.overflow = "";
    };
  }, [row.source, row.ref_id]);

  function set<K extends keyof Form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
    setSaved(null);
  }

  function close() {
    if (saving) return;
    dialogRef.current?.close();
    onClose();
    if (savedAny.current) router.refresh();
  }
  const savedAny = useRef(false);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!ledger || saving) return;
    setFormError(null);
    const errs: Partial<Record<PaymentField, string>> = {};
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(form.paid_amount) || toPaise(form.paid_amount) <= 0n) errs.paid_amount = "Enter the amount";
    if (!form.paid_date) errs.paid_date = "Enter the paid date";
    else if (form.paid_date > todayIST()) errs.paid_date = "Paid date cannot be in the future";
    if (!form.payment_mode) errs.payment_mode = "Choose payment mode";
    if (!/^\d{1,12}$/.test(form.receipt_no.trim())) errs.receipt_no = "Enter the receipt number";
    if (Object.keys(errs).length) {
      setErrors(errs);
      document.getElementById(`pay-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    startSaving(async () => {
      try {
        const res = await recordPayment({ source: ledger.source, refId: ledger.refId, idempotencyKey: key, ...form });
        if (!res.ok) {
          setFormError(res.error);
          if (res.fieldErrors) setErrors(res.fieldErrors);
          return;
        }
        savedAny.current = true;
        setSaved(
          `Saved ${inr(fromPaise(toPaise(form.paid_amount)))} · receipt ${res.receiptNo} · installment #${res.installmentNo}` +
            (res.ledger ? ` · new balance ${inr(res.ledger.balance)}` : ""),
        );
        if (res.ledger) setLedger(res.ledger);
        else void load();
        setForm(emptyForm());
        setKey(crypto.randomUUID());
      } catch {
        // Network dropped: pressing Save again reuses the same key, so it cannot double-save.
        setFormError("No connection. Check your internet and press Save again.");
      }
    });
  }

  // Quick amounts
  const quick: { label: string; value: string }[] = [];
  if (ledger) {
    const emi = toPaise(ledger.emi);
    const bal = toPaise(ledger.balance);
    const overdue = ledger.rows.filter((r) => r.status === "overdue").length;
    if (emi > 0n && bal > 0n) quick.push({ label: `1 EMI`, value: plain(emi < bal ? emi : bal) });
    if (overdue > 1 && bal > 0n) {
      const due = emi * BigInt(overdue);
      quick.push({ label: `${overdue} overdue`, value: plain(due < bal ? due : bal) });
    }
    if (bal > 0n) quick.push({ label: "Full balance", value: plain(bal) });
  }
  const over = ledger && form.paid_amount && /^\d+(\.\d{1,2})?$/.test(form.paid_amount) && toPaise(form.paid_amount) > toPaise(ledger.balance);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-labelledby="pay-title"
      className="m-0 h-dvh max-h-none w-full max-w-none bg-slate-100 p-0 backdrop:bg-slate-900/60 md:m-auto md:h-[92dvh] md:w-[min(1200px,96vw)] md:rounded-2xl"
    >
      <div className="flex h-full flex-col">
        {/* header */}
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 md:px-6">
          <div className="min-w-0">
            <h2 id="pay-title" className="truncate text-lg font-bold md:text-xl">
              {ledger?.name ?? row.borrower_name}
            </h2>
            <p className="num truncate text-sm text-slate-500">
              Folio <b className="text-slate-700">{row.folio}</b>
              {ledger?.mobile && (
                <>
                  {" · "}
                  <a href={`tel:${ledger.mobile}`} className="text-blue-700">
                    {ledger.mobile}
                  </a>
                </>
              )}
              {ledger?.father && <> · S/O {ledger.father}</>}
            </p>
            {ledger && (ledger.address || ledger.vehicle) && (
              <p className="truncate text-xs text-slate-500">{[ledger.address, ledger.vehicle].filter(Boolean).join(" · ")}</p>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-2xl text-slate-500 hover:bg-slate-100"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {loadError ? (
            <div className="m-4 rounded-xl bg-white p-6 text-center ring-1 ring-slate-200">
              <p className="font-semibold">{loadError}</p>
              <button onClick={() => void load()} className="mt-4 h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white">
                Try again
              </button>
            </div>
          ) : !ledger ? (
            <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading">
              <div className="h-20 animate-pulse rounded-xl bg-slate-200" />
              <div className="h-64 animate-pulse rounded-xl bg-slate-200" />
            </div>
          ) : (
            <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
              {/* left: totals + installments */}
              <div className="order-2 space-y-4 lg:order-1">
                <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                  <dl className="num grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Total" value={inr(ledger.total)} />
                    <Stat label="Paid" value={inr(ledger.paid)} tone="green" />
                    <Stat label="Balance" value={inr(ledger.balance)} tone={isPositive(ledger.balance) ? "red" : "plain"} />
                    <Stat label="EMI" value={inr(ledger.emi)} />
                  </dl>
                  <div className="mt-3">
                    <EmiSummary rows={ledger.rows} emi={ledger.emi} intervalMonths={ledger.intervalMonths} />
                  </div>
                </section>
                <section className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
                  <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Installments ({ledger.rows.length})
                  </h3>
                  <InstallmentTable rows={ledger.rows} />
                </section>
              </div>

              {/* right: take payment (first on phones) */}
              <form
                onSubmit={save}
                noValidate
                className="order-1 space-y-4 rounded-xl bg-white p-4 ring-1 ring-slate-200 lg:sticky lg:top-0 lg:order-2"
              >
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Take payment</h3>

                {saved && (
                  <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
                    ✓ {saved}
                  </p>
                )}
                {formError && (
                  <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800 ring-1 ring-red-200">
                    {formError}
                  </p>
                )}

                <div>
                  <label htmlFor="pay-paid_amount" className="mb-1 block text-sm font-medium text-slate-700">
                    Amount (₹) <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="pay-paid_amount"
                    inputMode="decimal"
                    autoComplete="off"
                    value={form.paid_amount}
                    onChange={(e) => set("paid_amount", e.target.value.replace(/[^\d.]/g, ""))}
                    aria-invalid={!!errors.paid_amount}
                    className={inputCls(!!errors.paid_amount) + " num text-xl font-semibold"}
                  />
                  {quick.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {quick.map((q) => (
                        <button
                          key={q.label}
                          type="button"
                          onClick={() => set("paid_amount", q.value)}
                          className="num h-10 rounded-full bg-slate-100 px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200"
                        >
                          {q.label} · {inr(q.value)}
                        </button>
                      ))}
                    </div>
                  )}
                  <Err msg={errors.paid_amount} />
                  {over && !errors.paid_amount && <p className="mt-1 text-sm text-amber-700">More than the balance — this will show as overpaid.</p>}
                </div>

                <div>
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Mode <span className="text-red-600">*</span>
                  </span>
                  <div role="radiogroup" aria-label="Payment mode" className="grid grid-cols-4 gap-2">
                    {PAYMENT_MODES.map((m, i) => (
                      <button
                        key={m}
                        id={i === 0 ? "pay-payment_mode" : undefined}
                        type="button"
                        role="radio"
                        aria-checked={form.payment_mode === m}
                        onClick={() => set("payment_mode", m)}
                        className={`h-11 rounded-lg text-sm font-semibold ring-1 ${
                          form.payment_mode === m
                            ? "bg-blue-700 text-white ring-blue-700"
                            : errors.payment_mode
                              ? "bg-white ring-red-500"
                              : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <Err msg={errors.payment_mode} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="pay-receipt_no" className="mb-1 block text-sm font-medium text-slate-700">
                      Receipt no. <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="pay-receipt_no"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={12}
                      value={form.receipt_no}
                      onChange={(e) => set("receipt_no", e.target.value.replace(/\D/g, ""))}
                      aria-invalid={!!errors.receipt_no}
                      className={inputCls(!!errors.receipt_no) + " num"}
                    />
                    <Err msg={errors.receipt_no} />
                  </div>
                  <div>
                    <label htmlFor="pay-paid_date" className="mb-1 block text-sm font-medium text-slate-700">
                      Paid date <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="pay-paid_date"
                      type="date"
                      max={todayIST()}
                      value={form.paid_date}
                      onChange={(e) => set("paid_date", e.target.value)}
                      aria-invalid={!!errors.paid_date}
                      className={inputCls(!!errors.paid_date)}
                    />
                    <Err msg={errors.paid_date} />
                  </div>
                </div>

                {form.payment_mode && form.payment_mode !== "CASH" && (
                  <div>
                    <label htmlFor="pay-reference_no" className="mb-1 block text-sm font-medium text-slate-700">
                      Cheque / UTR no. <span className="font-normal text-slate-400">(optional)</span>
                    </label>
                    <input
                      id="pay-reference_no"
                      autoComplete="off"
                      maxLength={30}
                      value={form.reference_no}
                      onChange={(e) => set("reference_no", e.target.value.toUpperCase())}
                      className={inputCls(!!errors.reference_no)}
                    />
                    <Err msg={errors.reference_no} />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={saving}
                  className="h-12 w-full rounded-xl bg-emerald-700 text-base font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  {saving ? "Saving…" : form.paid_amount ? `Save ${inr(fromPaise(/^\d+(\.\d{1,2})?$/.test(form.paid_amount) ? toPaise(form.paid_amount) : 0n))}` : "Save payment"}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}

const inputCls = (bad: boolean) =>
  `h-12 w-full rounded-lg border bg-white px-3 text-base outline-none focus:ring-2 ${
    bad ? "border-red-500 focus:ring-red-500/20" : "border-slate-300 focus:border-blue-600 focus:ring-blue-600/20"
  }`;

function Err({ msg }: { msg?: string }) {
  return msg ? <p className="mt-1 text-sm text-red-700">{msg}</p> : null;
}

function Stat({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "green" | "red" }) {
  const color = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "text-slate-900";
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-lg font-bold ${color}`}>{value}</dd>
    </div>
  );
}

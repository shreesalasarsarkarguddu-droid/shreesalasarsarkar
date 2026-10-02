"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dmy, inr, isPositive } from "@/lib/format";
import { fromPaise, toPaise, todayIST, type DueRow } from "@/lib/schedule";
import { PAYMENT_MODES } from "@/lib/payment";
import type { Ledger } from "@/lib/ledger";
import { EmiSummary } from "../installments";
import { LedgerCards, LedgerGrid } from "./ledger-grid";
import { loadLedger, recordPayment, type PaymentField } from "./actions";
import type { PendingRow } from "./collect-list";

type Form = {
  paid_amount: string;
  paid_date: string;
  payment_mode: string;
  receipt_no: string;
  reference_no: string;
  bank_name: string;
  installments_covered: string;
};
const emptyForm = (): Form => ({
  paid_amount: "",
  paid_date: todayIST(),
  payment_mode: "",
  receipt_no: "",
  reference_no: "",
  bank_name: "",
  installments_covered: "1",
});
const plain = (p: bigint) => (p % 100n === 0n ? String(p / 100n) : fromPaise(p));
const isAmount = (v: string) => /^\d{1,9}(\.\d{1,2})?$/.test(v);

/**
 * The collection screen: summary, installment list and the payment form.
 * variant "dialog" = big window on computers; "page" = full page on phones (/payments/[source]/[ref]).
 */
export function CollectPanel({
  row,
  initialLedger = null,
  variant,
  onClose,
}: {
  row: PendingRow;
  initialLedger?: Ledger | null;
  variant: "dialog" | "page";
  onClose?: (savedSomething: boolean) => void;
}) {
  const savedAny = useRef(false);
  const [ledger, setLedger] = useState<Ledger | null>(initialLedger);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [imTouched, setImTouched] = useState(false);
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

  const hasInitial = initialLedger != null;
  useEffect(() => {
    if (hasInitial) return;
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
    };
  }, [row.source, row.ref_id, hasInitial]);

  const emi = ledger ? toPaise(ledger.emi) : 0n;
  const dueRows = (ledger?.rows.filter((r) => r.kind === "due") ?? []) as DueRow[];
  const maxIm = Math.max(1, dueRows.length);

  /** EMIs this amount covers by default: round(amount / EMI), between 1 and the EMIs left. */
  function autoIm(amount: string): string {
    if (!isAmount(amount) || emi <= 0n) return "1";
    const n = Number((toPaise(amount) * 2n + emi) / (2n * emi));
    return String(Math.min(maxIm, Math.max(1, n)));
  }

  function set<K extends keyof Form>(k: K, v: string) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "paid_amount" && !imTouched) next.installments_covered = autoIm(v);
      return next;
    });
    setErrors((e) => ({ ...e, [k]: undefined }));
    setSaved(null);
  }

  function stepIm(delta: number) {
    const n = Math.min(maxIm, Math.max(1, (Number(form.installments_covered) || 1) + delta));
    setImTouched(true);
    setForm((f) => ({ ...f, installments_covered: String(n) }));
  }

  function close() {
    if (saving) return;
    onClose?.(savedAny.current);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!ledger || saving) return;
    setFormError(null);
    const errs: Partial<Record<PaymentField, string>> = {};
    if (!isAmount(form.paid_amount) || toPaise(form.paid_amount) <= 0n) errs.paid_amount = "Enter the amount";
    if (!form.paid_date) errs.paid_date = "Enter the paid date";
    else if (form.paid_date > todayIST()) errs.paid_date = "Paid date cannot be in the future";
    if (!form.payment_mode) errs.payment_mode = "Choose payment mode";
    if (!/^\d{1,12}$/.test(form.receipt_no.trim())) errs.receipt_no = "Enter the receipt number";
    if (form.payment_mode === "CHEQUE" && !form.reference_no.trim()) errs.reference_no = "Enter the cheque number";
    if (form.payment_mode === "BANK" && !form.bank_name.trim()) errs.bank_name = "Enter the bank name";
    if (Object.keys(errs).length) {
      setErrors(errs);
      document.getElementById(`pay-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    startSaving(async () => {
      try {
        const res = await recordPayment({
          source: ledger.source,
          refId: ledger.refId,
          idempotencyKey: key,
          ...form,
          installments_covered: Number(form.installments_covered) || 1,
        });
        if (!res.ok) {
          setFormError(res.error);
          if (res.fieldErrors) setErrors(res.fieldErrors);
          return;
        }
        savedAny.current = true;
        setSaved(
          `Saved ${inr(fromPaise(toPaise(form.paid_amount)))} · receipt ${res.receiptNo} · ${form.installments_covered} EMI(s)` +
            (res.ledger ? ` · new balance ${inr(res.ledger.balance)}` : ""),
        );
        if (res.ledger) setLedger(res.ledger);
        else void load();
        setForm(emptyForm());
        setImTouched(false);
        setKey(crypto.randomUUID());
      } catch {
        // Network dropped: pressing Save again reuses the same key, so it cannot double-save.
        setFormError("No connection. Check your internet and press Save again.");
      }
    });
  }

  const bal = ledger ? toPaise(ledger.balance) : 0n;
  const over = ledger && isAmount(form.paid_amount) && toPaise(form.paid_amount) > bal;
  const im = Number(form.installments_covered) || 1;
  const covers = dueRows.slice(0, im);

  return (
      <div className={variant === "dialog" ? "flex h-full flex-col" : "flex flex-col"}>
        {/* header */}
        <header className={`flex items-start justify-between gap-3 bg-white px-4 py-2.5 md:px-5 ${variant === "dialog" ? "border-b border-slate-200" : "rounded-xl ring-1 ring-slate-200"}`}>
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
          {variant === "dialog" && (
          <button
            type="button"
            data-close
            onClick={close}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-2xl text-slate-500 hover:bg-slate-100"
          >
            ×
          </button>
          )}
        </header>

        <div className={variant === "dialog" ? "min-h-0 flex-1 overflow-y-auto lg:overflow-hidden" : ""}>
          {loadError ? (
            <div className="m-4 rounded-xl bg-white p-6 text-center ring-1 ring-slate-200">
              <p className="font-semibold">{loadError}</p>
              <button onClick={() => void load()} className="mt-4 h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white">
                Try again
              </button>
            </div>
          ) : !ledger ? (
            <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading">
              <div className="h-16 animate-pulse rounded-xl bg-slate-200" />
              <div className="h-64 animate-pulse rounded-xl bg-slate-200" />
            </div>
          ) : (
            <div className={`grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_340px] ${variant === "dialog" ? "p-3 md:p-4 lg:h-full" : "pt-3"}`}>
              {/* left: summary + grid (grid scrolls inside; totals row stays visible) */}
              <div className="order-2 flex min-h-0 flex-col gap-3 lg:order-1">
                <section className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                  <dl className="num grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Stat label="Total" value={inr(ledger.total)} />
                    <Stat label="Paid" value={inr(ledger.paid)} tone="green" />
                    <Stat label="Balance" value={inr(ledger.balance)} tone={isPositive(ledger.balance) ? "red" : "plain"} />
                    <Stat label="EMI" value={inr(ledger.emi)} />
                    <Stat label="Total due days" value={String(ledger.summary.totalDueDays)} tone={ledger.summary.totalDueDays > 0 ? "red" : "plain"} />
                  </dl>
                  <div className="mt-2">
                    <EmiSummary summary={ledger.summary} emi={ledger.emi} intervalMonths={ledger.intervalMonths} />
                  </div>
                </section>
                <section className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 md:hidden">
                  <LedgerCards rows={ledger.rows} summary={ledger.summary} />
                </section>
                <section
                  className={`hidden min-h-0 overflow-auto rounded-xl bg-white ring-1 ring-slate-200 md:block ${
                    variant === "dialog" ? "md:h-[65dvh] lg:h-auto lg:flex-1" : "md:max-h-[75dvh]"
                  }`}
                >
                  <LedgerGrid rows={ledger.rows} summary={ledger.summary} />
                </section>
              </div>

              {/* right: take payment (first on phones) */}
              <form
                onSubmit={save}
                noValidate
                className="order-1 space-y-4 self-start rounded-xl bg-white p-4 ring-1 ring-slate-200 lg:order-2 lg:max-h-full lg:overflow-y-auto"
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

                {/* amount, then 1 EMI, then full balance */}
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
                  {bal > 0n && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {emi > 0n && (
                        <QuickButton label="1 EMI" amount={inr(fromPaise(emi < bal ? emi : bal))} onClick={() => set("paid_amount", plain(emi < bal ? emi : bal))} />
                      )}
                      <QuickButton label="Full balance" amount={inr(ledger.balance)} onClick={() => set("paid_amount", plain(bal))} />
                    </div>
                  )}
                  <Err msg={errors.paid_amount} />
                  {over && !errors.paid_amount && <p className="mt-1 text-sm text-amber-700">More than the balance — this will show as overpaid.</p>}
                </div>

                {/* EMIs covered (old software's IM) */}
                <div>
                  <span className="mb-1 block text-sm font-medium text-slate-700">EMIs covered by this payment</span>
                  <div className="flex items-center gap-2">
                    <StepButton label="One less EMI" disabled={im <= 1} onClick={() => stepIm(-1)}>
                      −
                    </StepButton>
                    <span className="num w-12 text-center text-xl font-bold" aria-live="polite">
                      {im}
                    </span>
                    <StepButton label="One more EMI" disabled={im >= maxIm} onClick={() => stepIm(1)}>
                      +
                    </StepButton>
                    <span className="min-w-0 flex-1 text-xs leading-tight text-slate-500">
                      {covers.length > 0 ? (
                        <>
                          EMI #{covers[0].sno}
                          {covers.length > 1 && <>–#{covers[covers.length - 1].sno}</>}
                          <br />
                          due {dmy(covers[0].dueDate)}
                          {covers.length > 1 && <> – {dmy(covers[covers.length - 1].dueDate)}</>}
                        </>
                      ) : (
                        "No EMIs left"
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">EMI stays {inr(ledger.emi)}. Any extra or short amount stays in the balance.</p>
                </div>

                <div>
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Mode <span className="text-red-600">*</span>
                  </span>
                  <div role="radiogroup" aria-label="Payment mode" className="grid grid-cols-4 gap-1.5">
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

                {form.payment_mode === "BANK" && (
                  <TextField id="bank_name" label="Bank name" required value={form.bank_name} error={errors.bank_name} onChange={(v) => set("bank_name", v.toUpperCase())} />
                )}
                {form.payment_mode === "CHEQUE" && (
                  <TextField id="reference_no" label="Cheque no." required value={form.reference_no} error={errors.reference_no} onChange={(v) => set("reference_no", v.toUpperCase())} />
                )}
                {(form.payment_mode === "SBI" || form.payment_mode === "BANK") && (
                  <TextField id="reference_no" label="UTR / reference no." value={form.reference_no} error={errors.reference_no} onChange={(v) => set("reference_no", v.toUpperCase())} />
                )}

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

                <button
                  type="submit"
                  disabled={saving}
                  className="h-12 w-full rounded-xl bg-emerald-700 text-base font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  {saving ? "Saving…" : isAmount(form.paid_amount) ? `Save ${inr(fromPaise(toPaise(form.paid_amount)))}` : "Save payment"}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
  );
}

/** Computers: CollectPanel in a large window. */
export function PaymentDialog({ row, onClose }: { row: PendingRow; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        ref.current?.querySelector<HTMLButtonElement>("[data-close]")?.click();
      }}
      aria-labelledby="pay-title"
      className="m-0 h-dvh max-h-none w-full max-w-none bg-slate-100 p-0 backdrop:bg-slate-900/60 md:m-auto md:h-[96dvh] md:w-[98vw] md:rounded-2xl"
    >
      <CollectPanel
        row={row}
        variant="dialog"
        onClose={(saved) => {
          ref.current?.close();
          onClose();
          if (saved) router.refresh();
        }}
      />
    </dialog>
  );
}

const inputCls = (bad: boolean) =>
  `h-12 w-full rounded-lg border bg-white px-3 text-base outline-none focus:ring-2 ${
    bad ? "border-red-500 focus:ring-red-500/20" : "border-slate-300 focus:border-blue-600 focus:ring-blue-600/20"
  }`;

function QuickButton({ label, amount, onClick }: { label: string; amount: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="num flex min-h-12 flex-col items-center justify-center rounded-lg bg-slate-100 px-2 py-1 leading-tight ring-1 ring-slate-200 hover:bg-slate-200"
    >
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-800">{amount}</span>
    </button>
  );
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-xl font-bold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function TextField({ id, label, required, value, error, onChange }: { id: PaymentField; label: string; required?: boolean; value: string; error?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={`pay-${id}`} className="mb-1 block text-sm font-medium text-slate-700">
        {label} {required ? <span className="text-red-600">*</span> : <span className="font-normal text-slate-400">(optional)</span>}
      </label>
      <input
        id={`pay-${id}`}
        autoComplete="off"
        maxLength={id === "bank_name" ? 60 : 30}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        className={inputCls(!!error)}
      />
      <Err msg={error} />
    </div>
  );
}

function Err({ msg }: { msg?: string }) {
  return msg ? <p className="mt-1 text-sm text-red-700">{msg}</p> : null;
}

function Stat({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "green" | "red" }) {
  const color = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "text-slate-900";
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-base font-bold md:text-lg ${color}`}>{value}</dd>
    </div>
  );
}

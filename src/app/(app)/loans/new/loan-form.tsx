"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EMPTY_LOAN, STEPS, calcLoan, loanSchema, paiseToString, type LoanFields } from "@/lib/loan";
import { inr } from "@/lib/format";
import { createLoan } from "./actions";

type Values = Record<LoanFields, string>;
type Errors = Partial<Record<LoanFields, string>>;

const STEP_TITLES = ["Borrower & guarantor", "Vehicle", "Finance"] as const;
const STEP_FIELDS = STEPS.map((s) => Object.keys(s.shape) as LoanFields[]);
const REQUIRED = new Set<LoanFields>([
  "folio_no", "loan_type", "borrower_name", "borrower_father", "borrower_mobile", "borrower_address",
  "vehicle_condition", "vehicle_model",
  "agreement_date", "installments", "interval_months", "finance_amount", "interest_rate",
]);

function validate(step: number, values: Values): Errors {
  const res = STEPS[step].safeParse(values);
  if (res.success) return {};
  const errors: Errors = {};
  for (const i of res.error.issues) errors[i.path[0] as LoanFields] ??= i.message;
  return errors;
}

export function LoanForm() {
  const router = useRouter();
  const [values, setValues] = useState<Values>(EMPTY_LOAN);
  const [errors, setErrors] = useState<Errors>({});
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // One key per form: a double-click, retry or network replay can never create a second loan.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const topRef = useRef<HTMLDivElement>(null);
  const dirty = useMemo(() => Object.values(values).some((v) => v !== ""), [values]);
  const calc = useMemo(() => calcLoan(values), [values]);

  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);

  function set(name: LoanFields, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  }

  function goTo(next: number) {
    setStep(next);
    setMaxStep((m) => Math.max(m, next));
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function focusFirstError(errs: Errors) {
    const first = Object.keys(errs)[0];
    if (first) requestAnimationFrame(() => document.getElementById(first)?.focus());
  }

  function next() {
    const errs = validate(step, values);
    setErrors(errs);
    if (Object.keys(errs).length) return focusFirstError(errs);
    goTo(step + 1);
  }

  function submit() {
    setFormError(null);
    // Check every step; jump to the first one with a problem.
    for (let s = 0; s < STEPS.length; s++) {
      const errs = validate(s, values);
      if (Object.keys(errs).length) {
        setErrors(errs);
        setStep(s);
        return focusFirstError(errs);
      }
    }
    if (!loanSchema.safeParse(values).success) return;
    startTransition(async () => {
      try {
        const res = await createLoan(idempotencyKey, values);
        if (res.ok) {
          router.replace(`/loans/${res.id}?saved=1`);
          return;
        }
        setFormError(res.error);
        if (res.fieldErrors) {
          setErrors(res.fieldErrors);
          const s = STEP_FIELDS.findIndex((f) => f.some((k) => res.fieldErrors?.[k]));
          if (s >= 0) setStep(s);
          focusFirstError(res.fieldErrors);
        }
      } catch {
        // Network dropped: safe to press Save again - the same key prevents a duplicate.
        setFormError("No connection. Check your internet and press Save again.");
      }
    });
  }

  const field = (name: LoanFields, label: string, extra?: Partial<InputProps>) => (
    <Field name={name} label={label} value={values[name]} error={errors[name]} required={REQUIRED.has(name)} onChange={set} {...extra} />
  );

  return (
    <div ref={topRef} className="scroll-mt-20">
      <header className="mb-4">
        <h1 className="text-xl font-bold sm:text-2xl">New loan</h1>
        <p className="text-sm text-slate-500">Fields marked * are required</p>
      </header>

      {/* stepper */}
      <ol className="mb-4 grid grid-cols-3 gap-2" aria-label="Steps">
        {STEP_TITLES.map((title, i) => {
          const state = i === step ? "current" : i <= maxStep ? "done" : "todo";
          return (
            <li key={title}>
              <button
                type="button"
                disabled={i > maxStep || pending}
                onClick={() => goTo(i)}
                aria-current={i === step ? "step" : undefined}
                className={`flex w-full flex-col items-start rounded-xl px-3 py-2 text-left ring-1 transition-colors sm:flex-row sm:items-center sm:gap-2 ${
                  state === "current"
                    ? "bg-blue-700 text-white ring-blue-700"
                    : state === "done"
                      ? "bg-white text-slate-800 ring-slate-300 hover:bg-slate-50"
                      : "bg-slate-50 text-slate-400 ring-slate-200"
                }`}
              >
                <span className={`text-xs font-bold ${state === "current" ? "text-blue-100" : ""}`}>Step {i + 1}</span>
                <span className="text-sm font-semibold leading-tight">{title}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (step < STEPS.length - 1) next();
            else submit();
          }}
          className="space-y-4"
        >
          {formError && (
            <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800 ring-1 ring-red-200">
              {formError}
            </p>
          )}

          {step === 0 && (
            <>
              <Section title="Folio">
                {field("folio_no", "Folio no.", { autoCapitalize: "characters" })}
                {field("zone", "Zone")}
                {field("dealer", "Dealer / financer")}
                <Choice
                  name="loan_type"
                  label="Loan type"
                  value={values.loan_type}
                  error={errors.loan_type}
                  options={[["CASH", "Cash"], ["BANK", "Bank"]]}
                  onChange={set}
                />
              </Section>
              <Section title="Borrower">
                {field("borrower_name", "Full name", { autoComplete: "off" })}
                {field("borrower_father", "Father's / husband's name")}
                {field("borrower_mobile", "Mobile", { inputMode: "numeric", maxLength: 10, autoComplete: "off" })}
                {field("borrower_dob", "Date of birth", { type: "date" })}
                {field("borrower_address", "Address", { multiline: true, wide: true })}
              </Section>
              <Section title="Guarantor" note="Optional">
                {field("guarantor_name", "Name")}
                {field("guarantor_father", "Father's name")}
                {field("guarantor_mobile", "Mobile", { inputMode: "numeric", maxLength: 10 })}
                {field("guarantor_address", "Address", { multiline: true, wide: true })}
              </Section>
            </>
          )}

          {step === 1 && (
            <>
              <Section title="Vehicle">
                <Choice
                  name="vehicle_condition"
                  label="Condition"
                  value={values.vehicle_condition}
                  error={errors.vehicle_condition}
                  options={[["NEW", "New"], ["USED", "Used"]]}
                  onChange={set}
                />
                {field("vehicle_model", "Model")}
                {field("vehicle_color", "Colour")}
                {field("sold_by", "Sold by (dealer)")}
              </Section>
              <Section title="Identification">
                {field("vehicle_no", "Vehicle no.", { autoCapitalize: "characters", placeholder: "CG05AB1234" })}
                {field("chassis_no", "Chassis no.", { autoCapitalize: "characters" })}
                {field("engine_no", "Engine no.", { autoCapitalize: "characters" })}
                {field("make_year", "Make year", { inputMode: "numeric", maxLength: 4 })}
                {field("insurance_expiry", "Insurance expiry", { type: "date" })}
              </Section>
            </>
          )}

          {step === 2 && (
            <>
              <Section title="Finance terms">
                {field("agreement_date", "Agreement date", { type: "date" })}
                {field("finance_amount", "Finance amount (₹)", { inputMode: "decimal" })}
                {field("interest_rate", "Interest rate (% per year)", { inputMode: "decimal" })}
                {field("installments", "No. of installments", { inputMode: "numeric", maxLength: 3 })}
                {field("interval_months", "Every … months", { inputMode: "numeric", maxLength: 2, hint: "1 = monthly" })}
                {field("agreement_amount", "Agreement amount (₹)", { inputMode: "decimal", hint: "Leave blank if none" })}
                {field("hp_amount", "Hire purchase / RTO (₹)", { inputMode: "decimal", hint: "Leave blank if none" })}
              </Section>
              <section className="rounded-xl bg-blue-50 p-4 ring-1 ring-blue-200 lg:hidden">
                <Totals values={values} calc={calc} />
              </section>
            </>
          )}

          {/* actions: sticky above the bottom nav on phones */}
          <div className="sticky bottom-16 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:rounded-xl md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
            <div className="flex items-center gap-3">
              {step > 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => goTo(step - 1)}
                  className="h-12 rounded-xl bg-white px-5 text-base font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
                >
                  Back
                </button>
              )}
              {step === 2 && calc && (
                <span className="num min-w-0 flex-1 truncate text-sm text-slate-600 md:hidden">
                  EMI <b className="text-slate-900">{inr(paiseToString(calc.emi))}</b>
                </span>
              )}
              <button
                type="submit"
                disabled={pending}
                className={`ml-auto h-12 min-w-32 rounded-xl px-6 text-base font-semibold text-white disabled:opacity-60 ${
                  step === 2 ? "bg-emerald-700 hover:bg-emerald-800" : "bg-blue-700 hover:bg-blue-800"
                }`}
              >
                {step < 2 ? "Next" : pending ? "Saving…" : "Save loan"}
              </button>
            </div>
          </div>
        </form>

        {/* live summary (desktop) */}
        <aside className="sticky top-20 hidden space-y-4 rounded-xl bg-white p-4 ring-1 ring-slate-200 lg:block">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</h2>
          <dl className="space-y-1.5 text-sm">
            <Row label="Folio" value={values.folio_no.toUpperCase()} />
            <Row label="Borrower" value={values.borrower_name.toUpperCase()} />
            <Row label="Mobile" value={values.borrower_mobile} />
            <Row label="Vehicle" value={[values.vehicle_model, values.vehicle_no].filter(Boolean).join(" · ").toUpperCase()} />
            <Row label="Type" value={values.loan_type} />
          </dl>
          <div className="border-t border-slate-100 pt-3">
            <Totals values={values} calc={calc} />
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function Totals({ values, calc }: { values: Values; calc: ReturnType<typeof calcLoan> }) {
  return (
    <dl className="num space-y-1.5 text-sm">
      <Row label="Finance amount" value={values.finance_amount ? inr(values.finance_amount) : ""} />
      <Row label="Interest" value={calc ? inr(paiseToString(calc.interest)) : ""} sub={calc && values.interest_rate ? `${values.interest_rate}% × ${calc.months} months` : undefined} />
      {values.agreement_amount && <Row label="Agreement" value={inr(values.agreement_amount)} />}
      {values.hp_amount && <Row label="HP / RTO" value={inr(values.hp_amount)} />}
      <div className="flex items-baseline justify-between gap-3 border-t border-slate-200 pt-2">
        <dt className="font-semibold">Total payable</dt>
        <dd className="text-lg font-bold">{calc ? inr(paiseToString(calc.total)) : "—"}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="font-semibold text-blue-800">EMI</dt>
        <dd className="text-lg font-bold text-blue-800">
          {calc ? inr(paiseToString(calc.emi)) : "—"}
          {calc && (
            <span className="block text-right text-xs font-normal text-slate-500">
              × {values.installments}
              {values.interval_months !== "1" ? `, every ${values.interval_months} months` : " months"}
            </span>
          )}
        </dd>
      </div>
    </dl>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">
        {value || <span className="text-slate-300">—</span>}
        {sub && <span className="block text-xs font-normal text-slate-500">{sub}</span>}
      </dd>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:p-5">
      <legend className="float-left mb-3 w-full text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
        {note && <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">{note}</span>}
      </legend>
      <div className="clear-both grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </fieldset>
  );
}

type InputProps = {
  type: "text" | "date";
  inputMode: "text" | "numeric" | "decimal";
  maxLength: number;
  placeholder: string;
  autoComplete: string;
  autoCapitalize: string;
  hint: string;
  multiline: boolean;
  wide: boolean;
};

function Field({
  name, label, value, error, required, onChange,
  type = "text", inputMode, maxLength, placeholder, autoComplete, autoCapitalize = "words", hint, multiline, wide,
}: { name: LoanFields; label: string; value: string; error?: string; required: boolean; onChange: (n: LoanFields, v: string) => void } & Partial<InputProps>) {
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;
  const cls = `w-full rounded-lg border bg-white px-3 text-base outline-none focus:ring-2 ${
    error ? "border-red-500 focus:ring-red-500/20" : "border-slate-300 focus:border-blue-600 focus:ring-blue-600/20"
  }`;
  return (
    <label className={`block ${wide ? "sm:col-span-2 xl:col-span-3" : ""}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      {multiline ? (
        <textarea
          id={name}
          name={name}
          rows={2}
          value={value}
          onChange={(e) => onChange(name, e.target.value)}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={`${cls} py-2.5 uppercase`}
        />
      ) : (
        <input
          id={name}
          name={name}
          type={type}
          inputMode={inputMode}
          maxLength={maxLength}
          placeholder={placeholder}
          autoComplete={autoComplete ?? "off"}
          autoCapitalize={autoCapitalize}
          value={value}
          onChange={(e) => {
            const v = inputMode === "numeric" ? e.target.value.replace(/\D/g, "") : inputMode === "decimal" ? e.target.value.replace(/[^\d.]/g, "") : e.target.value;
            onChange(name, v);
          }}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={`${cls} h-12 ${type === "text" && !inputMode ? "uppercase" : ""}`}
        />
      )}
      {error ? (
        <span id={`${name}-error`} className="mt-1 block text-sm text-red-700">
          {error}
        </span>
      ) : hint ? (
        <span id={`${name}-hint`} className="mt-1 block text-xs text-slate-500">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function Choice({
  name, label, value, error, options, onChange,
}: { name: LoanFields; label: string; value: string; error?: string; options: [string, string][]; onChange: (n: LoanFields, v: string) => void }) {
  return (
    <div role="radiogroup" aria-labelledby={`${name}-label`} aria-describedby={error ? `${name}-error` : undefined}>
      <span id={`${name}-label`} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        <span className="text-red-600"> *</span>
      </span>
      <div className="grid grid-cols-2 gap-2">
        {options.map(([v, text], i) => (
          <button
            key={v}
            id={i === 0 ? name : undefined}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(name, v)}
            className={`h-12 rounded-lg text-base font-semibold ring-1 transition-colors ${
              value === v
                ? "bg-blue-700 text-white ring-blue-700"
                : error
                  ? "bg-white text-slate-700 ring-red-500"
                  : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
      {error && (
        <span id={`${name}-error`} className="mt-1 block text-sm text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}

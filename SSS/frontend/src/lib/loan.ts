// Shared by the New Loan form (instant preview + per-step checks) and the server action
// (final validation). The database function public.loan_amounts() is the source of truth
// for saved amounts; calcLoan() below implements the identical formula for the preview.
import { z } from "zod";

// ---------------------------------------------------------------- field helpers
const req = (label: string, max = 120) =>
  z.string().trim().min(1, { error: `Enter ${label}` }).max(max, { error: `${label} is too long` }).transform((v) => v.toUpperCase());
const opt = (max = 250) =>
  z.string().trim().max(max, { error: "Too long" }).transform((v) => (v ? v.toUpperCase() : null));
const mobileReq = z.string().trim().regex(/^[6-9]\d{9}$/, { error: "Enter a valid 10-digit mobile number" });
const mobileOpt = z
  .string()
  .trim()
  .refine((v) => v === "" || /^[6-9]\d{9}$/.test(v), { error: "Enter a valid 10-digit mobile number" })
  .transform((v) => v || null);

function isRealDate(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
const dateReq = (label: string) => z.string().refine(isRealDate, { error: `Enter ${label}` });
const dateOpt = z
  .string()
  .refine((v) => v === "" || isRealDate(v), { error: "Enter a valid date" })
  .transform((v) => v || null);

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const moneyReq = (label: string) =>
  z.string().trim().regex(MONEY, { error: `Enter ${label} (numbers only, up to 2 decimals)` }).refine((v) => Number(v) > 0, { error: `${label} must be more than 0` });
const moneyOpt = z
  .string()
  .trim()
  .refine((v) => v === "" || MONEY.test(v), { error: "Numbers only, up to 2 decimals" })
  .transform((v) => v || "0");
const intIn = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, { error: `Enter ${label}` })
    .refine((v) => Number(v) >= min && Number(v) <= max, { error: `${label} must be ${min}–${max}` });

// ---------------------------------------------------------------- schema (3 steps)
export const step1 = z.object({
  folio_no: req("folio no.", 30),
  zone: opt(60),
  dealer: opt(80),
  loan_type: z.enum(["CASH", "BANK"], { error: "Choose loan type" }),
  borrower_name: req("full name"),
  borrower_father: req("father's name"),
  borrower_mobile: mobileReq,
  borrower_dob: dateOpt,
  borrower_address: req("address", 300),
  guarantor_name: opt(120),
  guarantor_father: opt(120),
  guarantor_mobile: mobileOpt,
  guarantor_address: opt(300),
});

const thisYear = new Date().getFullYear();
export const step2 = z.object({
  vehicle_condition: z.enum(["NEW", "USED"], { error: "Choose new or used" }),
  sold_by: opt(80),
  vehicle_model: req("model", 60),
  vehicle_color: opt(40),
  chassis_no: opt(40),
  engine_no: opt(40),
  make_year: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{4}$/.test(v) && Number(v) >= 1980 && Number(v) <= thisYear + 1), {
      error: `Year must be 1980–${thisYear + 1}`,
    })
    .transform((v) => (v ? Number(v) : null)),
  vehicle_no: opt(20),
  insurance_expiry: dateOpt,
});

export const step3 = z.object({
  agreement_date: dateReq("agreement date"),
  installments: intIn("number of installments", 1, 360),
  interval_months: intIn("interval", 1, 12),
  finance_amount: moneyReq("finance amount"),
  interest_rate: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, { error: "Enter interest rate % (up to 2 decimals)" })
    .refine((v) => Number(v) <= 100, { error: "Rate must be 100% or less" }),
  agreement_amount: moneyOpt,
  hp_amount: moneyOpt,
});

export const loanSchema = z.object({ ...step1.shape, ...step2.shape, ...step3.shape });
export const STEPS = [step1, step2, step3] as const;

export type LoanInput = z.input<typeof loanSchema>;
export type LoanFields = keyof LoanInput;
export const EMPTY_LOAN: Record<LoanFields, string> = Object.fromEntries(
  Object.keys(loanSchema.shape).map((k) => [k, ""]),
) as Record<LoanFields, string>;

// ---------------------------------------------------------------- money maths (integer paise)
function toPaise(v: string): bigint | null {
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
}
function toHundredths(v: string): bigint | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
}
/** paise -> "1234.50" (string for inr()) */
export function paiseToString(p: bigint): string {
  const neg = p < 0n;
  const a = neg ? -p : p;
  return `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}

export type LoanCalc = { interest: bigint; total: bigint; emi: bigint; months: number };

/**
 * Same formula as public.loan_amounts() in the database:
 *   interest = principal x rate% x (installments x interval) / 12, rounded to the nearest rupee
 *   total    = principal + interest + agreement + hp
 *   emi      = total / installments, rounded UP to the next rupee
 * Returns null until the inputs are complete and valid.
 */
export function calcLoan(v: Pick<Record<LoanFields, string>, "finance_amount" | "interest_rate" | "installments" | "interval_months" | "agreement_amount" | "hp_amount">): LoanCalc | null {
  const principal = toPaise(v.finance_amount);
  const rate = toHundredths(v.interest_rate);
  const inst = /^\d{1,3}$/.test(v.installments.trim()) ? BigInt(v.installments.trim()) : 0n;
  const interval = /^\d{1,2}$/.test(v.interval_months.trim()) ? BigInt(v.interval_months.trim()) : 0n;
  const agreement = v.agreement_amount.trim() === "" ? 0n : toPaise(v.agreement_amount);
  const hp = v.hp_amount.trim() === "" ? 0n : toPaise(v.hp_amount);
  if (principal == null || principal <= 0n || rate == null || inst < 1n || interval < 1n || agreement == null || hp == null) return null;

  const months = inst * interval;
  // principal(paise) * rate(hundredths of %) * months / (100 * 100 * 12) = paise; /100 more = rupees
  const num = principal * rate * months;
  const den = 12_000_000n;
  const interestRupees = (num * 2n + den) / (2n * den); // round half up (all values positive)
  const interest = interestRupees * 100n;
  const total = principal + interest + agreement + hp;
  const step = inst * 100n;
  const emi = ((total + step - 1n) / step) * 100n; // ceil to whole rupee
  return { interest, total, emi, months: Number(months) };
}

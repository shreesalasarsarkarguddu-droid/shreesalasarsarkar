import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSchedule, type PaymentRow, type ScheduleRow } from "@/lib/schedule";

export const NEW_PAYMENT_COLUMNS =
  "id, installment_no, due_date, paid_date, delay_days, payment_mode, reference_no, receipt_no," +
  " due_amount::text, paid_amount::text, balance_after::text";

export type NewPaymentRecord = {
  id: number;
  installment_no: number;
  due_date: string | null;
  paid_date: string;
  delay_days: number | null;
  payment_mode: string;
  reference_no: string | null;
  receipt_no: number;
  due_amount: string | null;
  paid_amount: string;
  balance_after: string;
};

/** A new-system payment in the same shape as legacy payment rows. */
export function mapNewPayment(p: NewPaymentRecord): PaymentRow {
  return {
    id: -p.id, // negative: never collides with legacy payment ids in React keys
    installment_no: p.installment_no,
    due_amount: p.due_amount,
    due_date: p.due_date,
    paid_amount: p.paid_amount,
    paid_date: p.paid_date,
    balance_after: p.balance_after,
    delay_days: p.delay_days,
    payment_mode: p.payment_mode,
    cheque_no: p.reference_no,
    receipt_no: p.receipt_no,
    data_flags: [],
  };
}

export const LEGACY_PAYMENT_COLUMNS =
  "id, ledger, installment_no, due_date, paid_date, delay_days, payment_mode, cheque_no, receipt_no, data_flags," +
  " due_amount::text, paid_amount::text, balance_after::text";

/** Exact money: a + sum(list) and a - b on "1234.50" strings (paise bigint inside). */
export function addMoney(base: string, list: string[]): string {
  return fromPaise(list.reduce((t, v) => t + toPaise(v), toPaise(base)));
}
export function subMoney(a: string, b: string): string {
  return fromPaise(toPaise(a) - toPaise(b));
}
export const byInstallment = <T extends { installment_no: number }>(a: T, b: T) => a.installment_no - b.installment_no;

export type Ledger = {
  source: "old" | "new";
  refId: number;
  folio: string;
  name: string;
  father: string | null;
  mobile: string | null;
  address: string | null;
  vehicle: string | null;
  total: string;
  interest: string; // loan interest amount, used to split each payment into principal / interest
  emi: string;
  installments: number | null;
  intervalMonths: number | null;
  paid: string;
  balance: string;
  rows: ScheduleRow[];
};

/** Everything the Collect Payment window needs for one pending account. RLS applies. */
export async function getLedger(supabase: SupabaseClient, source: "old" | "new", refId: number): Promise<Ledger | null> {
  if (source === "old") {
    // One request: account + its legacy payments + its new-system payments.
    const { data: a, error } = await supabase
      .from("legacy_accounts")
      .select(
        "id, sno, fno, ledger, borrower_name, borrower_father, borrower_mobile, borrower_address, registration_no, vehicle_model," +
          " agreement_date, tenure_months, interval_months, total_amount::text, emi_amount::text, interest_amount::text, legacy_paid::text," +
          ` legacy_payments(${LEGACY_PAYMENT_COLUMNS}), payments(${NEW_PAYMENT_COLUMNS})`,
      )
      .eq("sno", refId)
      .eq("ledger", "pending")
      .maybeSingle();
    if (error) throw new Error("Could not load account.");
    if (!a) return null;
    const acc = a as unknown as {
      id: number; sno: number; fno: number; ledger: string; borrower_name: string; borrower_father: string | null; borrower_mobile: string | null;
      borrower_address: string | null; registration_no: string | null; vehicle_model: string | null; agreement_date: string | null;
      tenure_months: number | null; interval_months: number | null; total_amount: string; emi_amount: string; interest_amount: string;
      legacy_paid: string; legacy_payments: (PaymentRow & { ledger: string })[]; payments: NewPaymentRecord[];
    };
    const fresh = acc.payments.map(mapNewPayment);
    const payments = [...acc.legacy_payments.filter((p) => p.ledger === acc.ledger), ...fresh].sort(byInstallment);
    const paid = addMoney(acc.legacy_paid, fresh.map((p) => p.paid_amount));
    return {
      source, refId, folio: String(acc.fno), name: acc.borrower_name, father: acc.borrower_father, mobile: acc.borrower_mobile,
      address: acc.borrower_address, vehicle: [acc.vehicle_model, acc.registration_no].filter(Boolean).join(" · ") || null,
      total: acc.total_amount, interest: acc.interest_amount, emi: acc.emi_amount, installments: acc.tenure_months, intervalMonths: acc.interval_months,
      paid, balance: subMoney(acc.total_amount, paid),
      rows: buildSchedule({ installments: acc.tenure_months, intervalMonths: acc.interval_months, agreementDate: acc.agreement_date, emi: acc.emi_amount, payments }),
    };
  }

  const { data: l, error } = await supabase
    .from("loans")
    .select(
      "id, folio_no, vehicle_model, vehicle_no, agreement_date, installments, interval_months, total_amount::text, emi_amount::text, interest_amount::text," +
        ` borrowers(full_name, father_name, mobile, address), payments(${NEW_PAYMENT_COLUMNS})`,
    )
    .eq("id", refId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error("Could not load loan.");
  if (!l) return null;
  const loan = l as unknown as {
    id: number; folio_no: string; vehicle_model: string; vehicle_no: string | null; agreement_date: string;
    installments: number; interval_months: number; total_amount: string; emi_amount: string; interest_amount: string;
    borrowers: { full_name: string; father_name: string | null; mobile: string | null; address: string | null };
    payments: NewPaymentRecord[];
  };
  const payments = loan.payments.map(mapNewPayment).sort(byInstallment);
  const paidPaise = payments.reduce((t, p) => t + toPaise(p.paid_amount), 0n);
  return {
    source, refId, folio: loan.folio_no, name: loan.borrowers.full_name, father: loan.borrowers.father_name,
    mobile: loan.borrowers.mobile, address: loan.borrowers.address,
    vehicle: [loan.vehicle_model, loan.vehicle_no].filter(Boolean).join(" · ") || null,
    total: loan.total_amount, interest: loan.interest_amount, emi: loan.emi_amount, installments: loan.installments, intervalMonths: loan.interval_months,
    paid: fromPaise(paidPaise), balance: fromPaise(toPaise(loan.total_amount) - paidPaise),
    rows: buildSchedule({ installments: loan.installments, intervalMonths: loan.interval_months, agreementDate: loan.agreement_date, emi: loan.emi_amount, payments }),
  };
}

function toPaise(v: string): bigint {
  const neg = v.startsWith("-");
  const [i, f = ""] = v.replace("-", "").split(".");
  const p = BigInt(i) * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -p : p;
}
function fromPaise(p: bigint): string {
  const neg = p < 0n;
  const a = neg ? -p : p;
  return `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}

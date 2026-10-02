import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSchedule, type PaymentRow, type ScheduleRow } from "@/lib/schedule";

const NEW_PAYMENT_COLUMNS =
  "id, installment_no, due_date, paid_date, delay_days, payment_mode, reference_no, receipt_no," +
  " due_amount::text, paid_amount::text, balance_after::text";

type NewPaymentRecord = {
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

/** Payments taken in the new system, in the same shape as legacy payment rows. */
export async function fetchNewPayments(
  supabase: SupabaseClient,
  by: { legacyAccountId: number } | { loanId: number },
): Promise<PaymentRow[]> {
  let q = supabase.from("payments").select(NEW_PAYMENT_COLUMNS).order("installment_no");
  q = "loanId" in by ? q.eq("loan_id", by.loanId) : q.eq("legacy_account_id", by.legacyAccountId);
  const { data, error } = await q;
  if (error) {
    console.error("new payments query failed:", error);
    throw new Error("Could not load payments.");
  }
  return ((data ?? []) as unknown as NewPaymentRecord[]).map((p) => ({
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
  }));
}

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
    const { data: a, error } = await supabase
      .from("legacy_accounts")
      .select(
        "id, sno, fno, borrower_name, borrower_father, borrower_mobile, borrower_address, registration_no, vehicle_model," +
          " agreement_date, tenure_months, interval_months, total_amount::text, emi_amount::text",
      )
      .eq("sno", refId)
      .eq("ledger", "pending")
      .maybeSingle();
    if (error) throw new Error("Could not load account.");
    if (!a) return null;
    const acc = a as unknown as {
      id: number; sno: number; fno: number; borrower_name: string; borrower_father: string | null; borrower_mobile: string | null;
      borrower_address: string | null; registration_no: string | null; vehicle_model: string | null; agreement_date: string | null;
      tenure_months: number | null; interval_months: number | null; total_amount: string; emi_amount: string;
    };
    const [{ data: legacy, error: lErr }, fresh, { data: sum }] = await Promise.all([
      supabase
        .from("legacy_payments")
        .select("id, installment_no, due_date, paid_date, delay_days, payment_mode, cheque_no, receipt_no, data_flags, due_amount::text, paid_amount::text, balance_after::text")
        .eq("account_id", acc.id)
        .eq("ledger", "pending")
        .order("installment_no"),
      fetchNewPayments(supabase, { legacyAccountId: acc.id }),
      supabase.from("legacy_account_summary").select("total_paid::text, balance::text").eq("id", acc.id).single(),
    ]);
    if (lErr) throw new Error("Could not load payments.");
    const payments = [...((legacy ?? []) as unknown as PaymentRow[]), ...fresh];
    const s = sum as unknown as { total_paid: string; balance: string } | null;
    return {
      source, refId, folio: String(acc.fno), name: acc.borrower_name, father: acc.borrower_father, mobile: acc.borrower_mobile,
      address: acc.borrower_address, vehicle: [acc.vehicle_model, acc.registration_no].filter(Boolean).join(" · ") || null,
      total: acc.total_amount, emi: acc.emi_amount, installments: acc.tenure_months, intervalMonths: acc.interval_months,
      paid: s?.total_paid ?? "0.00", balance: s?.balance ?? acc.total_amount,
      rows: buildSchedule({ installments: acc.tenure_months, intervalMonths: acc.interval_months, agreementDate: acc.agreement_date, emi: acc.emi_amount, payments }),
    };
  }

  const { data: l, error } = await supabase
    .from("loans")
    .select(
      "id, folio_no, vehicle_model, vehicle_no, agreement_date, installments, interval_months, total_amount::text, emi_amount::text," +
        " borrowers(full_name, father_name, mobile, address)",
    )
    .eq("id", refId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error("Could not load loan.");
  if (!l) return null;
  const loan = l as unknown as {
    id: number; folio_no: string; vehicle_model: string; vehicle_no: string | null; agreement_date: string;
    installments: number; interval_months: number; total_amount: string; emi_amount: string;
    borrowers: { full_name: string; father_name: string | null; mobile: string | null; address: string | null };
  };
  const payments = await fetchNewPayments(supabase, { loanId: loan.id });
  const paidPaise = payments.reduce((t, p) => t + toPaise(p.paid_amount), 0n);
  return {
    source, refId, folio: loan.folio_no, name: loan.borrowers.full_name, father: loan.borrowers.father_name,
    mobile: loan.borrowers.mobile, address: loan.borrowers.address,
    vehicle: [loan.vehicle_model, loan.vehicle_no].filter(Boolean).join(" · ") || null,
    total: loan.total_amount, emi: loan.emi_amount, installments: loan.installments, intervalMonths: loan.interval_months,
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

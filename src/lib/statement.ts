import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLedger, toPaise, type LedgerRow, type LedgerSummary, type PaymentRow } from "@/lib/schedule";
import { LEGACY_PAYMENT_COLUMNS, NEW_PAYMENT_COLUMNS, byInstallment, mapNewPayment, type NewPaymentRecord } from "@/lib/ledger";

export type StatementData = {
  folio: string;
  borrower: { name: string; father: string | null; address: string | null; mobile: string | null };
  guarantor: { name: string | null; father: string | null; address: string | null; mobile: string | null };
  vehicle: { condition: string | null; model: string | null; color: string | null; chassis: string | null; engine: string | null; make: string | null; number: string | null };
  finance: { agreementDate: string | null; insuranceExpiry: string | null; months: number | null; finance: string; interest: string; agreement: string; hp: string; total: string };
  rows: LedgerRow[];
  summary: LedgerSummary;
};

const join = (...v: (string | null | undefined)[]) => v.filter(Boolean).join(", ") || null;

/** All data for a printable account statement (old account by SNO, or new loan by id). RLS applies. */
export async function getStatement(supabase: SupabaseClient, source: "old" | "new", refId: number): Promise<StatementData | null> {
  if (source === "old") {
    const { data, error } = await supabase
      .from("legacy_accounts")
      .select(
        "id, ledger, fno, borrower_name, borrower_father, borrower_address, borrower_mobile, borrower_mobile2," +
          " guarantor_name, guarantor_father, guarantor_address, guarantor_mobile, guarantor_mobile2," +
          " vehicle_condition, vehicle_model, vehicle_variant, chassis_no, engine_no, model_year, registration_no," +
          " agreement_date, tenure_months, interval_months," +
          " finance_amount::text, interest_amount::text, agreement_amount::text, hp_amount::text, total_amount::text, emi_amount::text," +
          ` legacy_paid::text, legacy_payments(${LEGACY_PAYMENT_COLUMNS}), payments(${NEW_PAYMENT_COLUMNS})`,
      )
      .eq("sno", refId)
      .maybeSingle();
    if (error) throw new Error("Could not load statement.");
    if (!data) return null;
    const a = data as unknown as Record<string, string | number | null> & {
      ledger: string; legacy_paid: string; legacy_payments: (PaymentRow & { ledger: string })[]; payments: NewPaymentRecord[];
      total_amount: string; finance_amount: string; interest_amount: string; agreement_amount: string; hp_amount: string; emi_amount: string;
      tenure_months: number | null; interval_months: number | null; agreement_date: string | null;
    };
    const fresh = a.payments.map(mapNewPayment);
    const payments = [...a.legacy_payments.filter((p) => p.ledger === a.ledger), ...fresh].sort(byInstallment);
    const paid = toPaise(a.legacy_paid) + fresh.reduce((t, p) => t + toPaise(p.paid_amount), 0n);
    const { rows, summary } = buildLedger({
      installments: a.tenure_months, intervalMonths: a.interval_months, agreementDate: a.agreement_date,
      emi: a.emi_amount, total: a.total_amount, finance: a.finance_amount, interest: a.interest_amount,
      payments, settled: a.ledger === "closed" || toPaise(a.total_amount) - paid <= 0n,
    });
    const s = (k: string) => (a[k] == null ? null : String(a[k]));
    return {
      folio: String(a.fno),
      borrower: { name: String(a.borrower_name), father: s("borrower_father"), address: s("borrower_address"), mobile: join(s("borrower_mobile"), s("borrower_mobile2")) },
      guarantor: { name: s("guarantor_name"), father: s("guarantor_father"), address: s("guarantor_address"), mobile: join(s("guarantor_mobile"), s("guarantor_mobile2")) },
      vehicle: { condition: s("vehicle_condition"), model: s("vehicle_model"), color: s("vehicle_variant"), chassis: s("chassis_no"), engine: s("engine_no"), make: s("model_year"), number: s("registration_no") },
      finance: {
        agreementDate: a.agreement_date, insuranceExpiry: null, months: a.tenure_months,
        finance: a.finance_amount, interest: a.interest_amount, agreement: a.agreement_amount, hp: a.hp_amount, total: a.total_amount,
      },
      rows, summary,
    };
  }

  const { data, error } = await supabase
    .from("loans")
    .select(
      "id, folio_no, status, guarantor_name, guarantor_father, guarantor_address, guarantor_mobile," +
        " vehicle_condition, vehicle_model, vehicle_color, chassis_no, engine_no, make_year, vehicle_no, insurance_expiry," +
        " agreement_date, installments, interval_months," +
        " finance_amount::text, interest_amount::text, agreement_amount::text, hp_amount::text, total_amount::text, emi_amount::text," +
        ` borrowers(full_name, father_name, mobile, address), payments(${NEW_PAYMENT_COLUMNS})`,
    )
    .eq("id", refId)
    .maybeSingle();
  if (error) throw new Error("Could not load statement.");
  if (!data) return null;
  const l = data as unknown as {
    folio_no: string; status: string; guarantor_name: string | null; guarantor_father: string | null; guarantor_address: string | null; guarantor_mobile: string | null;
    vehicle_condition: string; vehicle_model: string; vehicle_color: string | null; chassis_no: string | null; engine_no: string | null;
    make_year: number | null; vehicle_no: string | null; insurance_expiry: string | null; agreement_date: string; installments: number; interval_months: number;
    finance_amount: string; interest_amount: string; agreement_amount: string; hp_amount: string; total_amount: string; emi_amount: string;
    borrowers: { full_name: string; father_name: string | null; mobile: string | null; address: string | null };
    payments: NewPaymentRecord[];
  };
  const payments = l.payments.map(mapNewPayment).sort(byInstallment);
  const paid = payments.reduce((t, p) => t + toPaise(p.paid_amount), 0n);
  const { rows, summary } = buildLedger({
    installments: l.installments, intervalMonths: l.interval_months, agreementDate: l.agreement_date,
    emi: l.emi_amount, total: l.total_amount, finance: l.finance_amount, interest: l.interest_amount,
    payments, settled: l.status === "closed" || toPaise(l.total_amount) - paid <= 0n,
  });
  return {
    folio: l.folio_no,
    borrower: { name: l.borrowers.full_name, father: l.borrowers.father_name, address: l.borrowers.address, mobile: l.borrowers.mobile },
    guarantor: { name: l.guarantor_name, father: l.guarantor_father, address: l.guarantor_address, mobile: l.guarantor_mobile },
    vehicle: {
      condition: l.vehicle_condition, model: l.vehicle_model, color: l.vehicle_color, chassis: l.chassis_no, engine: l.engine_no,
      make: l.make_year == null ? null : String(l.make_year), number: l.vehicle_no,
    },
    finance: {
      agreementDate: l.agreement_date, insuranceExpiry: l.insurance_expiry, months: l.installments,
      finance: l.finance_amount, interest: l.interest_amount, agreement: l.agreement_amount, hp: l.hp_amount, total: l.total_amount,
    },
    rows, summary,
  };
}

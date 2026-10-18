import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_LOAN, type LoanFields } from "@/lib/loan";
import { LoanForm } from "../../new/loan-form";

export async function generateMetadata({ params }: PageProps<"/loans/[id]/edit">) {
  const { id } = await params;
  return { title: `Edit loan ${id} · Shree Salasar Sarkar` };
}

/** "60000.00" -> "60000", "0.00" -> "" (blank = none, like the New Loan form) */
const money = (v: string | null, blankZero = false) => {
  if (v == null) return "";
  const s = v.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return blankZero && Number(s) === 0 ? "" : s;
};
const s = (v: unknown) => (v == null ? "" : String(v));

export default async function EditLoanPage({ params }: PageProps<"/loans/[id]/edit">) {
  await requireAdmin();
  const { id: idParam } = await params;
  const id = Number.parseInt(idParam, 10);
  if (!Number.isInteger(id) || String(id) !== idParam) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loans")
    .select(
      "id, folio_no, zone, dealer, loan_type, guarantor_name, guarantor_father, guarantor_mobile, guarantor_address," +
        " vehicle_condition, sold_by, vehicle_model, vehicle_color, chassis_no, engine_no, make_year, vehicle_no, insurance_expiry," +
        " agreement_date, installments, interval_months, interest_rate::text, finance_amount::text, agreement_amount::text, hp_amount::text," +
        " borrowers(full_name, father_name, mobile, date_of_birth, address), payments(count)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("edit loan query failed:", error);
    throw new Error("Could not load this loan.");
  }
  if (!data) notFound();
  const l = data as unknown as Record<string, string | number | null> & {
    borrowers: { full_name: string; father_name: string | null; mobile: string | null; date_of_birth: string | null; address: string | null };
    payments: { count: number }[];
  };
  const b = l.borrowers;

  const initial: Record<LoanFields, string> = {
    ...EMPTY_LOAN,
    folio_no: s(l.folio_no),
    zone: s(l.zone),
    dealer: s(l.dealer),
    loan_type: s(l.loan_type),
    borrower_name: s(b.full_name),
    borrower_father: s(b.father_name),
    borrower_mobile: s(b.mobile),
    borrower_dob: s(b.date_of_birth),
    borrower_address: s(b.address),
    guarantor_name: s(l.guarantor_name),
    guarantor_father: s(l.guarantor_father),
    guarantor_mobile: s(l.guarantor_mobile),
    guarantor_address: s(l.guarantor_address),
    vehicle_condition: s(l.vehicle_condition),
    sold_by: s(l.sold_by),
    vehicle_model: s(l.vehicle_model),
    vehicle_color: s(l.vehicle_color),
    chassis_no: s(l.chassis_no),
    engine_no: s(l.engine_no),
    make_year: s(l.make_year),
    vehicle_no: s(l.vehicle_no),
    insurance_expiry: s(l.insurance_expiry),
    agreement_date: s(l.agreement_date),
    installments: s(l.installments),
    interval_months: s(l.interval_months),
    finance_amount: money(l.finance_amount as string),
    interest_rate: money(l.interest_rate as string),
    agreement_amount: money(l.agreement_amount as string, true),
    hp_amount: money(l.hp_amount as string, true),
  };

  return <LoanForm edit={{ id, initial, payments: l.payments[0]?.count ?? 0 }} />;
}

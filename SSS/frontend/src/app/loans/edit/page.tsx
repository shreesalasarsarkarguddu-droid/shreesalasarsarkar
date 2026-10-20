import { useParams } from "react-router";
import { useApi } from "@/lib/use-api";
import { PageData } from "@/components/page-state";
import { EMPTY_LOAN, type LoanFields } from "@/lib/loan";
import { LoanForm } from "../new/loan-form";

/** "60000.00" -> "60000", "0.00" -> "" (blank = none, like the New Loan form) */
const money = (v: string | null, blankZero = false) => {
  if (v == null) return "";
  const s = v.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return blankZero && Number(s) === 0 ? "" : s;
};
const s = (v: unknown) => (v == null ? "" : String(v));

export default function EditLoanPage() {
  const { id: idParam = "" } = useParams();
  const id = Number.parseInt(idParam, 10);
  const valid = Number.isInteger(id) && String(id) === idParam;
  const res = useApi<{ loan: unknown }>(valid ? `/loans/${id}` : null);
  const zones = useApi<string[]>("/zones/names");
  return <PageData q={res}>{(d) => <EditLoan id={id} data={d.loan} zones={zones.data ?? []} />}</PageData>;
}

function EditLoan({ id, data, zones }: { id: number; data: unknown; zones: string[] }) {
  const l = data as unknown as Record<string, string | number | null> & {
    borrowers: { full_name: string; father_name: string | null; mobile: string | null; date_of_birth: string | null; address: string | null };
    payments: unknown[];
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

  return (
    <>
      <title>{`Edit loan ${id} · Shree Salasar Sarkar`}</title>
      <LoanForm edit={{ id, initial, payments: l.payments.length }} zones={zones} />
    </>
  );
}

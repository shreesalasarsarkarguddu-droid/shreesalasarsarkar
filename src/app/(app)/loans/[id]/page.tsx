import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { dmy, inr } from "@/lib/format";
import { buildSchedule } from "@/lib/schedule";
import { fetchNewPayments } from "@/lib/ledger";
import { EmiSummary, InstallmentTable } from "../../installments";

type Loan = {
  id: number;
  folio_no: string;
  zone: string | null;
  dealer: string | null;
  loan_type: string;
  guarantor_name: string | null;
  guarantor_father: string | null;
  guarantor_mobile: string | null;
  guarantor_address: string | null;
  vehicle_condition: string;
  sold_by: string | null;
  vehicle_model: string;
  vehicle_color: string | null;
  chassis_no: string | null;
  engine_no: string | null;
  make_year: number | null;
  vehicle_no: string | null;
  insurance_expiry: string | null;
  agreement_date: string;
  installments: number;
  interval_months: number;
  interest_rate: string;
  finance_amount: string;
  agreement_amount: string;
  hp_amount: string;
  interest_amount: string;
  total_amount: string;
  emi_amount: string;
  status: string;
  created_at: string;
  borrowers: { full_name: string; father_name: string | null; mobile: string | null; date_of_birth: string | null; address: string | null };
};

export async function generateMetadata({ params }: PageProps<"/loans/[id]">) {
  const { id } = await params;
  return { title: `Loan ${id} · Shree Salasar Sarkar` };
}

export default async function LoanPage({ params, searchParams }: PageProps<"/loans/[id]">) {
  const [{ id: idParam }, sp] = await Promise.all([params, searchParams]);
  const id = Number.parseInt(idParam, 10);
  if (!Number.isInteger(id) || String(id) !== idParam) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loans")
    .select(
      "id, folio_no, zone, dealer, loan_type, guarantor_name, guarantor_father, guarantor_mobile, guarantor_address," +
        " vehicle_condition, sold_by, vehicle_model, vehicle_color, chassis_no, engine_no, make_year, vehicle_no, insurance_expiry," +
        " agreement_date, installments, interval_months, status, created_at, interest_rate::text," +
        " finance_amount::text, agreement_amount::text, hp_amount::text, interest_amount::text, total_amount::text, emi_amount::text," +
        " borrowers(full_name, father_name, mobile, date_of_birth, address)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("loan query failed:", error);
    throw new Error("Could not load this loan.");
  }
  if (!data) notFound();
  const l = data as unknown as Loan;
  const b = l.borrowers;
  const payments = await fetchNewPayments(supabase, { loanId: l.id });
  const schedule = buildSchedule({
    installments: l.installments,
    intervalMonths: l.interval_months,
    agreementDate: l.agreement_date,
    emi: l.emi_amount,
    payments,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {sp.saved === "1" && (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
          Loan saved.
        </p>
      )}

      <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight sm:text-2xl">{b.full_name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              Folio <span className="font-medium text-slate-700">{l.folio_no}</span> · {l.loan_type} · Agreement {dmy(l.agreement_date)}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-blue-800">{l.status}</span>
        </div>
        <dl className="num mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Finance amount" value={inr(l.finance_amount)} />
          <Stat label="Interest" value={inr(l.interest_amount)} sub={`${l.interest_rate}% p.a.`} />
          <Stat label="Total payable" value={inr(l.total_amount)} />
          <Stat
            label="EMI"
            value={inr(l.emi_amount)}
            sub={`× ${l.installments}${l.interval_months > 1 ? `, every ${l.interval_months} months` : " months"}`}
          />
        </dl>
        <div className="mt-3">
          <EmiSummary rows={schedule} emi={l.emi_amount} intervalMonths={l.interval_months} />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Borrower">
          <Field label="Father / husband" value={b.father_name} />
          <Field label="Mobile" value={b.mobile} />
          <Field label="Date of birth" value={b.date_of_birth ? dmy(b.date_of_birth) : null} />
          <Field label="Address" value={b.address} />
        </Card>
        <Card title="Guarantor">
          <Field label="Name" value={l.guarantor_name} />
          <Field label="Father" value={l.guarantor_father} />
          <Field label="Mobile" value={l.guarantor_mobile} />
          <Field label="Address" value={l.guarantor_address} />
        </Card>
        <Card title="Vehicle">
          <Field label="Model" value={[l.vehicle_model, l.vehicle_color].filter(Boolean).join(" · ")} />
          <Field label="Condition / year" value={[l.vehicle_condition, l.make_year].filter(Boolean).join(" · ")} />
          <Field label="Vehicle no." value={l.vehicle_no} />
          <Field label="Chassis / engine" value={[l.chassis_no, l.engine_no].filter(Boolean).join(" / ") || null} />
          <Field label="Insurance expiry" value={l.insurance_expiry ? dmy(l.insurance_expiry) : null} />
          <Field label="Sold by" value={l.sold_by} />
        </Card>
        <Card title="Loan">
          <Money label="Finance amount" value={l.finance_amount} />
          <Money label="Interest" value={l.interest_amount} />
          <Money label="Agreement amount" value={l.agreement_amount} />
          <Money label="HP / RTO" value={l.hp_amount} />
          <Money label="Total payable" value={l.total_amount} strong />
          <Field label="Zone / dealer" value={[l.zone, l.dealer].filter(Boolean).join(" · ") || null} />
        </Card>
      </div>

      <section className="rounded-xl bg-white ring-1 ring-slate-200">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Installments ({schedule.length})
        </h2>
        <InstallmentTable rows={schedule} />
      </section>

      <Link
        href="/loans/new"
        className="flex h-12 items-center justify-center rounded-xl bg-blue-700 text-base font-semibold text-white hover:bg-blue-800 sm:inline-flex sm:px-6"
      >
        + New loan
      </Link>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-bold">{value}</dd>
      {sub && <dd className="text-xs text-slate-500">{sub}</dd>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <dl className="space-y-2.5">{children}</dl>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-words text-sm font-medium">{value || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

function Money({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="num flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className={strong ? "font-bold" : "font-medium"}>{inr(value)}</dd>
    </div>
  );
}

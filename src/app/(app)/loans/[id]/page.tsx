import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { dmy, inr, isNegative, isPositive } from "@/lib/format";
import { buildLedger, fromPaise, toPaise } from "@/lib/schedule";
import { NEW_PAYMENT_COLUMNS, byInstallment, mapNewPayment, type NewPaymentRecord } from "@/lib/ledger";
import { EmiSummary, InstallmentTable } from "../../installments";
import { CollectButton } from "../../payments/collect-button";
import { SeizeControl, type SeizureEvent } from "../../seize-control";
import { SeizureInfo } from "../../seizure-history";

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
        ` borrowers(full_name, father_name, mobile, date_of_birth, address), payments(${NEW_PAYMENT_COLUMNS}), seizures(id, action, action_date, remarks, created_at, staff(full_name))`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("loan query failed:", error);
    throw new Error("Could not load this loan.");
  }
  if (!data) notFound();
  const l = data as unknown as Loan & { payments: NewPaymentRecord[]; seizures: SeizureEvent[] };
  const seizedNow = l.status === "seized";
  const b = l.borrowers;
  const payments = l.payments.map(mapNewPayment).sort(byInstallment);
  const paidPaise = payments.reduce((t, p) => t + toPaise(p.paid_amount), 0n);
  const { rows: schedule, summary } = buildLedger({
    installments: l.installments,
    intervalMonths: l.interval_months,
    agreementDate: l.agreement_date,
    emi: l.emi_amount,
    total: l.total_amount,
    finance: l.finance_amount,
    interest: l.interest_amount,
    payments,
    settled: l.status === "closed" || toPaise(l.total_amount) - paidPaise <= 0n,
  });

  const paid = fromPaise(paidPaise);
  const balance = fromPaise(toPaise(l.total_amount) - paidPaise);

  return (
    <div className="space-y-4">
      <Link href="/accounts" className="inline-flex h-10 items-center text-sm font-medium text-blue-700">
        ← All accounts
      </Link>

      {sp.saved === "1" && (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
          Loan saved.
        </p>
      )}

      {/* header - same layout as old accounts */}
      <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight sm:text-2xl">{b.full_name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              Folio <span className="font-medium text-slate-700">{l.folio_no}</span> · {l.loan_type} · Agreement {dmy(l.agreement_date)}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <span className="flex gap-1">
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">New</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  seizedNow ? "bg-red-100 text-red-800" : l.status === "closed" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                }`}
              >
                {seizedNow ? "Seized" : l.status === "closed" ? "Fully paid" : "Pending"}
              </span>
            </span>
            <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
              <Link
                href={`/loans/${l.id}/statement`}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-white px-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 sm:px-4"
              >
                <span className="sm:hidden">Statement</span>
                <span className="hidden sm:inline">Print statement</span>
              </Link>
              {l.status !== "closed" && (
                <CollectButton row={{ source: "new", ref_id: l.id, folio: l.folio_no, borrower_name: b.full_name, borrower_mobile: b.mobile }} />
              )}
              {l.status !== "closed" && <SeizeControl source="new" refId={l.id} seized={seizedNow} />}
            </div>
          </div>
        </div>

        <dl className="num mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total payable" value={inr(l.total_amount)} />
          <Stat label="Paid" value={inr(paid)} tone="green" />
          <Stat label={isNegative(balance) ? "Overpaid" : "Balance"} value={inr(balance)} tone={isPositive(balance) ? "red" : "plain"} />
          <Stat
            label="EMI"
            value={inr(l.emi_amount)}
            sub={`× ${l.installments} EMIs${l.interval_months > 1 ? `, every ${l.interval_months} months` : ""}`}
          />
        </dl>
        <div className="mt-3">
          <EmiSummary summary={summary} emi={l.emi_amount} intervalMonths={l.interval_months} />
        </div>
      </section>

      <SeizureInfo seized={seizedNow} events={l.seizures} fromOldSoftware={false} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card title="Customer">
          <Field label="Father / husband" value={b.father_name} />
          <Field label="Mobile" value={b.mobile} tel />
          <Field label="Date of birth" value={b.date_of_birth ? dmy(b.date_of_birth) : null} />
          <Field label="Address" value={b.address} />
          <Field label="Zone" value={l.zone} />
        </Card>
        <Card title="Guarantor">
          <Field label="Name" value={l.guarantor_name} />
          <Field label="Father" value={l.guarantor_father} />
          <Field label="Mobile" value={l.guarantor_mobile} tel />
          <Field label="Address" value={l.guarantor_address} />
        </Card>
        <Card title="Vehicle">
          <Field label="Registration no." value={l.vehicle_no} />
          <Field label="Model" value={[l.vehicle_model, l.vehicle_color].filter(Boolean).join(" · ") || null} />
          <Field label="Year / condition" value={[l.make_year, l.vehicle_condition].filter(Boolean).join(" · ") || null} />
          <Field label="Chassis / engine" value={[l.chassis_no, l.engine_no].filter(Boolean).join(" / ") || null} />
          <Field label="Insurance expiry" value={l.insurance_expiry ? dmy(l.insurance_expiry) : null} />
          <Field label="Sold by" value={l.sold_by} />
        </Card>
        <Card title="Loan">
          <Money label="Finance amount" value={l.finance_amount} />
          <Money label={`Interest (${l.interest_rate}% p.a.)`} value={l.interest_amount} />
          <Money label="Agreement amount" value={l.agreement_amount} />
          <Money label="HP / RTO" value={l.hp_amount} />
          <Money label="Total payable" value={l.total_amount} strong />
          <Field label="Mode / dealer" value={[l.loan_type, l.dealer].filter(Boolean).join(" · ") || null} />
        </Card>
      </div>

      <section className="rounded-xl bg-white ring-1 ring-slate-200">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Installments ({schedule.length})
        </h2>
        <InstallmentTable rows={schedule} />
      </section>
    </div>
  );
}

function Stat({ label, value, sub, tone = "plain" }: { label: string; value: string; sub?: string; tone?: "plain" | "green" | "red" }) {
  const color = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "text-slate-900";
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-lg font-bold ${color}`}>{value}</dd>
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

function Field({ label, value, tel }: { label: string; value: string | null; tel?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-words text-sm font-medium">
        {!value ? (
          <span className="text-slate-400">—</span>
        ) : tel && /^\d{10}$/.test(value) ? (
          <a href={`tel:${value}`} className="text-blue-700">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
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

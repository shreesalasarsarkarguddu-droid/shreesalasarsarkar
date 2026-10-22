import { useStaff } from "@/lib/auth";
import { useApi } from "@/lib/use-api";
import { PageData } from "@/components/page-state";
import { useParams } from "react-router";
import { useSearchParams } from "next/navigation";
import { can } from "@/lib/permissions";
import Link from "next/link";
import { dmy, inr, isNegative, isPositive } from "@/lib/format";
import { buildLedger, fromPaise, toPaise } from "@/lib/schedule";
import { byInstallment, mapNewPayment, type NewPaymentRecord, type WaitingPayment } from "@/lib/ledger";
import type { Remark } from "@/lib/remarks";
import type { ZoneInfo } from "@/lib/zones";
import { WaitingBanner } from "../waiting-banner";
import { EmiSummary, InstallmentTable } from "../installments";
import { CollectButton } from "../payments/collect-button";
import { SeizeControl, type SeizureEvent } from "../seize-control";
import { SeizureInfo } from "../seizure-history";
import { PaymentFixes } from "../payment-fixes";
import { RemarkHistory, RemarkPanel } from "../remark-panel";
import { ZonePicker } from "../zone-picker";
import { DeleteLoan } from "./id/delete-loan";
import { PurgeLoan } from "./id/purge-loan";
import { MoneyActions } from "../money-actions";
import { adjText, suggestLateFee, summarizeAdjustments, type Adjustment } from "@/lib/adjustments";
import { todayIST } from "@/lib/schedule";
import { BUSINESS } from "@/lib/business";

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

type LoanResponse = { loan: unknown; waiting: WaitingPayment[]; remarks: Remark[]; zoneInfo: ZoneInfo | null };

export default function LoanPage() {
  const { id } = useParams();
  const res = useApi<LoanResponse>(/^[1-9]\d*$/.test(id ?? "") ? `/loans/${id}` : null);
  return <PageData q={res}>{(d) => <LoanView d={d} />}</PageData>;
}

function LoanView({ d }: { d: LoanResponse }) {
  const staff = useStaff();
  const sp = Object.fromEntries(useSearchParams()) as Record<string, string | undefined>;
  const { loan: data, waiting, remarks, zoneInfo } = d;
  const l = data as unknown as Loan & { payments: NewPaymentRecord[]; seizures: SeizureEvent[]; adjustments: Adjustment[] };
  const seizedNow = l.status === "seized";
  const b = l.borrowers;
  const adj = summarizeAdjustments(l.adjustments);
  const owedTotal = fromPaise(toPaise(l.total_amount) + toPaise(adj.net));
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
    settled: l.status === "closed" || toPaise(owedTotal) - paidPaise <= 0n,
    adjustments: adj.net,
    reschedule: adj.reschedule,
  });
  const fee = suggestLateFee(schedule, todayIST(), BUSINESS.lateFeePerDay);

  const paid = fromPaise(paidPaise);
  const balance = fromPaise(toPaise(owedTotal) - paidPaise);

  return (
    <div className="space-y-4">
      <title>{`Loan ${l.folio_no} · Shree Salasar Sarkar`}</title>
      <Link href="/accounts" className="inline-flex h-10 items-center text-sm font-medium text-blue-700">
        ← All accounts
      </Link>

      {sp.saved === "1" && (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
          Loan saved.
        </p>
      )}
      {sp.edited === "1" && (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
          Loan updated. Amounts and payments were recalculated; the change is in the activity log.
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
                {seizedNow ? "Seized" : l.status === "closed" ? (adj.settled && isPositive(fromPaise(-toPaise(adj.discounts))) ? "Closed" : "Fully paid") : "Pending"}
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
              {l.status !== "closed" && can(staff, "collect") && (
                <CollectButton row={{ source: "new", ref_id: l.id, folio: l.folio_no, borrower_name: b.full_name, borrower_mobile: b.mobile }} />
              )}
              {l.status !== "closed" && can(staff, "seize") && <SeizeControl source="new" refId={l.id} seized={seizedNow} />}
              {can(staff, "fix_entries") && (
                <Link
                  href={`/loans/${l.id}/edit`}
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50"
                >
                  Edit loan
                </Link>
              )}
            </div>
          </div>
        </div>

        <dl className="num mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total payable" value={inr(owedTotal)} sub={adjText(l.total_amount, adj)} />
          <Stat label="Paid" value={inr(paid)} tone="green" />
          <Stat label={isNegative(balance) ? "Overpaid" : "Balance"} value={inr(balance)} tone={isPositive(balance) ? "red" : "plain"} />
          <Stat
            label="EMI"
            value={inr(adj.reschedule?.emi ?? l.emi_amount)}
            sub={
              adj.reschedule
                ? `rescheduled from ${dmy(adj.reschedule.nextDue)}`
                : `× ${l.installments} EMIs${l.interval_months > 1 ? `, every ${l.interval_months} months` : ""}`
            }
          />
        </dl>
        <div className="mt-3">
          <EmiSummary summary={summary} emi={adj.reschedule?.emi ?? l.emi_amount} intervalMonths={l.interval_months} />
        </div>
      </section>

      <WaitingBanner waiting={waiting} canApprove={can(staff, "approve")} />

      <SeizureInfo seized={seizedNow} events={l.seizures} fromOldSoftware={false} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card title="Customer">
          <Field label="Father / husband" value={b.father_name} />
          <Field label="Mobile" value={b.mobile} tel />
          <Field label="Date of birth" value={b.date_of_birth ? dmy(b.date_of_birth) : null} />
          <Field label="Address" value={b.address} />
          {zoneInfo ? <ZonePicker source="new" refId={l.id} info={zoneInfo} /> : <Field label="Zone" value={l.zone} />}
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
        <InstallmentTable rows={schedule} remarks={remarks} />
      </section>

      <section className="rounded-xl bg-white ring-1 ring-slate-200">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Visit remarks ({remarks.length})
        </h2>
        <RemarkHistory remarks={remarks} path={`/loans/${l.id}`} canFix={can(staff, "fix_entries")} />
        {can(staff, "collect") && !(l.status === "closed") && (
          <div className="border-t border-slate-100 p-3">
            <RemarkPanel source="new" refId={l.id} installmentNo={schedule.find((r) => r.kind === "due")?.sno ?? null} />
          </div>
        )}
      </section>

      <MoneyActions
        source="new"
        refId={l.id}
        path={`/loans/${l.id}`}
        adjustments={l.adjustments}
        balance={balance}
        emi={adj.reschedule?.emi ?? l.emi_amount}
        intervalMonths={l.interval_months}
        suggestedFee={fee.amount}
        feeNote={fee.note}
        canAct={can(staff, "money")}
        closed={l.status === "closed" && !adj.settled}
      />

      {can(staff, "fix_entries") && <PaymentFixes payments={l.payments} path={`/loans/${l.id}`} />}
      {staff?.role === "admin" ? (
        <PurgeLoan
          id={l.id}
          folio={l.folio_no}
          name={b.full_name}
          payments={l.payments.length}
          paid={fromPaise(l.payments.reduce((t, p) => t + toPaise(p.paid_amount), 0n))}
        />
      ) : (
        can(staff, "fix_entries") && l.payments.length === 0 && <DeleteLoan id={l.id} folio={l.folio_no} />
      )}
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

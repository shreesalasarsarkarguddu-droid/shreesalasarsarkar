import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { dmy, flagLabel, inr, isNegative, isPositive } from "@/lib/format";
import { StatusBadge } from "../status-badge";
import { CollectButton } from "../../payments/collect-button";
import { buildLedger } from "@/lib/schedule";
import { LEGACY_PAYMENT_COLUMNS, NEW_PAYMENT_COLUMNS, addMoney, byInstallment, mapNewPayment, subMoney, type NewPaymentRecord } from "@/lib/ledger";
import { Delay, EmiSummary, InstallmentTable, RowFlags } from "../../installments";

type Account = {
  id: number;
  ledger: "pending" | "closed";
  sno: number;
  fno: number;
  fcode: string | null;
  borrower_name: string;
  borrower_father: string | null;
  borrower_address: string | null;
  borrower_mobile: string | null;
  borrower_mobile2: string | null;
  guarantor_name: string | null;
  guarantor_father: string | null;
  guarantor_address: string | null;
  guarantor_mobile: string | null;
  guarantor_mobile2: string | null;
  finance_mode: string | null;
  zone: string | null;
  vehicle_condition: string | null;
  vehicle_model: string | null;
  vehicle_variant: string | null;
  chassis_no: string | null;
  engine_no: string | null;
  model_year: number | null;
  registration_no: string | null;
  agreement_date: string | null;
  tenure_months: number | null;
  interval_months: number | null;
  finance_amount: string;
  interest_amount: string;
  agreement_amount: string;
  hp_amount: string;
  total_amount: string;
  emi_amount: string;
  seized: boolean | null;
  data_flags: string[];
};

type Payment = {
  id: number;
  ledger: "pending" | "closed";
  installment_no: number;
  due_amount: string | null;
  due_date: string | null;
  paid_amount: string;
  paid_date: string | null;
  balance_after: string | null;
  delay_days: number | null;
  payment_mode: string | null;
  cheque_no: string | null;
  receipt_no: number | null;
  data_flags: string[];
};

export async function generateMetadata({ params }: PageProps<"/accounts/[sno]">) {
  const { sno } = await params;
  return { title: `SNO ${sno} · Shree Salasar Sarkar` };
}

export default async function AccountPage({ params }: PageProps<"/accounts/[sno]">) {
  const { sno: snoParam } = await params;
  const sno = Number.parseInt(snoParam, 10);
  if (!Number.isInteger(sno) || String(sno) !== snoParam) notFound();

  const supabase = await createClient();
  // One request: the account with its legacy payments and its new-system payments embedded.
  const { data: accountData, error } = await supabase
    .from("legacy_accounts")
    .select(
      "id, ledger, sno, fno, fcode, borrower_name, borrower_father, borrower_address, borrower_mobile, borrower_mobile2," +
        " guarantor_name, guarantor_father, guarantor_address, guarantor_mobile, guarantor_mobile2, finance_mode, zone," +
        " vehicle_condition, vehicle_model, vehicle_variant, chassis_no, engine_no, model_year, registration_no," +
        " agreement_date, tenure_months, interval_months, seized, data_flags," +
        " finance_amount::text, interest_amount::text, agreement_amount::text, hp_amount::text, total_amount::text, emi_amount::text," +
        ` legacy_paid::text, legacy_payments(${LEGACY_PAYMENT_COLUMNS}), payments(${NEW_PAYMENT_COLUMNS})`,
    )
    .eq("sno", sno)
    .maybeSingle();
  if (error) {
    console.error("account query failed:", error);
    throw new Error("Could not load this account.");
  }
  if (!accountData) notFound();
  const a = accountData as unknown as Account & { legacy_paid: string; legacy_payments: Payment[]; payments: NewPaymentRecord[] };

  const all = [...a.legacy_payments].sort(byInstallment);
  const newPayments = a.payments.map(mapNewPayment);
  const totalPaid = addMoney(a.legacy_paid, newPayments.map((p) => p.paid_amount));
  const s = { total_paid: totalPaid, balance: subMoney(a.total_amount, totalPaid) };
  const payments = [...all.filter((p) => p.ledger === a.ledger), ...newPayments.map((p) => ({ ...p, ledger: a.ledger }))].sort(byInstallment);
  const otherFile = all.filter((p) => p.ledger !== a.ledger);
  // Fully-paid accounts (or nothing left to pay) show only the payments made, never "overdue" slots.
  const settled = a.ledger === "closed" || !isPositive(s?.balance);
  const { rows: schedule, summary } = buildLedger({
    installments: a.tenure_months,
    intervalMonths: a.interval_months,
    agreementDate: a.agreement_date,
    emi: a.emi_amount,
    total: a.total_amount,
    finance: a.finance_amount,
    interest: a.interest_amount,
    payments,
    settled,
  });

  return (
    <div className="space-y-4">
      <Link href="/accounts" className="inline-flex h-10 items-center text-sm font-medium text-blue-700">
        ← All accounts
      </Link>

      {/* header */}
      <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight sm:text-2xl">{a.borrower_name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              FNO <span className="font-medium text-slate-700">{a.fno}</span> · SNO {a.sno}
              {a.agreement_date && <> · Agreement {dmy(a.agreement_date)}</>}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            <StatusBadge ledger={a.ledger} seized={a.seized} />
            <Link
              href={`/accounts/${a.sno}/statement`}
              className="inline-flex h-11 items-center rounded-lg bg-white px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              Print statement
            </Link>
            {a.ledger === "pending" && (
              <CollectButton
                row={{ source: "old", ref_id: a.sno, folio: String(a.fno), borrower_name: a.borrower_name, borrower_mobile: a.borrower_mobile }}
              />
            )}
          </div>
        </div>

        <dl className="num mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total payable" value={inr(a.total_amount)} />
          <Stat label="Paid" value={inr(s?.total_paid)} tone="green" />
          <Stat
            label={isNegative(s?.balance) ? "Overpaid" : "Balance"}
            value={inr(s?.balance)}
            tone={isPositive(s?.balance) ? "red" : "plain"}
          />
          <Stat label="EMI" value={inr(a.emi_amount)} sub={`× ${a.tenure_months ?? "—"} EMIs`} />
        </dl>
        <div className="mt-3">
          {settled ? (
            <p className="text-sm text-slate-600">
              <span className="rounded-lg bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-800 ring-1 ring-emerald-200">
                {a.tenure_months ?? "—"} EMIs of {inr(a.emi_amount)}
              </span>{" "}
              · {payments.length} payment{payments.length === 1 ? "" : "s"} made
              {a.ledger === "closed" && " · fully paid"}
            </p>
          ) : (
            <EmiSummary summary={summary} emi={a.emi_amount} intervalMonths={a.interval_months} />
          )}
        </div>
      </section>

      {(a.data_flags.length > 0 || otherFile.length > 0) && (
        <section className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <p className="font-semibold">Notes from the import</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {a.data_flags.map((f) => (
              <li key={f}>{flagLabel(f)}</li>
            ))}
            {otherFile.length > 0 && (
              <li>
                {otherFile.length} payment row(s) for this account are also in the{" "}
                {a.ledger === "closed" ? "pending" : "fully-paid"} file (shown at the bottom, not counted).
              </li>
            )}
          </ul>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card title="Customer">
          <Field label="Father / husband" value={a.borrower_father} />
          <Field label="Mobile" value={[a.borrower_mobile, a.borrower_mobile2].filter(Boolean).join(", ") || null} tel />
          <Field label="Address" value={a.borrower_address} />
          <Field label="Zone" value={a.zone} />
        </Card>
        <Card title="Guarantor / remarks">
          <Field label="Name" value={a.guarantor_name} />
          <Field label="Father" value={a.guarantor_father} />
          <Field label="Mobile" value={[a.guarantor_mobile, a.guarantor_mobile2].filter(Boolean).join(", ") || null} tel />
          <Field label="Address" value={a.guarantor_address} />
        </Card>
        <Card title="Vehicle">
          <Field label="Registration no." value={a.registration_no} />
          <Field label="Model" value={[a.vehicle_model, a.vehicle_variant].filter(Boolean).join(" · ") || null} />
          <Field label="Year / condition" value={[a.model_year, a.vehicle_condition].filter(Boolean).join(" · ") || null} />
          <Field label="Chassis / engine" value={[a.chassis_no, a.engine_no].filter(Boolean).join(" / ") || null} />
        </Card>
        <Card title="Loan">
          <Money label="Finance amount" value={a.finance_amount} />
          <Money label="Interest" value={a.interest_amount} />
          <Money label="Agreement amount" value={a.agreement_amount} />
          <Money label="HP amount" value={a.hp_amount} />
          <Money label="Total payable" value={a.total_amount} strong />
          <Field label="Mode / code" value={[a.finance_mode, a.fcode].filter(Boolean).join(" · ") || null} />
        </Card>
      </div>

      <section className="rounded-xl bg-white ring-1 ring-slate-200">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          {settled ? `Payments (${payments.length})` : `Installments (${schedule.length})`}
        </h2>
        {schedule.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">No payments recorded in the old software.</p>
        ) : (
          <InstallmentTable rows={schedule} />
        )}
      </section>

      {otherFile.length > 0 && (
        <section className="rounded-xl bg-white ring-1 ring-amber-200">
          <h2 className="border-b border-amber-100 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-amber-800">
            Also in the {a.ledger === "closed" ? "pending" : "fully-paid"} file ({otherFile.length}) — not counted
          </h2>
          <PaymentList payments={otherFile} />
        </section>
      )}
    </div>
  );
}

function PaymentList({ payments }: { payments: Payment[] }) {
  return (
    <>
      {/* phone */}
      <ul className="num divide-y divide-slate-100 md:hidden">
        {payments.map((p) => (
          <li key={p.id} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-semibold">
                #{p.installment_no} · <span className="text-emerald-700">{inr(p.paid_amount)}</span>
              </p>
              <p className="text-sm text-slate-600">{dmy(p.paid_date)}</p>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              Due {inr(p.due_amount)} on {dmy(p.due_date)}
              <Delay days={p.delay_days} />
            </p>
            <p className="mt-0.5 text-sm text-slate-500">
              Balance <span className="font-medium text-slate-700">{inr(p.balance_after)}</span>
              {p.payment_mode && <> · {p.payment_mode}</>}
              {p.receipt_no != null && <> · Rcpt {p.receipt_no}</>}
            </p>
            <RowFlags flags={p.data_flags} />
          </li>
        ))}
      </ul>

      {/* tablet / desktop */}
      <div className="hidden overflow-x-auto md:block">
        <table className="num w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">#</th>
              <th className="px-4 py-2.5">Due date</th>
              <th className="px-4 py-2.5 text-right">Due amt</th>
              <th className="px-4 py-2.5">Paid date</th>
              <th className="px-4 py-2.5 text-right">Paid amt</th>
              <th className="px-4 py-2.5 text-right">Delay</th>
              <th className="px-4 py-2.5 text-right">Balance</th>
              <th className="px-4 py-2.5">Mode</th>
              <th className="px-4 py-2.5">Receipt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payments.map((p) => (
              <tr key={p.id} className="align-top">
                <td className="px-4 py-2.5 text-slate-500">{p.installment_no}</td>
                <td className="px-4 py-2.5">{dmy(p.due_date)}</td>
                <td className="px-4 py-2.5 text-right">{inr(p.due_amount)}</td>
                <td className="px-4 py-2.5">
                  {dmy(p.paid_date)}
                  <RowFlags flags={p.data_flags} />
                </td>
                <td className="px-4 py-2.5 text-right font-semibold text-emerald-700">{inr(p.paid_amount)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Delay days={p.delay_days} plain />
                </td>
                <td className="px-4 py-2.5 text-right">{inr(p.balance_after)}</td>
                <td className="px-4 py-2.5">
                  {p.payment_mode ?? "—"}
                  {p.cheque_no && <span className="block text-xs text-slate-500">{p.cheque_no}</span>}
                </td>
                <td className="px-4 py-2.5 text-slate-600">{p.receipt_no ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
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
        {value ? (
          tel ? (
            value.split(", ").map((m, i) => (
              <span key={i}>
                {i > 0 && ", "}
                {/^\d{10}$/.test(m) ? (
                  <a href={`tel:${m}`} className="text-blue-700">
                    {m}
                  </a>
                ) : (
                  m
                )}
              </span>
            ))
          ) : (
            value
          )
        ) : (
          <span className="text-slate-400">—</span>
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

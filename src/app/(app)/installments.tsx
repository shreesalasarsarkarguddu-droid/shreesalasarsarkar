import { dmy, flagLabel, inr } from "@/lib/format";
import type { ScheduleRow } from "@/lib/schedule";

/** Header line: "12 EMIs of ₹3,949 · 3 paid · 9 left · 2 overdue" */
export function EmiSummary({ rows, emi, intervalMonths }: { rows: ScheduleRow[]; emi: string; intervalMonths: number | null }) {
  const paid = rows.filter((r) => r.status === "paid").length;
  const overdue = rows.filter((r) => r.status === "overdue").length;
  const left = rows.length - paid;
  const every = intervalMonths && intervalMonths > 1 ? ` every ${intervalMonths} months` : " monthly";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded-lg bg-blue-50 px-3 py-1.5 font-semibold text-blue-800 ring-1 ring-blue-200">
        {rows.length} EMIs of {inr(emi)}
        <span className="font-normal">{every}</span>
      </span>
      <span className="rounded-lg bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-800 ring-1 ring-emerald-200">{paid} paid</span>
      <span className="rounded-lg bg-slate-100 px-3 py-1.5 font-semibold text-slate-700 ring-1 ring-slate-200">{left} left</span>
      {overdue > 0 && (
        <span className="rounded-lg bg-red-50 px-3 py-1.5 font-semibold text-red-800 ring-1 ring-red-200">{overdue} overdue</span>
      )}
    </div>
  );
}

export function InstallmentTable({ rows }: { rows: ScheduleRow[] }) {
  if (rows.length === 0) return <p className="p-6 text-center text-sm text-slate-500">No installments.</p>;
  return (
    <>
      {/* phone */}
      <ul className="num divide-y divide-slate-100 md:hidden">
        {rows.map((r) =>
          r.status === "paid" ? (
            <li key={r.no} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-semibold">
                  #{r.no} · <span className="text-emerald-700">{inr(r.payment.paid_amount)}</span>
                </p>
                <Status status="paid" />
              </div>
              <p className="mt-0.5 text-sm text-slate-500">
                Paid {dmy(r.payment.paid_date)} · due {dmy(r.payment.due_date)}
                <Delay days={r.payment.delay_days} />
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                Balance <span className="font-medium text-slate-700">{inr(r.payment.balance_after)}</span>
                {r.payment.payment_mode && <> · {r.payment.payment_mode}</>}
                {r.payment.receipt_no != null && <> · Rcpt {r.payment.receipt_no}</>}
              </p>
              <RowFlags flags={r.payment.data_flags} />
            </li>
          ) : (
            <li key={r.no} className={`px-4 py-3 ${r.status === "overdue" ? "bg-red-50/50" : ""}`}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-semibold text-slate-700">
                  #{r.no} · {inr(r.due_amount)}
                </p>
                <Status status={r.status} />
              </div>
              <p className="mt-0.5 text-sm text-slate-500">Due {dmy(r.due_date)}</p>
            </li>
          ),
        )}
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
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) =>
              r.status === "paid" ? (
                <tr key={r.no} className="align-top">
                  <td className="px-4 py-2.5 text-slate-500">{r.no}</td>
                  <td className="px-4 py-2.5">{dmy(r.payment.due_date)}</td>
                  <td className="px-4 py-2.5 text-right">{inr(r.payment.due_amount)}</td>
                  <td className="px-4 py-2.5">
                    {dmy(r.payment.paid_date)}
                    <RowFlags flags={r.payment.data_flags} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-emerald-700">{inr(r.payment.paid_amount)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Delay days={r.payment.delay_days} plain />
                  </td>
                  <td className="px-4 py-2.5 text-right">{inr(r.payment.balance_after)}</td>
                  <td className="px-4 py-2.5">
                    {r.payment.payment_mode ?? "—"}
                    {r.payment.cheque_no && <span className="block text-xs text-slate-500">{r.payment.cheque_no}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{r.payment.receipt_no ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <Status status="paid" />
                  </td>
                </tr>
              ) : (
                <tr key={r.no} className={r.status === "overdue" ? "bg-red-50/50" : "text-slate-500"}>
                  <td className="px-4 py-2.5">{r.no}</td>
                  <td className={`px-4 py-2.5 ${r.status === "overdue" ? "font-medium text-red-800" : ""}`}>{dmy(r.due_date)}</td>
                  <td className="px-4 py-2.5 text-right">{inr(r.due_amount)}</td>
                  <td className="px-4 py-2.5">—</td>
                  <td className="px-4 py-2.5 text-right">—</td>
                  <td className="px-4 py-2.5 text-right">—</td>
                  <td className="px-4 py-2.5 text-right">—</td>
                  <td className="px-4 py-2.5">—</td>
                  <td className="px-4 py-2.5">—</td>
                  <td className="px-4 py-2.5">
                    <Status status={r.status} />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Status({ status }: { status: ScheduleRow["status"] }) {
  const s = {
    paid: "bg-emerald-100 text-emerald-800",
    overdue: "bg-red-100 text-red-800",
    upcoming: "bg-slate-100 text-slate-600",
  }[status];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${s}`}>{status}</span>;
}

export function Delay({ days, plain }: { days: number | null; plain?: boolean }) {
  if (days == null) return plain ? <>—</> : null;
  const late = days > 0;
  const text = late ? `${days} d late` : days < 0 ? `${-days} d early` : "on time";
  return (
    <span className={`${plain ? "" : "ml-1 "}${late ? "font-medium text-red-700" : "text-slate-500"}`}>
      {plain ? text : `· ${text}`}
    </span>
  );
}

export function RowFlags({ flags }: { flags: string[] }) {
  const shown = flags.filter((f) => f !== "receipt_no_unrecoverable");
  if (shown.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {shown.map((f) => (
        <span key={f} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
          {flagLabel(f)}
        </span>
      ))}
    </span>
  );
}

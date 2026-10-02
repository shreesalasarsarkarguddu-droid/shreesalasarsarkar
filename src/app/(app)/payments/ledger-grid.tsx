import { dmy, inr } from "@/lib/format";
import type { LedgerRow, LedgerSummary } from "@/lib/schedule";
import { modeText } from "../installments";

/** ₹ with 2 decimals: 3630 -> ₹3,630.00 */
const inr2 = (v: string | null | undefined) => (v == null ? "—" : inr(v).replace(/^(-?₹[\d,]+)$/, "$1.00"));

const th = "sticky top-0 z-10 whitespace-nowrap bg-slate-100 px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600";
const td = "whitespace-nowrap px-2.5 py-1.5";
const foot = "sticky bottom-0 border-t-2 border-slate-300 bg-white px-2.5 py-2";

/** Phone version of the grid: totals first, then one card per installment. */
export function LedgerCards({ rows, summary }: { rows: LedgerRow[]; summary: LedgerSummary }) {
  const receipts = rows.filter((r) => r.kind === "receipt").length;
  return (
    <div className="num">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
        <dt className="text-slate-500">Paid ({receipts} receipts)</dt>
        <dd className="text-right font-bold text-emerald-700">{inr2(summary.totalPaid)}</dd>
        <dt className="text-slate-500">Principal</dt>
        <dd className="text-right font-semibold">{inr2(summary.totalPrincipal)}</dd>
        <dt className="text-slate-500">Interest</dt>
        <dd className="text-right font-semibold">{inr2(summary.totalInterest)}</dd>
        <dt className="text-slate-500">Total due days</dt>
        <dd className={`text-right font-semibold ${summary.totalDueDays > 0 ? "text-red-700" : ""}`}>{summary.totalDueDays}</dd>
      </dl>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) =>
          r.kind === "receipt" ? (
            <li key={`r${r.sno}`} className="px-3 py-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate font-semibold">
                  #{r.sno} · <span className="text-emerald-700">{inr2(r.payment.paid_amount)}</span>
                  {r.im > 1 && <span className="ml-1 text-xs font-bold text-blue-700">IM {r.im}</span>}
                </p>
                <span className="shrink-0 text-slate-600">{dmy(r.payment.paid_date)}</span>
              </div>
              <p className="text-xs text-slate-500">
                Due {dmy(r.payment.due_date)} · {inr2(r.payment.due_amount)}
                {r.dueDays > 0 && <span className="font-semibold text-red-700"> · {r.dueDays} d late</span>}
              </p>
              <p className="text-xs text-slate-500">
                Rcpt {r.payment.receipt_no ?? "—"} · {modeText(r.payment)}
                {r.payment.cheque_no && <> · {r.payment.cheque_no}</>}
              </p>
              <p className="text-xs text-slate-500">
                P {inr2(r.principal)} · I {inr2(r.interest)} · Bal <b className="text-slate-700">{inr2(r.payment.balance_after)}</b>
              </p>
            </li>
          ) : (
            <li key={`d${r.sno}`} className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${r.status === "overdue" ? "bg-red-50 text-red-900" : "text-slate-500"}`}>
              <span>
                #{r.sno} · {inr2(r.dueAmount)}
              </span>
              <span className={r.status === "overdue" ? "font-semibold" : ""}>
                {dmy(r.dueDate)} · {r.status === "overdue" ? "Overdue" : "Upcoming"}
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

export function LedgerGrid({ rows, summary }: { rows: LedgerRow[]; summary: LedgerSummary }) {
  const receipts = rows.filter((r) => r.kind === "receipt").length;
  return (
    <table className="num w-full border-separate border-spacing-0 text-[13px]">
      <thead>
        <tr>
          <th className={th}>S.No</th>
          <th className={`${th} text-right`}>Inst. amt</th>
          <th className={th}>Due date</th>
          <th className={th}>Receipt no.</th>
          <th className={th}>Cash/Bank</th>
          <th className={th}>Cheque no.</th>
          <th className={`${th} text-right`}>Paid amt</th>
          <th className={`${th} text-center`}>IM</th>
          <th className={th}>Paid date</th>
          <th className={`${th} text-right`}>Principal</th>
          <th className={`${th} text-right`}>Interest</th>
          <th className={`${th} text-right`}>Balance</th>
          <th className={`${th} text-right`}>Due days</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) =>
          r.kind === "receipt" ? (
            <tr key={`r${r.sno}`} className="even:bg-slate-50/60">
              <td className={`${td} text-slate-500`}>{r.sno}</td>
              <td className={`${td} text-right`}>{inr2(r.payment.due_amount)}</td>
              <td className={td}>{dmy(r.payment.due_date)}</td>
              <td className={td}>{r.payment.receipt_no ?? "—"}</td>
              <td className={td}>{modeText(r.payment)}</td>
              <td className={td}>{r.payment.cheque_no ?? ""}</td>
              <td className={`${td} text-right font-semibold text-emerald-700`}>{inr2(r.payment.paid_amount)}</td>
              <td className={`${td} text-center ${r.im > 1 ? "font-bold text-blue-700" : ""}`}>{r.im}</td>
              <td className={td}>{dmy(r.payment.paid_date)}</td>
              <td className={`${td} text-right`}>{inr2(r.principal)}</td>
              <td className={`${td} text-right`}>{inr2(r.interest)}</td>
              <td className={`${td} text-right font-medium`}>{inr2(r.payment.balance_after)}</td>
              <td className={`${td} text-right ${r.dueDays > 0 ? "font-semibold text-red-700" : "text-slate-500"}`}>{r.dueDays}</td>
            </tr>
          ) : (
            <tr key={`d${r.sno}`} className={r.status === "overdue" ? "bg-red-50 text-red-900" : "text-slate-400"}>
              <td className={td}>{r.sno}</td>
              <td className={`${td} text-right`}>{inr2(r.dueAmount)}</td>
              <td className={`${td} ${r.status === "overdue" ? "font-semibold" : ""}`}>{dmy(r.dueDate)}</td>
              <td className={td} colSpan={10}>
                {r.status === "overdue" ? "Overdue — not paid" : "Upcoming"}
              </td>
            </tr>
          ),
        )}
      </tbody>
      <tfoot>
        <tr className="font-bold">
          <td colSpan={6} className={`${foot} text-right text-xs uppercase tracking-wide text-slate-600`}>
            Total ({receipts} receipts · {summary.emisPaid} EMIs)
          </td>
          <td className={`${foot} text-right text-emerald-700`}>{inr2(summary.totalPaid)}</td>
          <td className={`${foot} text-center`}>{summary.emisPaid}</td>
          <td className={foot} />
          <td className={`${foot} text-right`}>{inr2(summary.totalPrincipal)}</td>
          <td className={`${foot} text-right`}>{inr2(summary.totalInterest)}</td>
          <td className={foot} />
          <td className={`${foot} text-right text-red-700`}>{summary.totalDueDays}</td>
        </tr>
      </tfoot>
    </table>
  );
}

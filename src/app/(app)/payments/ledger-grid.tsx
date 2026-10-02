import { dmy, inr } from "@/lib/format";
import type { LedgerRow, LedgerSummary } from "@/lib/schedule";
import { modeText } from "../installments";

/** ₹ with 2 decimals: 3630 -> ₹3,630.00 */
const inr2 = (v: string | null | undefined) => (v == null ? "—" : inr(v).replace(/^(-?₹[\d,]+)$/, "$1.00"));

const th = "sticky top-0 z-10 whitespace-nowrap bg-slate-100 px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600";
const td = "whitespace-nowrap px-2.5 py-1.5";
const foot = "sticky bottom-0 border-t-2 border-slate-300 bg-white px-2.5 py-2";

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

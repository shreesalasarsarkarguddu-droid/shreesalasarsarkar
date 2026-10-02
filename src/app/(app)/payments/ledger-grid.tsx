import { dmy, inr } from "@/lib/format";
import type { ScheduleRow } from "@/lib/schedule";

// ---- exact money helpers (paise as bigint)
function toPaise(v: string | null | undefined): bigint {
  if (!v) return 0n;
  const neg = v.startsWith("-");
  const [i, f = ""] = v.replace("-", "").split(".");
  const p = BigInt(i || "0") * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -p : p;
}
function fromPaise(p: bigint): string {
  const neg = p < 0n;
  const a = neg ? -p : p;
  return `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}
/** round(a * b / c) for non-negative a, b and positive c */
function mulDivRound(a: bigint, b: bigint, c: bigint): bigint {
  return (a * b * 2n + c) / (2n * c);
}
const inr2 = (p: bigint) => inr(fromPaise(p)).replace(/^(-?₹[\d,]+)$/, "$1.00");

export type GridTotals = { paid: bigint; principal: bigint; interest: bigint; dueDays: number; count: number };

/**
 * Splits each payment into principal + interest in the same ratio as the loan
 * (interest share = loan interest / loan total), like the old software.
 * IM = number of EMIs the payment covers (paid / EMI, rounded, at least 1).
 */
export function gridData(rows: ScheduleRow[], loanInterest: string, loanTotal: string, emi: string) {
  const I = toPaise(loanInterest);
  const T = toPaise(loanTotal);
  const E = toPaise(emi);
  const totals: GridTotals = { paid: 0n, principal: 0n, interest: 0n, dueDays: 0, count: 0 };
  const lines = rows.map((r) => {
    if (r.status !== "paid") return { r, interest: 0n, principal: 0n, im: 0, dueDays: 0 };
    const paid = toPaise(r.payment.paid_amount);
    const interest = T > 0n && paid > 0n ? mulDivRound(paid, I, T) : 0n;
    const principal = paid - interest;
    const im = E > 0n ? Math.max(1, Number((paid * 2n + E) / (2n * E))) : 1;
    const dueDays = Math.max(0, r.payment.delay_days ?? 0);
    totals.paid += paid;
    totals.principal += principal;
    totals.interest += interest;
    totals.dueDays += dueDays;
    totals.count += 1;
    return { r, interest, principal, im, dueDays };
  });
  return { lines, totals };
}

const th = "sticky top-0 z-10 whitespace-nowrap bg-slate-100 px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600";
const td = "whitespace-nowrap px-2.5 py-1.5";

export function LedgerGrid({ rows, loanInterest, loanTotal, emi }: { rows: ScheduleRow[]; loanInterest: string; loanTotal: string; emi: string }) {
  const { lines, totals } = gridData(rows, loanInterest, loanTotal, emi);
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
        {lines.map(({ r, interest, principal, im, dueDays }) =>
          r.status === "paid" ? (
            <tr key={r.no} className="even:bg-slate-50/60">
              <td className={`${td} text-slate-500`}>{r.no}</td>
              <td className={`${td} text-right`}>{inr2(toPaise(r.payment.due_amount))}</td>
              <td className={td}>{dmy(r.payment.due_date)}</td>
              <td className={td}>{r.payment.receipt_no ?? "—"}</td>
              <td className={td}>{r.payment.payment_mode ?? "—"}</td>
              <td className={td}>{r.payment.cheque_no ?? ""}</td>
              <td className={`${td} text-right font-semibold text-emerald-700`}>{inr2(toPaise(r.payment.paid_amount))}</td>
              <td className={`${td} text-center`}>{im}</td>
              <td className={td}>{dmy(r.payment.paid_date)}</td>
              <td className={`${td} text-right`}>{inr2(principal)}</td>
              <td className={`${td} text-right`}>{inr2(interest)}</td>
              <td className={`${td} text-right font-medium`}>{inr2(toPaise(r.payment.balance_after))}</td>
              <td className={`${td} text-right ${dueDays > 0 ? "font-semibold text-red-700" : "text-slate-500"}`}>{dueDays}</td>
            </tr>
          ) : (
            <tr key={r.no} className={r.status === "overdue" ? "bg-red-50 text-red-900" : "text-slate-400"}>
              <td className={td}>{r.no}</td>
              <td className={`${td} text-right`}>{inr2(toPaise(r.due_amount))}</td>
              <td className={`${td} ${r.status === "overdue" ? "font-semibold" : ""}`}>{dmy(r.due_date)}</td>
              <td className={td} colSpan={10}>
                {r.status === "overdue" ? "Overdue — not paid" : "Upcoming"}
              </td>
            </tr>
          ),
        )}
      </tbody>
      <tfoot>
        <tr className="font-bold">
          <td colSpan={6} className="sticky bottom-0 border-t-2 border-slate-300 bg-white px-2.5 py-2 text-right text-xs uppercase tracking-wide text-slate-600">
            Total ({totals.count} paid)
          </td>
          <td className="sticky bottom-0 border-t-2 border-slate-300 bg-white px-2.5 py-2 text-right text-emerald-700">{inr2(totals.paid)}</td>
          <td className="sticky bottom-0 border-t-2 border-slate-300 bg-white" colSpan={2} />
          <td className="sticky bottom-0 border-t-2 border-slate-300 bg-white px-2.5 py-2 text-right">{inr2(totals.principal)}</td>
          <td className="sticky bottom-0 border-t-2 border-slate-300 bg-white px-2.5 py-2 text-right">{inr2(totals.interest)}</td>
          <td className="sticky bottom-0 border-t-2 border-slate-300 bg-white" />
          <td className="sticky bottom-0 border-t-2 border-slate-300 bg-white px-2.5 py-2 text-right text-red-700">{totals.dueDays}</td>
        </tr>
      </tfoot>
    </table>
  );
}

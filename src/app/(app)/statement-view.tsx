import Link from "next/link";
import { BUSINESS } from "@/lib/business";
import type { StatementData } from "@/lib/statement";
import { PrintButton } from "./reports/day-book/print-button";

/** "2025-03-25" -> "25/03/2025" */
const d = (v: string | null | undefined) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : "");
/** "108920.00" -> "1,08,920.00" (Indian grouping, 2 decimals) */
function amt(v: string | null | undefined): string {
  if (v == null || v === "") return "";
  const neg = v.startsWith("-");
  const [i, f = ""] = v.replace("-", "").split(".");
  const last3 = i.slice(-3);
  const rest = i.slice(0, -3);
  const g = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${neg ? "-" : ""}${g}.${(f + "00").slice(0, 2)}`;
}

function Line({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="grid grid-cols-[110px_10px_1fr] text-[12px] leading-5">
      <span>{label}</span>
      <span>:</span>
      <span className="font-medium uppercase">{value ?? ""}</span>
    </div>
  );
}

export function StatementView({ s, backHref }: { s: StatementData; backHref: string }) {
  const cell = "border border-slate-400 px-1.5 py-[3px]";
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href={backHref} className="text-sm font-medium text-blue-700">
          ← Back
        </Link>
        <PrintButton />
      </div>

      {/* A4 sheet - on phones it scrolls sideways inside this frame instead of widening the page */}
      <p className="text-xs text-slate-500 md:hidden print:hidden">Swipe sideways to see the full statement.</p>
      <div className="overflow-x-auto rounded-lg print:overflow-visible">
      <article className="statement mx-auto w-[210mm] min-w-[210mm] bg-white p-[8mm] text-black shadow ring-1 ring-slate-200 print:w-auto print:min-w-0 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <header className="flex items-start justify-between border-b-2 border-black pb-1">
          <div>
            <p className="text-lg font-extrabold tracking-wide">{BUSINESS.name}</p>
            <p className="text-[12px]">{BUSINESS.address}</p>
            <p className="text-[12px]">Mobile No. : {BUSINESS.phones}</p>
          </div>
          <div className="text-right text-[12px]">
            <p className="font-bold tracking-wide">ACCOUNT STATEMENT</p>
            <p>
              Folio No.: <b>{s.folio}</b>
            </p>
          </div>
        </header>

        <section className="grid grid-cols-2 border-b border-black">
          <div className="border-r border-black py-1 pr-2">
            <p className="text-[12px] font-bold">Borrower :</p>
            <Line label="Name" value={s.borrower.name} />
            <Line label="Father's Name" value={s.borrower.father} />
            <Line label="Address" value={s.borrower.address} />
            <Line label="Mob./Ph. No." value={s.borrower.mobile} />
          </div>
          <div className="py-1 pl-2">
            <p className="text-[12px] font-bold">Guarantor :</p>
            <Line label="Name" value={s.guarantor.name} />
            <Line label="Father's Name" value={s.guarantor.father} />
            <Line label="Address" value={s.guarantor.address} />
            <Line label="Mob./Ph. No." value={s.guarantor.mobile} />
          </div>
        </section>

        <section className="grid grid-cols-2 border-b border-black">
          <div className="border-r border-black py-1 pr-2">
            <p className="text-[12px] font-bold">Vehicle :</p>
            <Line label="New/Used" value={s.vehicle.condition} />
            <Line label="Model" value={s.vehicle.model} />
            <Line label="Color" value={s.vehicle.color} />
            <Line label="Chassis No." value={s.vehicle.chassis} />
            <Line label="Engine No." value={s.vehicle.engine} />
            <Line label="Make" value={s.vehicle.make} />
            <Line label="Vehicle No." value={s.vehicle.number} />
          </div>
          <div className="py-1 pl-2">
            <p className="text-[12px] font-bold">Finance :</p>
            <Line label="Agreement Date" value={d(s.finance.agreementDate)} />
            <Line label="Ins. Ex. Date" value={d(s.finance.insuranceExpiry)} />
            <Line label="Total Months" value={s.finance.months} />
            <Line label="Finance Amt." value={amt(s.finance.finance)} />
            <Line label="Interest Amt." value={amt(s.finance.interest)} />
            <Line label="Agreement Amt." value={amt(s.finance.agreement)} />
            <Line label="Hire Purchase" value={amt(s.finance.hp)} />
            <Line label="Total Amt." value={amt(s.finance.total)} />
          </div>
        </section>

        <table className="num mt-1 w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-center font-bold leading-tight">
              <th className={cell}>S.NO.</th>
              <th className={cell}>INSTALMENT AMOUNT</th>
              <th className={cell}>DUE DATE</th>
              <th className={cell}>RECEIPT NO.</th>
              <th className={cell}>PAID AMOUNT</th>
              <th className={cell}>NO. OF INSTALMENT</th>
              <th className={cell}>PAID DATE</th>
              <th className={cell}>PRINCIPAL AMOUNT</th>
              <th className={cell}>INTEREST AMOUNT</th>
              <th className={cell}>BALANCE</th>
              <th className={cell}>DAYS LATE</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) =>
              r.kind === "receipt" ? (
                <tr key={`r${r.sno}`} className="break-inside-avoid">
                  <td className={`${cell} text-right`}>{r.sno}.</td>
                  <td className={`${cell} text-right`}>{amt(r.payment.due_amount)}</td>
                  <td className={`${cell} text-center`}>{d(r.payment.due_date)}</td>
                  <td className={`${cell} text-right`}>{r.payment.receipt_no ?? ""}</td>
                  <td className={`${cell} text-right`}>{amt(r.payment.paid_amount)}</td>
                  <td className={`${cell} text-right`}>{r.im}</td>
                  <td className={`${cell} text-center`}>{d(r.payment.paid_date)}</td>
                  <td className={`${cell} text-right`}>{amt(r.principal)}</td>
                  <td className={`${cell} text-right`}>{amt(r.interest)}</td>
                  <td className={`${cell} text-right`}>{amt(r.payment.balance_after)}</td>
                  <td className={`${cell} text-right`}>{r.dueDays > 0 ? r.dueDays : ""}</td>
                </tr>
              ) : (
                <tr key={`d${r.sno}`} className="break-inside-avoid">
                  <td className={`${cell} text-right`}>{r.sno}.</td>
                  <td className={`${cell} text-right`}>{amt(r.dueAmount)}</td>
                  <td className={`${cell} text-center`}>{d(r.dueDate)}</td>
                  <td className={cell} />
                  <td className={cell} />
                  <td className={cell} />
                  <td className={cell} />
                  <td className={cell} />
                  <td className={cell} />
                  <td className={cell} />
                  <td className={cell} />
                </tr>
              ),
            )}
          </tbody>
          <tfoot>
            <tr className="break-inside-avoid font-bold">
              <td className={cell} colSpan={4}>
                Total :
              </td>
              <td className={`${cell} text-right`}>{amt(s.summary.totalPaid)}</td>
              <td className={`${cell} text-right`}>{s.summary.emisPaid}</td>
              <td className={cell} />
              <td className={`${cell} text-right`}>{amt(s.summary.totalPrincipal)}</td>
              <td className={`${cell} text-right`}>{amt(s.summary.totalInterest)}</td>
              <td className={cell} />
              <td className={`${cell} text-right`}>{s.summary.totalDueDays || ""}</td>
            </tr>
          </tfoot>
        </table>

        <section className="mt-2 break-inside-avoid border border-black p-2 text-[11.5px] leading-snug">
          <p>
            I am <b className="uppercase">{s.borrower.name}</b> son of <b className="uppercase">{s.borrower.father ?? "—"}</b> resident{" "}
            <b className="uppercase">{s.borrower.address ?? "—"}</b> have read the conditions carefully and will pay my installment accordingly. In case
            of late payment I will pay Rs. {BUSINESS.lateFeePerDay} per Day per installment. If two consecutive installments are not paid in that case
            either I will surrender the vehicle to you or you can take possession of vehicle by sending your person and in that case I will bear Rs.{" "}
            {BUSINESS.recoveryTravelExpense} as travel expense of your person. After this action you can sell vehicle to recover your amount. After sell
            of vehicle if any amount would due on my side, I take oath, that I will pay that amount immediately.
          </p>
          <div className="mt-6 flex items-end justify-between">
            <p className="font-semibold">
              Note : If installment is paid after due date, late fee Rs. {BUSINESS.lateFeePerDay} per day per installment will be charged.
            </p>
            <p className="shrink-0 pl-6 font-semibold">Signature</p>
          </div>
        </section>
      </article>
      </div>
    </div>
  );
}

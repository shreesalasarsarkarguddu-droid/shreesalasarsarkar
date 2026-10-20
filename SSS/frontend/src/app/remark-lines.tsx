import { dateTimeIST, dmy } from "@/lib/format";
import type { Remark } from "@/lib/remarks";
import { todayIST } from "@/lib/schedule";

/** Visit remarks under an unpaid EMI: "19/10/2026 05:30 PM · RAMESH: salary par dega · will pay 22/10/2026". */
export function RemarkLines({ items, className = "" }: { items: Remark[]; className?: string }) {
  if (items.length === 0) return null;
  const today = todayIST();
  return (
    <ul className={`space-y-0.5 text-xs ${className}`}>
      {items.map((r) => {
        const broken = !r.paid_after && r.promise_date != null && r.promise_date < today;
        return (
          <li key={r.id} className={`whitespace-normal rounded px-1.5 py-0.5 ${broken ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
            🗒 {dateTimeIST(r.created_at)} · <b>{r.by_name}</b>: “{r.remark}”
            {r.promise_date && (
              <>
                {" "}
                · will pay <b>{dmy(r.promise_date)}</b>
                {broken && " · not paid"}
                {r.promise_date === today && !r.paid_after && " · today"}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

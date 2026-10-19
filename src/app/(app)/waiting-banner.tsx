import { dmy, inr } from "@/lib/format";
import { fromPaise, toPaise } from "@/lib/schedule";
import type { WaitingPayment } from "@/lib/ledger";
import { paymentModeText } from "@/lib/payment";

/** Money collected by a collection man that is not counted yet (waits for the night cash count). */
export function WaitingBanner({ waiting, canApprove }: { waiting: WaitingPayment[]; canApprove: boolean }) {
  if (waiting.length === 0) return null;
  const total = fromPaise(waiting.reduce((t, w) => t + toPaise(w.paid_amount), 0n));
  return (
    <section className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
      <p className="font-semibold">
        ⏳ {inr(total)} collected, waiting for approval — not in the balance yet. Do not collect it again.
      </p>
      <ul className="num mt-1 space-y-0.5 text-xs">
        {waiting.map((w) => (
          <li key={w.receipt_no}>
            Rcpt {w.receipt_no} · {inr(w.paid_amount)} · {paymentModeText(w.payment_mode, w.bank_name, w.parts)} · paid {dmy(w.paid_date)}
          </li>
        ))}
      </ul>
      {canApprove && (
        <a href="/approvals" className="mt-2 inline-block font-semibold text-blue-700">
          Approve on the Approvals page →
        </a>
      )}
    </section>
  );
}

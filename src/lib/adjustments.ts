// Charges, discounts, closing and reschedules on one account (table public.adjustments).
import { fromPaise, toPaise, type LedgerRow, type Reschedule } from "@/lib/schedule";
import { inr } from "@/lib/format";

export const ADJ_COLUMNS =
  "id, kind, amount::text, entry_date, reason, new_emi::text, next_due, cancelled_at, cancel_reason, created_at";

export type Adjustment = {
  id: number;
  kind: "penalty" | "discount" | "settle" | "reschedule";
  amount: string;
  entry_date: string;
  reason: string;
  new_emi: string | null;
  next_due: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
};

export type AdjSummary = {
  /** charges - discounts - write-off (adds to what is owed) */
  net: string;
  charges: string;
  discounts: string; // negative or 0 (discounts + write-off)
  settled: boolean;
  reschedule: Reschedule | null;
};

export function summarizeAdjustments(list: Adjustment[] | null | undefined): AdjSummary {
  const live = (list ?? []).filter((a) => !a.cancelled_at);
  let charges = 0n;
  let discounts = 0n;
  for (const a of live) {
    const v = toPaise(a.amount);
    if (v > 0n) charges += v;
    else discounts += v;
  }
  const rs = live
    .filter((a) => a.kind === "reschedule")
    .sort((x, y) => y.created_at.localeCompare(x.created_at) || y.id - x.id)[0];
  return {
    net: fromPaise(charges + discounts),
    charges: fromPaise(charges),
    discounts: fromPaise(discounts),
    settled: live.some((a) => a.kind === "settle"),
    reschedule: rs && rs.new_emi && rs.next_due ? { createdAt: rs.created_at, date: rs.entry_date, emi: rs.new_emi, nextDue: rs.next_due } : null,
  };
}

/** "₹1,21,768 + ₹500 fees − ₹100 discount" under the total, or undefined when nothing was added */
export function adjText(original: string, s: AdjSummary): string | undefined {
  if (toPaise(s.charges) === 0n && toPaise(s.discounts) === 0n) return undefined;
  const parts = [inr(original)];
  if (toPaise(s.charges) !== 0n) parts.push(`+ ${inr(s.charges)} fees`);
  if (toPaise(s.discounts) !== 0n) parts.push(`− ${inr(fromPaise(-toPaise(s.discounts)))} discount`);
  return parts.join(" ");
}

/** Late fee for the EMIs overdue today: days late x fee per day, for each overdue EMI (the rule printed on statements). */
export function suggestLateFee(rows: LedgerRow[], today: string, perDay: number): { amount: number; note: string } {
  const days = rows
    .filter((r): r is Extract<LedgerRow, { kind: "due" }> => r.kind === "due" && r.status === "overdue" && !!r.dueDate)
    .map((r) => Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(r.dueDate + "T00:00:00Z")) / 86400000))
    .filter((d) => d > 0);
  const total = days.reduce((t, d) => t + d, 0);
  return {
    amount: total * perDay,
    note: days.length ? `${days.length} overdue EMI${days.length > 1 ? "s" : ""}, ${total} days late in all × ₹${perDay}/day` : "",
  };
}

export const ADJ_LABEL: Record<Adjustment["kind"], string> = {
  penalty: "Late fee / charge",
  discount: "Discount",
  settle: "Closed / settled",
  reschedule: "Rescheduled",
};

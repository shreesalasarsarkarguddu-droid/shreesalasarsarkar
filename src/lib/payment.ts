export const PAYMENT_MODES = ["CASH", "CHEQUE", "SBI", "BANK"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** One part of a split payment (e.g. cash + bank on one receipt). */
export type PaymentPart = { mode: PaymentMode; amount: number | string; bank_name?: string | null; reference_no?: string | null };

const rs = (v: number | string) => `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** "CASH ₹3,000 + BANK SBI ₹1,747" for split payments, "BANK · SBI" / "CASH" otherwise. */
export function paymentModeText(mode: string | null | undefined, bank?: string | null, parts?: PaymentPart[] | null): string {
  if (!mode) return "—";
  if (mode === "SPLIT" && parts?.length) return parts.map((p) => `${p.mode}${p.bank_name ? ` ${p.bank_name}` : ""} ${rs(p.amount)}`).join(" + ");
  return mode === "BANK" && bank ? `BANK · ${bank}` : mode;
}

/** Cash part of a payment (all of it for CASH, the cash part of a split, 0 otherwise). */
export function cashPart(mode: string, amount: number | string, parts?: PaymentPart[] | null): number {
  if (mode === "SPLIT") return (parts ?? []).filter((p) => p.mode === "CASH").reduce((t, p) => t + Number(p.amount), 0);
  return mode === "CASH" ? Number(amount) : 0;
}

/**
 * Charges taken on the same receipt as an EMI payment (OD = delay, seize charge, other with a note).
 * paid_amount is only the EMI part (it lowers the balance); money received = paid_amount + charges.
 */
export type Charges = { od_amount: string; od_days: number; seize_amount: string; other_amount: string; other_note: string | null; charges: string };

/** "OD ₹90 (9 days) · Seize ₹500 · RC transfer ₹200", or null without charges. */
export function chargesText(c: Charges | null | undefined): string | null {
  if (!c || !(Number(c.charges) > 0)) return null;
  const out: string[] = [];
  if (Number(c.od_amount) > 0) out.push(`OD ${rs(c.od_amount)}${c.od_days > 0 ? ` (${c.od_days} days)` : ""}`);
  if (Number(c.seize_amount) > 0) out.push(`Seize ${rs(c.seize_amount)}`);
  if (Number(c.other_amount) > 0) out.push(`${c.other_note || "Other"} ${rs(c.other_amount)}`);
  return out.join(" · ");
}

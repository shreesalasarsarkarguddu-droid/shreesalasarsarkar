import { buildLedger, fromPaise, toPaise, type LedgerRow, type LedgerSummary, type PaymentRow } from "@/lib/schedule";
import { summarizeAdjustments, type Adjustment } from "@/lib/adjustments";
import type { Charges, PaymentPart } from "@/lib/payment";
import type { Remark } from "@/lib/remarks";
import type { ZoneInfo } from "@/lib/zones";
import { get } from "@/lib/api";

export type NewPaymentRecord = Charges & {
  id: number;
  installment_no: number;
  due_date: string | null;
  paid_date: string;
  delay_days: number | null;
  payment_mode: string;
  reference_no: string | null;
  bank_name: string | null;
  receipt_no: number;
  installments_covered: number;
  due_amount: string | null;
  paid_amount: string;
  balance_after: string;
  created_at: string;
  parts: PaymentPart[] | null;
  /** zone receipt book ("NARHARPUR-2"); null = main book */
  receipt_book: string | null;
};

/** A new-system payment in the same shape as legacy payment rows. */
export function mapNewPayment(p: NewPaymentRecord): PaymentRow {
  return {
    id: -p.id, // negative: never collides with legacy payment ids in React keys
    installment_no: p.installment_no,
    due_amount: p.due_amount,
    due_date: p.due_date,
    paid_amount: p.paid_amount,
    paid_date: p.paid_date,
    balance_after: p.balance_after,
    delay_days: p.delay_days,
    payment_mode: p.payment_mode,
    cheque_no: p.reference_no,
    bank_name: p.bank_name,
    receipt_no: p.receipt_no,
    receipt_book: p.receipt_book,
    installments_covered: p.installments_covered,
    data_flags: [],
    created_at: p.created_at,
    parts: p.parts,
    charges: Number(p.charges) > 0 ? p : null,
  };
}

/** Exact money: a + sum(list) and a - b on "1234.50" strings (paise bigint inside). */
export function addMoney(base: string, list: string[]): string {
  return fromPaise(list.reduce((t, v) => t + toPaise(v), toPaise(base)));
}
export function subMoney(a: string, b: string): string {
  return fromPaise(toPaise(a) - toPaise(b));
}
export const byInstallment = <T extends { installment_no: number }>(a: T, b: T) => a.installment_no - b.installment_no;

/** A payment taken by a collection man that waits for the night cash count (not counted yet). */
export type WaitingPayment = {
  receipt_no: number; receipt_book: string | null; paid_amount: string; paid_date: string; payment_mode: string; bank_name: string | null;
  parts: PaymentPart[] | null; created_at: string;
  /** OD / seize / other on the same receipt */
  charges: string;
};
/**
 * Receipt numbers for the payment window, inside the account's receipt book (its zone's open book, else MAIN):
 * last used (app / you / old software), the next free number in your own books, and the zone book itself.
 */
export type ReceiptHint = {
  last_app: number | null; last_mine: number | null; last_old: number | null; books: { from: number; to: number; next: number | null }[];
  series?: { code: string; zone: string; book_no: number; start: number; last: number | null; next: number } | null;
};

/** For the charges in the payment window: OD rate and its start (oldest unpaid EMI's due date), seizure, admin or not. */
export type ChargeInfo = {
  od_rate: number; od_from: string | null; seized: boolean; seized_on: string | null; admin: boolean;
  /** may type another OD (admin, "Late fees & discounts", or everyone while Settings allows collectors) */
  can_change_od: boolean;
  /** may give a seized vehicle back ("Seize vehicles") */
  can_release: boolean;
};

export type Ledger = {
  /** OD rate, seizure (null when it could not be read: then no charges are offered) */
  charges: ChargeInfo | null;
  /** admin only: edit / cancel the payments taken in this app from the Collect window */
  canFix: boolean;
  /** payments taken in this app on this account (for edit / cancel) */
  appPayments: NewPaymentRecord[];
  zoneInfo: ZoneInfo | null;
  waiting: WaitingPayment[];
  remarks: Remark[];
  receiptHint: ReceiptHint | null;
  source: "old" | "new";
  refId: number;
  folio: string;
  name: string;
  father: string | null;
  mobile: string | null;
  address: string | null;
  vehicle: string | null;
  total: string;
  emi: string;
  intervalMonths: number | null;
  paid: string;
  balance: string;
  rows: LedgerRow[];
  summary: LedgerSummary;
};

/** What the API sends for the Collect window (GET /api/ledger/{source}/{ref}); the rows are built here. */
type LedgerResponse = {
  source: "old" | "new"; refId: number; raw: unknown; waiting: WaitingPayment[]; receiptHint: ReceiptHint | null; remarks: Remark[];
  zoneInfo: ZoneInfo | null; canFix: boolean; charges?: ChargeInfo | null;
};

/** Everything the Collect Payment window needs for one pending account (null when it can no longer take payments). */
export async function getLedger(source: "old" | "new", refId: number): Promise<Ledger | null> {
  const r = await get<LedgerResponse>(`/ledger/${source}/${refId}`);
  const ledger = ledgerOnly(r.raw, source, refId);
  return ledger ? { ...ledger, waiting: r.waiting, receiptHint: r.receiptHint, remarks: r.remarks, zoneInfo: r.zoneInfo, charges: r.charges ?? null, canFix: r.canFix } : null;
}

function ledgerOnly(raw: unknown, source: "old" | "new", refId: number): Omit<Ledger, "waiting" | "receiptHint" | "remarks" | "zoneInfo" | "canFix" | "charges"> | null {
  if (source === "old") {
    const a = raw;
    if (!a) return null;
    const acc = a as unknown as {
      id: number; sno: number; fno: number; ledger: string; borrower_name: string; borrower_father: string | null; borrower_mobile: string | null;
      borrower_address: string | null; registration_no: string | null; vehicle_model: string | null; agreement_date: string | null;
      tenure_months: number | null; interval_months: number | null; total_amount: string; emi_amount: string; interest_amount: string;
      finance_amount: string; legacy_paid: string; legacy_payments: (PaymentRow & { ledger: string })[]; payments: NewPaymentRecord[];
      adjustments: Adjustment[];
    };
    const adj = summarizeAdjustments(acc.adjustments);
    if (adj.settled) return null; // closed in this app
    const fresh = acc.payments.map(mapNewPayment);
    const payments = [...acc.legacy_payments.filter((p) => p.ledger === acc.ledger), ...fresh].sort(byInstallment);
    const paid = addMoney(acc.legacy_paid, fresh.map((p) => p.paid_amount));
    const total = addMoney(acc.total_amount, [adj.net]);
    const balance = subMoney(total, paid);
    const { rows, summary } = buildLedger({
      installments: acc.tenure_months, intervalMonths: acc.interval_months, agreementDate: acc.agreement_date,
      emi: acc.emi_amount, total: acc.total_amount, finance: acc.finance_amount, interest: acc.interest_amount,
      payments, settled: toPaise(balance) <= 0n, adjustments: adj.net, reschedule: adj.reschedule,
    });
    return {
      appPayments: acc.payments, source, refId, folio: String(acc.fno), name: acc.borrower_name, father: acc.borrower_father, mobile: acc.borrower_mobile,
      address: acc.borrower_address, vehicle: [acc.vehicle_model, acc.registration_no].filter(Boolean).join(" · ") || null,
      total, emi: adj.reschedule?.emi ?? acc.emi_amount, intervalMonths: acc.interval_months, paid, balance, rows, summary,
    };
  }

  const l = raw;
  if (!l) return null;
  const loan = l as unknown as {
    id: number; folio_no: string; vehicle_model: string; vehicle_no: string | null; agreement_date: string;
    installments: number; interval_months: number; total_amount: string; emi_amount: string; interest_amount: string; finance_amount: string;
    borrowers: { full_name: string; father_name: string | null; mobile: string | null; address: string | null };
    payments: NewPaymentRecord[];
    adjustments: Adjustment[];
  };
  const adj = summarizeAdjustments(loan.adjustments);
  const payments = loan.payments.map(mapNewPayment).sort(byInstallment);
  const paid = addMoney("0", payments.map((p) => p.paid_amount));
  const total = addMoney(loan.total_amount, [adj.net]);
  const balance = subMoney(total, paid);
  const { rows, summary } = buildLedger({
    installments: loan.installments, intervalMonths: loan.interval_months, agreementDate: loan.agreement_date,
    emi: loan.emi_amount, total: loan.total_amount, finance: loan.finance_amount, interest: loan.interest_amount,
    payments, settled: toPaise(balance) <= 0n, adjustments: adj.net, reschedule: adj.reschedule,
  });
  return {
    appPayments: loan.payments, source, refId, folio: loan.folio_no, name: loan.borrowers.full_name, father: loan.borrowers.father_name,
    mobile: loan.borrowers.mobile, address: loan.borrowers.address,
    vehicle: [loan.vehicle_model, loan.vehicle_no].filter(Boolean).join(" · ") || null,
    total, emi: adj.reschedule?.emi ?? loan.emi_amount, intervalMonths: loan.interval_months, paid, balance, rows, summary,
  };
}

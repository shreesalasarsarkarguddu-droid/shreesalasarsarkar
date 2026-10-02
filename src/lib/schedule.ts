// One calculation for every installment view (account page, loan page, payment window, printed statement).
//
// Rows = one row per receipt (like the old software), then one row per EMI not yet covered.
//   * IM (installments covered): stored on new receipts; for legacy receipts max(1, round(paid / EMI)).
//   * The EMI amount never changes. A receipt covering IM EMIs moves the next due date forward by IM x interval.
//   * Principal / interest split of each receipt: interest = paid x (loan interest / finance amount),
//     principal = paid - interest  (matches the old software's printed Account Statement).
//   * Arrears = EMIs due up to today x EMI - total paid (never below 0, never above the balance).
// Money is kept as "1234.50" strings and calculated in integer paise (bigint) - never floats.

export type PaymentRow = {
  id: number;
  installment_no: number;
  due_amount: string | null;
  due_date: string | null;
  paid_amount: string;
  paid_date: string | null;
  balance_after: string | null;
  delay_days: number | null;
  payment_mode: string | null;
  cheque_no: string | null;
  bank_name?: string | null;
  receipt_no: number | null;
  installments_covered?: number | null;
  data_flags: string[];
};

export type ReceiptRow = {
  kind: "receipt";
  sno: number;
  payment: PaymentRow;
  im: number;
  principal: string;
  interest: string;
  dueDays: number;
};
export type DueRow = {
  kind: "due";
  sno: number;
  dueDate: string | null;
  dueAmount: string;
  status: "overdue" | "upcoming";
};
export type LedgerRow = ReceiptRow | DueRow;

export type LedgerSummary = {
  emis: number; // total EMIs in the loan
  emisPaid: number; // EMIs covered by receipts
  emisLeft: number;
  overdue: number; // uncovered EMIs whose due date has passed
  arrears: string; // money overdue today
  totalPaid: string;
  totalPrincipal: string;
  totalInterest: string;
  totalDueDays: number;
};

// ---------------------------------------------------------------- date + money helpers
/** "2026-01-31" + 1 month -> "2026-02-28" (clamped to month end, like PostgreSQL). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Today's date in India as "YYYY-MM-DD". */
export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export function toPaise(v: string | number | null | undefined): bigint {
  if (v == null || v === "") return 0n;
  const s = String(v);
  const neg = s.startsWith("-");
  const [i, f = ""] = s.replace("-", "").split(".");
  const p = BigInt(i || "0") * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -p : p;
}
export function fromPaise(p: bigint): string {
  const neg = p < 0n;
  const a = neg ? -p : p;
  return `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}
/** round(a * b / c), half away from zero; c > 0 */
function mulDivRound(a: bigint, b: bigint, c: bigint): bigint {
  const n = a * b;
  const neg = n < 0n;
  const q = ((neg ? -n : n) * 2n + c) / (2n * c);
  return neg ? -q : q;
}

/** Legacy receipts have no stored IM: max(1, round(paid / EMI)). */
export function receiptIm(p: PaymentRow, emi: bigint): number {
  if (p.installments_covered && p.installments_covered > 0) return p.installments_covered;
  if (emi <= 0n) return 1;
  const paid = toPaise(p.paid_amount);
  return Math.max(1, Number((paid * 2n + emi) / (2n * emi)));
}

// ---------------------------------------------------------------- the ledger
export function buildLedger(opts: {
  installments: number | null;
  intervalMonths: number | null;
  agreementDate: string | null;
  emi: string;
  total: string;
  finance: string;
  interest: string;
  payments: PaymentRow[];
  /** fully paid / closed: list receipts only, no remaining EMI rows */
  settled?: boolean;
}): { rows: LedgerRow[]; summary: LedgerSummary } {
  const interval = Math.max(1, opts.intervalMonths ?? 1);
  const emi = toPaise(opts.emi);
  const finance = toPaise(opts.finance);
  const loanInterest = toPaise(opts.interest);
  const total = toPaise(opts.total);
  const today = todayIST();
  const payments = [...opts.payments].sort((a, b) => a.installment_no - b.installment_no || (a.paid_date ?? "").localeCompare(b.paid_date ?? ""));

  const rows: LedgerRow[] = [];
  let used = 0;
  let paid = 0n;
  let principalSum = 0n;
  let interestSum = 0n;
  let dueDaysSum = 0;
  let dueByToday = 0; // EMI slots whose due date has passed (covered or not)
  let lastDue: string | null = null;
  let lastIm = 1;

  payments.forEach((p, i) => {
    const amount = toPaise(p.paid_amount);
    const im = receiptIm(p, emi);
    const interest = finance > 0n ? mulDivRound(amount, loanInterest, finance) : 0n;
    const dueDays = Math.max(0, p.delay_days ?? 0);
    rows.push({ kind: "receipt", sno: i + 1, payment: p, im, principal: fromPaise(amount - interest), interest: fromPaise(interest), dueDays });
    if (p.due_date) {
      for (let j = 0; j < im; j++) if (addMonths(p.due_date, j * interval) <= today) dueByToday++;
      lastDue = p.due_date;
      lastIm = im;
    }
    used += im;
    paid += amount;
    principalSum += amount - interest;
    interestSum += interest;
    dueDaysSum += dueDays;
  });

  const emis = Math.max(opts.installments ?? 0, used);
  const remaining = opts.settled ? 0 : Math.max(0, emis - used);
  let overdue = 0;
  for (let k = 1; k <= remaining; k++) {
    const dueDate: string | null = lastDue
      ? addMonths(lastDue, (lastIm + k - 1) * interval)
      : opts.agreementDate
        ? addMonths(opts.agreementDate, (used + k) * interval)
        : null;
    const isOverdue = !!dueDate && dueDate < today;
    if (isOverdue) overdue++;
    if (dueDate && dueDate <= today) dueByToday++;
    rows.push({ kind: "due", sno: payments.length + k, dueDate, dueAmount: opts.emi, status: isOverdue ? "overdue" : "upcoming" });
  }

  const balance = total - paid;
  let arrears = emi * BigInt(dueByToday) - paid;
  if (arrears > balance) arrears = balance;
  if (arrears < 0n || opts.settled) arrears = 0n;

  return {
    rows,
    summary: {
      emis,
      emisPaid: Math.min(used, emis),
      emisLeft: remaining,
      overdue,
      arrears: fromPaise(arrears),
      totalPaid: fromPaise(paid),
      totalPrincipal: fromPaise(principalSum),
      totalInterest: fromPaise(interestSum),
      totalDueDays: dueDaysSum,
    },
  };
}

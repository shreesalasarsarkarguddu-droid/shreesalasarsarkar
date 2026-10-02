// Builds the full installment schedule (one row per EMI) from the loan terms + recorded payments.
// Paid rows come from the payment records. Unpaid rows get a due date continuing from the last
// known due date (or from the agreement date when nothing is paid yet), stepping by the interval.

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
  receipt_no: number | null;
  data_flags: string[];
};

export type ScheduleRow =
  | { no: number; status: "paid"; payment: PaymentRow }
  | { no: number; status: "overdue" | "upcoming"; due_date: string | null; due_amount: string };

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

export function buildSchedule(opts: {
  installments: number | null;
  intervalMonths: number | null;
  agreementDate: string | null;
  emi: string;
  payments: PaymentRow[];
}): ScheduleRow[] {
  const interval = Math.max(1, opts.intervalMonths ?? 1);
  const byNo = new Map<number, PaymentRow>();
  for (const p of opts.payments) if (!byNo.has(p.installment_no)) byNo.set(p.installment_no, p);
  const lastNo = Math.max(opts.installments ?? 0, ...byNo.keys(), 0);
  const today = todayIST();

  // Anchor for projecting due dates: the latest paid row that has a due date.
  let anchorNo = 0;
  let anchorDate = opts.agreementDate;
  for (const p of opts.payments) {
    if (p.due_date && p.installment_no >= anchorNo) {
      anchorNo = p.installment_no;
      anchorDate = p.due_date;
    }
  }

  const rows: ScheduleRow[] = [];
  for (let no = 1; no <= lastNo; no++) {
    const paid = byNo.get(no);
    if (paid) {
      rows.push({ no, status: "paid", payment: paid });
      continue;
    }
    const due = anchorDate ? addMonths(anchorDate, (no - anchorNo) * interval) : null;
    rows.push({ no, status: due && due < today ? "overdue" : "upcoming", due_date: due, due_amount: opts.emi });
  }
  // Payments recorded beyond the schedule length are already included (lastNo covers them).
  return rows;
}

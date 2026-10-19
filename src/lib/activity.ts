// Wording for the activity log (data_audit). Shared by the Activity page and the Data page.

import { dateTimeIST, dmy } from "./format";

export type AuditRow = {
  id: number;
  at: string;
  by_name: string | null;
  action: string;
  subject?: string | null;
  ref?: { source: "old" | "new"; ref_id: number } | null;
  details: Record<string, unknown>;
};

export const ACTIONS: { key: string; label: string; group: string }[] = [
  { key: "payment", label: "Payment taken", group: "Money" },
  { key: "payment_edited", label: "Payment edited", group: "Fixes" },
  { key: "payment_cancelled", label: "Payment cancelled", group: "Fixes" },
  { key: "new_loan", label: "New loan", group: "Loans" },
  { key: "loan_edited", label: "Loan edited", group: "Fixes" },
  { key: "loan_deleted", label: "Loan deleted", group: "Fixes" },
  { key: "adjust_penalty", label: "Late fee added", group: "Money" },
  { key: "adjust_discount", label: "Discount given", group: "Money" },
  { key: "adjust_reschedule", label: "Rescheduled", group: "Money" },
  { key: "adjust_settle", label: "Account closed", group: "Money" },
  { key: "reopened", label: "Account reopened", group: "Fixes" },
  { key: "adjust_cancelled", label: "Fee / discount cancelled", group: "Fixes" },
  { key: "seize", label: "Vehicle seized", group: "Loans" },
  { key: "release", label: "Vehicle released", group: "Loans" },
  { key: "payment_pending", label: "Payment collected (waiting)", group: "Money" },
  { key: "payments_approved", label: "Payments approved", group: "Control" },
  { key: "payment_approved", label: "Payment approved", group: "Control" },
  { key: "payment_rejected", label: "Payment rejected", group: "Fixes" },
  { key: "cash_received", label: "Cash received", group: "Control" },
  { key: "assigned", label: "Collections assigned", group: "Control" },
  { key: "unassigned", label: "Collections removed", group: "Control" },
  { key: "book_add", label: "Receipt book given", group: "Control" },
  { key: "book_close", label: "Receipt book closed", group: "Control" },
  { key: "book_reopen", label: "Receipt book reopened", group: "Control" },
  { key: "book_delete", label: "Receipt book deleted", group: "Control" },
  { key: "zone_add", label: "Zone added", group: "Control" },
  { key: "zone_edit", label: "Zone changed", group: "Control" },
  { key: "zone_hide", label: "Zone hidden", group: "Control" },
  { key: "zone_show", label: "Zone shown again", group: "Control" },
  { key: "zone_delete", label: "Zone deleted", group: "Control" },
  { key: "signed_out", label: "Signed out by admin", group: "Admin" },
  { key: "user_archived", label: "User removed", group: "Admin" },
  { key: "user_restored", label: "User restored", group: "Admin" },
  { key: "user_added", label: "User added", group: "Admin" },
  { key: "user_changed", label: "User changed", group: "Admin" },
  { key: "password_reset", label: "Password reset", group: "Admin" },
  { key: "settings", label: "Settings changed", group: "Admin" },
  { key: "import", label: "Import", group: "Data" },
  { key: "restore_point", label: "Restore point", group: "Data" },
  { key: "restore", label: "Restore", group: "Data" },
  { key: "restore_file", label: "Restored from backup file", group: "Data" },
  { key: "delete", label: "Data deleted", group: "Data" },
];
const LABEL = Object.fromEntries(ACTIONS.map((a) => [a.key, a.label]));
export const actionLabel = (k: string) => LABEL[k] ?? k.replaceAll("_", " ");

const rs = (v: unknown) => `₹${Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const nice = (k: string) =>
  ({
    paid_amount: "amount", paid_date: "date", payment_mode: "mode", receipt_no: "receipt", reference_no: "cheque / ref",
    bank_name: "bank", installments_covered: "EMIs covered", full_name: "name", father_name: "father", date_of_birth: "date of birth",
    folio_no: "folio", emi_amount: "EMI", total_amount: "total", finance_amount: "finance", interest_amount: "interest",
    interest_rate: "rate %", installments: "no. of EMIs", interval_months: "interval",
  })[k] ?? k.replaceAll("_", " ");
// dates stored as 2026-03-15 (or full timestamps) read as 15/03/2026
const val = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? "—"
    : Array.isArray(v)
      ? v.join(", ") || "—"
      : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)
        ? dateTimeIST(v)
        : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
          ? dmy(v)
          : String(v);

/** "amount 5600 → 6000, date 15/03/2026 → 16/03/2026" */
export function changesText(c: unknown): string {
  if (!c || typeof c !== "object") return "";
  return Object.entries(c as Record<string, unknown>)
    .map(([k, v]) => {
      const c = v as { from?: unknown; to?: unknown } | null;
      return c && typeof c === "object" && "to" in c ? `${nice(k)} ${val(c.from)} → ${val(c.to)}` : `${nice(k)} ${val(v)}`;
    })
    .join(", ");
}

/** One line describing what happened. */
export function describe(a: AuditRow): string {
  const d = a.details ?? {};
  switch (a.action) {
    case "payment":
      return `${rs(d.amount)} · Rcpt ${val(d.receipt_no)} · ${val(d.mode)}${Number(d.emis) > 1 ? ` · ${d.emis} EMIs` : ""}`;
    case "payment_edited":
      return `Rcpt ${val(d.receipt_no)}: ${changesText(d.changes)} · Reason: ${val(d.reason)}`;
    case "payment_pending":
      return `${rs(d.amount)} · Rcpt ${val(d.receipt_no)} · ${val(d.mode)} · waiting for approval`;
    case "payments_approved":
      return `${val(d.count)} payment(s) · ${rs(d.amount)}${d.note ? ` · ${d.note}` : ""}${Number(d.failed) > 0 ? ` · ${d.failed} failed` : ""}`;
    case "payment_approved":
      return `Rcpt ${val(d.receipt_no)} · ${rs(d.amount)} · was ${val(d.why)}${d.note ? ` · ${d.note}` : ""}`;
    case "cash_received":
      return `${val(d.day)} · cash collected ${rs(d.expected_cash)} · received ${rs(d.received)}${Number(d.short) > 0 ? ` · SHORT ${rs(d.short)}` : Number(d.short) < 0 ? ` · extra ${rs(-Number(d.short))}` : " · matches"}${d.note ? ` · ${d.note}` : ""}`;
    case "book_add":
    case "book_close":
    case "book_reopen":
    case "book_delete":
      return `Receipts ${val(d.from_no)}–${val(d.to_no)}${d.note ? ` · ${d.note}` : ""}`;
    case "zone_add":
    case "zone_delete":
      return `receipts start at ${val(d.receipt_start)}`;
    case "zone_edit":
      return changesText(d.changes);
    case "zone_hide":
      return "hidden from the zone list in the loan form";
    case "zone_show":
      return "back in the zone list";
    case "assigned":
      return `${val(d.accounts)} account(s) for ${val(d.day)}${Number(d.moved_from_others) > 0 ? ` (${d.moved_from_others} moved from someone else)` : ""}`;
    case "unassigned":
      return `${val(d.removed)} account(s) removed from collection lists`;
    case "signed_out":
      return "signed out on every device";
    case "user_archived":
      return `login off, signed out, hidden from lists${Number(d.books_closed) ? ` · ${d.books_closed} receipt book(s) closed` : ""}`;
    case "user_restored":
      return "back in the users list (login still off until switched on)";
    case "payment_rejected":
      return `Rcpt ${val(d.receipt_no)} · ${rs(d.amount)}${d.collected_by ? ` by ${d.collected_by}` : ""} · Reason: ${val(d.reason)}`;
    case "payment_cancelled":
      return `Rcpt ${val(d.receipt_no)} · ${rs(d.amount)} on ${val(d.paid_date)} · Reason: ${val(d.reason)}`;
    case "new_loan":
      return `Finance ${rs(d.finance)} · Total ${rs(d.total)} · EMI ${rs(d.emi)} × ${val(d.emis)}`;
    case "loan_edited":
      return `${changesText(d.changes)} · Reason: ${val(d.reason)}`;
    case "loan_deleted":
      return `Reason: ${val(d.reason)}`;
    case "adjust_penalty":
    case "adjust_discount":
      return `${rs(Math.abs(Number(d.amount)))} · balance ${rs(d.owed_before)} → ${rs(d.owed_after)} · Reason: ${val(d.reason)}`;
    case "adjust_reschedule":
      return `New EMI ${rs(d.new_emi)} from ${val(d.next_due)} · balance ${rs(d.owed_after)} · Reason: ${val(d.reason)}`;
    case "adjust_settle":
      return `${Number(d.amount) < 0 ? `written off ${rs(-Number(d.amount))}` : "nothing left to pay"} · Reason: ${val(d.reason)}`;
    case "reopened":
    case "adjust_cancelled":
      return `${val(d.kind)} ${Number(d.amount) ? rs(Math.abs(Number(d.amount))) : ""} · balance now ${rs(d.owed_after)} · Reason: ${val(d.reason)}`;
    case "seize":
    case "release":
      return `${val(d.date)}${d.remarks ? ` · ${d.remarks}` : ""}`;
    case "user_added":
      return `${val(d.role)}${Array.isArray(d.permissions) && d.permissions.length ? ` · ${(d.permissions as string[]).join(", ")}` : ""}`;
    case "user_changed":
    case "settings":
      return changesText(d.changes);
    case "delete":
      return `deleted ${({ old: "old software data", new: "app entries", all: "all data" } as Record<string, string>)[d.scope as string] ?? val(d.scope)} (undo: restore point #${val(d.restore_point)})`;
    case "restore":
      return `restored restore point #${val(d.restored)} (state before saved as #${val(d.saved_before_restore)})`;
    case "restore_file":
      return `restored from ${val(d.file)}${d.taken ? ` (${d.taken})` : ""} · state before saved as restore point #${val(d.saved_before_restore)}`;
    case "restore_point":
      return `saved restore point #${val(d.restore_point)}`;
    case "import":
      return `imported files (restore point before: #${val(d.restore_point)})`;
    case "password_reset":
      return "password changed by the admin";
    default:
      return "";
  }
}

/** Link to the account / loan the entry is about. */
export function refHref(ref: AuditRow["ref"]): string | null {
  if (!ref) return null;
  return ref.source === "old" ? `/accounts/${ref.ref_id}` : `/loans/${ref.ref_id}`;
}

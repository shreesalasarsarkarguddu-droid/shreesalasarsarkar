// Wording for the activity log (data_audit). Shared by the Activity page and the Data page.

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
  { key: "seize", label: "Vehicle seized", group: "Loans" },
  { key: "release", label: "Vehicle released", group: "Loans" },
  { key: "user_added", label: "User added", group: "Admin" },
  { key: "user_changed", label: "User changed", group: "Admin" },
  { key: "password_reset", label: "Password reset", group: "Admin" },
  { key: "settings", label: "Settings changed", group: "Admin" },
  { key: "import", label: "Import", group: "Data" },
  { key: "restore_point", label: "Restore point", group: "Data" },
  { key: "restore", label: "Restore", group: "Data" },
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
const val = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") || "—" : String(v));

/** "amount 5600 → 6000, date 2026-03-15 → 2026-03-16" */
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
    case "payment_cancelled":
      return `Rcpt ${val(d.receipt_no)} · ${rs(d.amount)} on ${val(d.paid_date)} · Reason: ${val(d.reason)}`;
    case "new_loan":
      return `Finance ${rs(d.finance)} · Total ${rs(d.total)} · EMI ${rs(d.emi)} × ${val(d.emis)}`;
    case "loan_edited":
      return `${changesText(d.changes)} · Reason: ${val(d.reason)}`;
    case "loan_deleted":
      return `Reason: ${val(d.reason)}`;
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

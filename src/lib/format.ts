// Formatting helpers. Money arrives from the database as text (cast with ::text in queries),
// so amounts are formatted as strings and never pass through JavaScript floating point.

/** "121768.00" -> "₹1,21,768"; "-6440.50" -> "-₹6,440.50". Indian digit grouping. */
export function inr(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const negative = value.startsWith("-");
  const [intPart, frac = ""] = value.replace("-", "").split(".");
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  const paise = frac.replace(/0+$/, "") ? "." + frac.padEnd(2, "0").slice(0, 2) : "";
  return `${negative ? "-" : ""}₹${grouped}${paise}`;
}

/** True when a money string is greater than zero. */
export function isPositive(value: string | null | undefined): boolean {
  return value != null && !value.startsWith("-") && /[1-9]/.test(value);
}

/** True when a money string is below zero. */
export function isNegative(value: string | null | undefined): boolean {
  return value != null && value.startsWith("-") && /[1-9]/.test(value);
}

/** "2022-03-03" -> "03 Mar 2022" */
export function dmy(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[Number(m) - 1]} ${y}`;
}

const FLAG_LABELS: Record<string, string> = {
  test_or_zero_amount: "Test or zero-amount record",
  total_not_equal_parts: "Total ≠ finance + interest + agreement",
  address_or_contact_uncertain: "Address / contact text may be incomplete",
  mobile_invalid: "Mobile number looks invalid",
  mobile_missing: "No mobile number",
  fno_shared: "FNO is shared with another account",
  agreement_date_invalid: "Agreement date invalid",
  no_matching_account: "No matching account",
  account_in_other_ledger: "Recorded in the other ledger file",
  date_suspect: "Date looks wrong (before 2015)",
  receipt_no_unrecoverable: "Receipt no. not recoverable",
  balance_blank: "Balance blank in old data",
  negative_balance: "Overpaid (negative balance)",
};

export function flagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? flag;
}

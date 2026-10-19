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

// Dates: one format everywhere, DD/MM/YYYY (21/12/1993). Never month names.

/** "2022-03-03" -> "03/03/2022" */
export function dmy(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** "2022-03-03" -> "Thursday" */
export function weekday(ymd: string): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(ymd.slice(0, 10) + "T00:00:00Z").getUTCDay()];
}

/** "2022-03" -> "03/2022" (month-only labels) */
export function monthYear(ym: string): string {
  const [y, m] = ym.split("-");
  return `${m}/${y}`;
}

const istParts = (iso: string) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.day}/${p.month}/${p.year}`, time: `${p.hour}:${p.minute} ${String(p.dayPeriod ?? "").toUpperCase()}`.trim() };
};

/** A timestamp in India time: "21/12/1993" */
export const dateIST = (iso: string | null | undefined) => (iso ? istParts(iso).date : "—");
/** A timestamp in India time: "05:30 PM" */
export const timeIST = (iso: string | null | undefined) => (iso ? istParts(iso).time : "—");
/** A timestamp in India time: "21/12/1993 05:30 PM" */
export const dateTimeIST = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const p = istParts(iso);
  return `${p.date} ${p.time}`;
};

/** "21/12/1993" (or 21-12-1993, 21.12.1993) -> "1993-12-21"; "" when not a real date. */
export function parseDmy(text: string): string {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text.trim());
  if (!m) return "";
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
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

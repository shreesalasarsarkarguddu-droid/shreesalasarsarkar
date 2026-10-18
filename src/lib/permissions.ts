// What a staff login can be allowed to do. Admins can do everything (plus users / settings / data).
// Shared by the server (route guards) and the browser (the Users form), so no "server-only" here.
// The database enforces the same keys (public.has_perm), so hiding a button is never the only protection.

export const PERMISSIONS = [
  { key: "view_accounts", label: "View accounts", text: "See old and new accounts, installments and statements.", group: "Daily work" },
  { key: "collect", label: "Collect payments", text: "Take payments and print receipts.", group: "Daily work" },
  { key: "new_loan", label: "Create new loans", text: "Enter a new loan and borrower.", group: "Daily work" },
  { key: "seize", label: "Seize / release vehicles", text: "Mark a vehicle seized or release it.", group: "Daily work" },
  { key: "reports", label: "Reports", text: "Day Book, Due Installments, Seized Vehicles, Finance Details.", group: "Daily work" },
  { key: "backdate", label: "Back-dated payments", text: "Enter payments with an old date without waiting for approval.", group: "Extra powers" },
  { key: "approve", label: "Approve payments", text: "Approve or reject back-dated / big payments that wait for approval.", group: "Extra powers" },
  { key: "cash", label: "Cash closing & receipt books", text: "Receive each person's cash at day end; give out receipt books.", group: "Extra powers" },
  { key: "fix_entries", label: "Fix mistakes", text: "Edit or cancel payments; edit or delete wrong loans.", group: "Extra powers" },
  { key: "money", label: "Late fees & discounts", text: "Add late fees, give discounts, reschedule EMIs, close accounts.", group: "Extra powers" },
  { key: "activity", label: "Activity log", text: "See who did what and when.", group: "Extra powers" },
  { key: "backup", label: "Download backup", text: "Download the backup zip (it has every customer's details).", group: "Extra powers" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

/** Quick starting points in the Users form; every box can still be changed per person. */
export const PRESETS: { key: string; label: string; role: "admin" | "staff"; perms: Permission[] }[] = [
  { key: "collection", label: "Collection man", role: "staff", perms: ["view_accounts", "collect", "reports"] },
  { key: "manager", label: "Manager", role: "staff", perms: ["view_accounts", "collect", "new_loan", "seize", "reports", "backdate", "approve", "cash"] },
  { key: "viewer", label: "Viewer", role: "staff", perms: ["view_accounts", "reports"] },
  { key: "admin", label: "Admin", role: "admin", perms: [] },
];

export type Access = { role: "admin" | "staff"; permissions: readonly string[] };

export function can(a: Access | null | undefined, p: Permission): boolean {
  return !!a && (a.role === "admin" || a.permissions.includes(p));
}

/** Staff-control pages this person may open (top bar "Control" menu; Profile lists them on phones). */
export function controlLinks(access: Access): { href: string; label: string; text: string }[] {
  const isAdmin = access.role === "admin";
  return [
    { href: "/cash", label: "Daily cash", text: "Each person's collection and the cash handed in", ok: can(access, "cash") || can(access, "collect") },
    { href: "/approvals", label: "Approvals", text: "Back-dated or big payments waiting for approval", ok: can(access, "approve") },
    { href: "/receipt-books", label: "Receipt books", text: "Receipt number ranges for each person, skipped numbers", ok: can(access, "cash") },
    { href: "/activity", label: "Activity", text: "Who did what and when", ok: can(access, "activity") },
    { href: "/users", label: "Users", text: "Staff logins and what each person can do", ok: isAdmin },
    { href: "/settings", label: "Settings", text: "Telegram, WhatsApp, staff controls, backup and data", ok: isAdmin },
  ]
    .filter((l) => l.ok)
    .map(({ href, label, text }) => ({ href, label, text }));
}

/** First page this person may open (where to send them when they land somewhere they cannot use). */
export function homeFor(a: Access | null | undefined): string {
  if (a?.role === "admin") return "/dashboard";
  if (can(a, "view_accounts")) return "/accounts";
  if (can(a, "collect")) return "/payments";
  if (can(a, "new_loan")) return "/loans/new";
  if (can(a, "reports")) return "/reports";
  return "/profile";
}

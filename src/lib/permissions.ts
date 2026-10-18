// What a staff login can be allowed to do. Admins can do everything (plus users / settings / backup).
// Shared by the server (route guards) and the browser (the Users form), so no "server-only" here.
// The database enforces the same keys (public.has_perm), so hiding a button is never the only protection.

export const PERMISSIONS = [
  { key: "view_accounts", label: "View accounts", text: "See old and new accounts, installments and statements." },
  { key: "collect", label: "Collect payments", text: "Take payments and print receipts." },
  { key: "new_loan", label: "Create new loans", text: "Enter a new loan and borrower." },
  { key: "seize", label: "Seize / release vehicles", text: "Mark a vehicle seized or release it." },
  { key: "reports", label: "Reports", text: "Day Book, Due Installments, Seized Vehicles, Finance Details." },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

/** Quick starting points in the Users form; every box can still be changed per person. */
export const PRESETS: { key: string; label: string; role: "admin" | "staff"; perms: Permission[] }[] = [
  { key: "collection", label: "Collection man", role: "staff", perms: ["view_accounts", "collect", "reports"] },
  { key: "manager", label: "Manager", role: "staff", perms: ["view_accounts", "collect", "new_loan", "seize", "reports"] },
  { key: "viewer", label: "Viewer", role: "staff", perms: ["view_accounts", "reports"] },
  { key: "admin", label: "Admin", role: "admin", perms: [] },
];

export type Access = { role: "admin" | "staff"; permissions: readonly string[] };

export function can(a: Access | null | undefined, p: Permission): boolean {
  return !!a && (a.role === "admin" || a.permissions.includes(p));
}

/** First page this person may open (where to send them when they land somewhere they cannot use). */
export function homeFor(a: Access | null | undefined): string {
  if (can(a, "view_accounts")) return "/accounts";
  if (can(a, "collect")) return "/payments";
  if (can(a, "new_loan")) return "/loans/new";
  if (can(a, "reports")) return "/reports";
  return "/profile";
}

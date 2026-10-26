import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { autodealUrl } from "@/lib/autodeal";
import { can, controlLinks, type Access, type Permission } from "@/lib/permissions";

// Top bar on computers: drop-down groups. Bottom bar on phones keeps one-tap buttons.
const FINANCE = {
  href: "/finance",
  label: "Finance",
  children: [
    { href: "/loans/new", label: "New Loan", perm: "new_loan" },
    { href: "/accounts", label: "Accounts", perm: "view_accounts" },
    { href: "/payments", label: "Collect", perm: "collect" },
    { href: "/my-collections", label: "My collection list", perm: "collect" },
  ],
} as const satisfies { children: readonly { href: string; label: string; perm: Permission }[] } & Record<string, unknown>;

// Phone bottom bar (and the Reports / Profile entries of the top bar).
const ITEMS = [
  {
    href: "/accounts",
    label: "Accounts",
    perm: "view_accounts",
    icon: (
      <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />
    ),
  },
  {
    href: "/my-collections",
    label: "My list",
    perm: "collect",
    icon: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" strokeLinecap="round" />
        <path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    href: "/payments",
    label: "Collect",
    perm: "collect",
    icon: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
  },
  {
    href: "/loans/new",
    label: "New Loan",
    perm: "new_loan",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "/reports",
    label: "Reports",
    perm: "reports",
    icon: (
      <path d="M5 20V10M12 20V4M19 20v-7" strokeLinecap="round" />
    ),
    // shown as a drop-down in the top bar (phones open the /reports list)
    children: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/reports/day-book", label: "Day Book" },
      { href: "/reports/due-installments", label: "Due Installments" },
      { href: "/reports/seized", label: "Seized Vehicles" },
      { href: "/reports/finance-details", label: "Finance Details" },
    ],
  },
  {
    href: "/profile",
    label: "Profile",
    perm: null,
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" strokeLinecap="round" />
      </>
    ),
  },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

/** Links shown in the top bar on tablet/desktop. */
export function TopNav({ access }: { access: Access }) {
  const pathname = usePathname();
  const finance = FINANCE.children.filter((c) => can(access, c.perm));
  const financeActive = finance.some((c) => isActive(pathname, c.href));
  const reports = ITEMS.find((i) => i.href === "/reports")!;
  const profile = ITEMS.find((i) => i.href === "/profile")!;
  const control = controlLinks(access);
  const autodeal = autodealUrl(access);
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
      {finance.length > 0 && <Dropdown label={FINANCE.label} active={financeActive} items={finance} pathname={pathname} />}
      {can(access, "reports") && "children" in reports && (
        <Dropdown
          label={reports.label}
          active={isActive(pathname, reports.href) || isActive(pathname, "/dashboard")}
          items={reports.children}
          pathname={pathname}
        />
      )}
      <Link
        href={profile.href}
        aria-current={isActive(pathname, profile.href) ? "page" : undefined}
        className={`flex h-10 items-center rounded-lg px-3 text-sm font-medium ${
          isActive(pathname, profile.href) ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        {profile.label}
      </Link>
      {control.length > 0 && (
        <Dropdown label="Control" active={control.some((c) => isActive(pathname, c.href))} items={control} pathname={pathname} />
      )}
      {autodeal && (
        <a href={autodeal} className="flex h-10 items-center rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100">
          Auto Deal
        </a>
      )}
      {access.power && (
        <a href="/power" className="flex h-10 items-center rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50">
          Site power
        </a>
      )}
    </nav>
  );
}

function Dropdown({
  label,
  active,
  items,
  pathname,
}: {
  label: string;
  active: boolean;
  items: readonly { href: string; label: string }[];
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 items-center gap-1 rounded-lg px-3 text-sm font-medium ${
          active || open ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        {label}
        <svg aria-hidden viewBox="0 0 20 20" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none">
          <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-11 z-30 min-w-52 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-slate-200">
          {items.map((c, i) => (
            <Link
              key={c.href}
              role="menuitem"
              href={c.href}
              onClick={() => setOpen(false)}
              className={`flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium ${
                isActive(pathname, c.href) ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span className="num w-4 text-xs text-slate-400">{i + 1}</span>
              {c.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Fixed bottom bar on phones. */
export function BottomNav({ access }: { access: Access }) {
  const pathname = usePathname();
  const items = ITEMS.filter((i) => i.perm === null || can(access, i.perm));
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${
                  active ? "text-blue-700" : "text-slate-500"
                }`}
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2.25 : 1.75}
                >
                  {item.icon}
                </svg>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Phones: ☰ in the header opens every page in one list (the bottom bar keeps the one-tap buttons). */
export function MenuButton({ access, name, signOut }: { access: Access; name: string; signOut: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const reports = ITEMS.find((i) => i.href === "/reports")!;
  const autodeal = autodealUrl(access);
  const groups: { title: string; items: readonly { href: string; label: string }[] }[] = [
    { title: "Finance", items: FINANCE.children.filter((c) => can(access, c.perm)) },
    { title: "Reports", items: can(access, "reports") && "children" in reports ? [{ href: "/reports", label: "All reports" }, ...reports.children] : [] },
    { title: "Control", items: controlLinks(access) },
    { title: "Me", items: [{ href: "/profile", label: "Profile" }] },
  ];

  // a link closes it; so do Escape and a tap outside; the page behind does not scroll
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
        </svg>
      </button>
      {/* on <body>: the header's backdrop blur would otherwise squeeze the panel into the header */}
      {open && createPortal(
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-900/50" />
          <nav className="absolute inset-y-0 right-0 flex w-[85%] max-w-sm flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{name}</p>
                <p className="text-xs capitalize text-slate-500">{access.role}</p>
              </div>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-2xl text-slate-500 hover:bg-slate-100"
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {groups
                .filter((g) => g.items.length > 0)
                .map((g) => (
                  <div key={g.title} className="py-1">
                    <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.title}</p>
                    {g.items.map((c) => (
                      <Link
                        key={c.href}
                        href={c.href}
                        onClick={() => setOpen(false)}
                        aria-current={pathname === c.href ? "page" : undefined}
                        className={`flex h-11 items-center rounded-lg px-3 text-[15px] font-medium ${
                          pathname === c.href ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {c.label}
                      </Link>
                    ))}
                  </div>
                ))}
              {(autodeal || access.power) && (
                <div className="py-1">
                  <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">More</p>
                  {autodeal && (
                    <a href={autodeal} className="flex h-11 items-center justify-between rounded-lg px-3 text-[15px] font-medium text-slate-700 hover:bg-slate-100">
                      Auto Deal <span aria-hidden className="text-slate-400">↗</span>
                    </a>
                  )}
                  {access.power && (
                    <a href="/power" className="flex h-11 items-center rounded-lg px-3 text-[15px] font-semibold text-red-700 hover:bg-red-50">
                      Site power (on / off)
                    </a>
                  )}
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">{signOut}</div>
          </nav>
        </div>,
        document.body,
      )}
    </div>
  );
}

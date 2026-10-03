"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Top bar on computers: drop-down groups. Bottom bar on phones keeps one-tap buttons.
const FINANCE = {
  href: "/finance",
  label: "Finance",
  children: [
    { href: "/loans/new", label: "New Loan" },
    { href: "/accounts", label: "Accounts" },
    { href: "/payments", label: "Collect" },
  ],
} as const;

// Phone bottom bar (and the Reports / Profile entries of the top bar).
const ITEMS = [
  {
    href: "/accounts",
    label: "Accounts",
    icon: (
      <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />
    ),
  },
  {
    href: "/payments",
    label: "Collect",
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
    icon: (
      <path d="M5 20V10M12 20V4M19 20v-7" strokeLinecap="round" />
    ),
    // shown as a drop-down in the top bar (phones open the /reports list)
    children: [
      { href: "/reports/day-book", label: "Day Book" },
      { href: "/reports/due-installments", label: "Due Installments" },
      { href: "/reports/seized", label: "Seized Vehicles" },
      { href: "/reports/finance-details", label: "Finance Details" },
    ],
  },
  {
    href: "/profile",
    label: "Profile",
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
export function TopNav() {
  const pathname = usePathname();
  const financeActive = FINANCE.children.some((c) => isActive(pathname, c.href));
  const reports = ITEMS.find((i) => i.href === "/reports")!;
  const profile = ITEMS.find((i) => i.href === "/profile")!;
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
      <Dropdown label={FINANCE.label} active={financeActive} items={FINANCE.children} pathname={pathname} />
      {"children" in reports && <Dropdown label={reports.label} active={isActive(pathname, reports.href)} items={reports.children} pathname={pathname} />}
      <Link
        href={profile.href}
        aria-current={isActive(pathname, profile.href) ? "page" : undefined}
        className={`flex h-10 items-center rounded-lg px-3 text-sm font-medium ${
          isActive(pathname, profile.href) ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        {profile.label}
      </Link>
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
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${ITEMS.length}, minmax(0, 1fr))` }}>
        {ITEMS.map((item) => {
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

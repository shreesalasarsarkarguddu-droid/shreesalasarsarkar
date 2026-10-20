// A settings card that opens and closes when its title is clicked (native <details>: works without JavaScript,
// and what is typed inside is kept while it is closed).

export function Section({
  title,
  hint,
  badge,
  danger,
  defaultOpen,
  children,
}: {
  title: string;
  hint?: string;
  badge?: React.ReactNode;
  danger?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className={`group rounded-xl bg-white ring-1 ${danger ? "ring-red-200" : "ring-slate-200"}`}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-semibold ${danger ? "text-red-700" : "text-slate-800"}`}>{title}</span>
          {hint && <span className="block text-xs text-slate-500">{hint}</span>}
        </span>
        {badge}
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
        </svg>
      </summary>
      <div className="space-y-4 border-t border-slate-100 p-4">{children}</div>
    </details>
  );
}

/** small On / Off pill for a section title */
export function OnOff({ on }: { on: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${on ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
      {on ? "On" : "Off"}
    </span>
  );
}

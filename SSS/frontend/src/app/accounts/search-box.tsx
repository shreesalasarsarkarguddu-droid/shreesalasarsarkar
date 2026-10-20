"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/** Debounced search: updates ?q= in the URL; the server does the actual search. */
export function SearchBox({ basePath = "/accounts", placeholder = "Name, FNO, mobile or vehicle no." }: { basePath?: string; placeholder?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const sp = new URLSearchParams(params.toString());
      if (next.trim()) sp.set("q", next.trim());
      else sp.delete("q");
      sp.delete("page");
      startTransition(() => router.replace(`${basePath}?${sp.toString()}`));
    }, 350);
  }

  return (
    <div className="relative">
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="9" cy="9" r="6" />
        <path d="m14 14 4 4" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search accounts"
        className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-10 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
      />
      {pending && (
        <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
      )}
    </div>
  );
}

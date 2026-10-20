// Shown instantly while any page in the app loads (pages with their own loading.tsx use that instead).
export default function Loading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-44 animate-pulse rounded bg-slate-200" />
      <div className="h-24 animate-pulse rounded-xl bg-white ring-1 ring-slate-200" />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="h-40 animate-pulse rounded-xl bg-white ring-1 ring-slate-200" />
        <div className="h-40 animate-pulse rounded-xl bg-white ring-1 ring-slate-200" />
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-white ring-1 ring-slate-200" />
    </div>
  );
}

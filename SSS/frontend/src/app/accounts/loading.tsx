export default function Loading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-40 animate-pulse rounded bg-slate-200" />
      <div className="h-12 animate-pulse rounded-xl bg-slate-200" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl bg-white ring-1 ring-slate-200" />
      ))}
    </div>
  );
}

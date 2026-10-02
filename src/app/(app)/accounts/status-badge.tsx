export function StatusBadge({ ledger, seized }: { ledger: "pending" | "closed"; seized: boolean | null }) {
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          ledger === "pending" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
        }`}
      >
        {ledger === "pending" ? "Pending" : "Fully paid"}
      </span>
      {seized && <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">Seized</span>}
    </span>
  );
}

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MAIN_ZONE, type ZoneInfo } from "@/lib/zones";
import { setAccountZone, type CtlResult } from "./control-actions";

/**
 * The account's zone with a drop-down to change it (asks once before saving).
 * Its receipts then use that zone's receipt book; receipts already written stay where they are.
 */
export function ZonePicker({
  source, refId, info, onChanged, compact = false,
}: {
  source: "old" | "new"; refId: number; info: ZoneInfo; onChanged?: () => void; compact?: boolean;
}) {
  const router = useRouter();
  const current = info.in_list ? info.zone ?? "" : "";
  const [want, setWant] = useState<string | null>(null);
  const [r, setR] = useState<CtlResult | null>(null);
  const [pending, start] = useTransition();
  const name = (z: string) => (z === "" ? `${MAIN_ZONE} (main)` : z);

  const save = (z: string) =>
    start(async () => {
      const res = await setAccountZone(source, refId, z);
      setR(res);
      setWant(null);
      if (res.ok) {
        onChanged?.();
        router.refresh();
      }
    });

  const label = compact ? "text-xs font-medium text-slate-500" : "text-xs text-slate-500";
  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : ""}>
      <span className={`${label} ${compact ? "" : "block"}`}>Zone</span>
      {info.can_change ? (
        <select
          aria-label="Zone"
          value={want ?? current}
          disabled={pending}
          onChange={(e) => {
            setR(null);
            setWant(e.target.value === current ? null : e.target.value);
          }}
          className={`rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold ${compact ? "h-9" : "mt-0.5 h-10 w-full max-w-xs"}`}
        >
          <option value="">{name("")}</option>
          {info.zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-sm font-semibold" title="Only the admin can change a zone that is already set">
          {name(current)}
        </span>
      )}
      {!info.in_list && info.zone && <span className="text-xs text-slate-500">(old text: {info.zone})</span>}
      {want !== null && (
        <span className={`flex flex-wrap items-center gap-2 text-sm ${compact ? "" : "mt-1"}`}>
          <span className="text-amber-900">
            Move to <b>{name(want)}</b>? New receipts use its book.
          </span>
          <button type="button" disabled={pending} onClick={() => save(want)} className="h-8 rounded-lg bg-blue-700 px-3 text-xs font-semibold text-white disabled:opacity-60">
            {pending ? "Saving…" : "Yes, change"}
          </button>
          <button type="button" disabled={pending} onClick={() => setWant(null)} className="h-8 rounded-lg px-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
        </span>
      )}
      {r && <span className={`text-xs ${r.ok ? "text-emerald-700" : "text-red-700"}`}>{r.ok ? r.message : r.error}</span>}
    </div>
  );
}

import { dmy } from "@/lib/format";
import type { SeizureEvent } from "./seize-control";

/** Red banner while seized + full seize/release history (newest first). */
export function SeizureInfo({ seized, events, fromOldSoftware }: { seized: boolean; events: SeizureEvent[]; fromOldSoftware: boolean }) {
  const sorted = [...events].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
  const lastSeize = sorted.find((e) => e.action === "seize");
  if (!seized && sorted.length === 0) return null;
  return (
    <section className="space-y-3">
      {seized && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900 ring-1 ring-red-200">
          <p className="font-bold">Vehicle seized</p>
          <p>
            {lastSeize ? (
              <>
                Since {dmy(lastSeize.action_date)}
                {lastSeize.remarks && <> · {lastSeize.remarks}</>}
              </>
            ) : fromOldSoftware ? (
              "Marked seized in the old software (date not recorded)."
            ) : null}
          </p>
        </div>
      )}
      {sorted.length > 0 && (
        <div className="rounded-xl bg-white ring-1 ring-slate-200">
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Seizure history</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {sorted.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                <span>
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-bold uppercase ${e.action === "seize" ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>
                    {e.action === "seize" ? "Seized" : "Released"}
                  </span>
                  {dmy(e.action_date)}
                  {e.remarks && <span className="text-slate-600"> · {e.remarks}</span>}
                </span>
                <span className="text-xs text-slate-500">by {e.staff?.full_name ?? "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

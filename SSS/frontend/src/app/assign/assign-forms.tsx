import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dmy, inr } from "@/lib/format";
import { assignAccounts, unassignAccounts, type CtlResult } from "../control-actions";

export type Candidate = {
  source: "old" | "new"; ref_id: number; folio: string; borrower_name: string; mobile: string | null; address: string | null;
  emi: number; balance: number; arrears: number; overdue_emis: number; next_due: string | null; seized: boolean; assigned_to: string | null;
};
export type Assigned = {
  id: number; user_id: string; collector: string; source: "old" | "new"; ref_id: number; folio: string; borrower_name: string;
  address: string | null; arrears: number | null; emi: number | null; collected: number; note: string | null;
};

const rs = (v: number | null | undefined) => inr(String(v ?? 0));
const key = (c: { source: string; ref_id: number }) => `${c.source}:${c.ref_id}`;

export function AssignPicker({ day, candidates, staff }: { day: string; candidates: Candidate[]; staff: { id: string; name: string }[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [userId, setUserId] = useState("");
  const [note, setNote] = useState("");
  const [r, setR] = useState<CtlResult | null>(null);
  const [pending, start] = useTransition();
  const total = useMemo(
    () => candidates.filter((c) => picked.has(key(c))).reduce((t, c) => t + Number(c.arrears > 0 ? c.arrears : c.emi), 0),
    [candidates, picked],
  );
  const toggle = (k: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const allOn = candidates.length > 0 && candidates.every((c) => picked.has(key(c)));

  return (
    <section className="rounded-xl bg-white ring-1 ring-slate-200">
      <div className="sticky top-14 z-10 space-y-2 rounded-t-xl border-b border-slate-100 bg-white/95 p-3 backdrop-blur">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Give to</span>
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Choose collection man…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-40 flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-600">Note for him (optional)</span>
            <input className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Kandel side, collect full arrears" />
          </label>
          <button
            type="button"
            disabled={pending || picked.size === 0 || !userId}
            onClick={() =>
              start(async () => {
                const items = candidates.filter((c) => picked.has(key(c))).map((c) => ({ source: c.source, ref_id: c.ref_id }));
                const res = await assignAccounts(day, userId, items, note);
                setR(res);
                if (res.ok) {
                  setPicked(new Set());
                  router.refresh();
                }
              })
            }
            className="h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {pending ? "Assigning…" : `Assign ${picked.size || ""} for ${dmy(day)}`}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-5 w-5 accent-blue-700"
              checked={allOn}
              onChange={() => setPicked(allOn ? new Set() : new Set(candidates.map(key)))}
            />
            Tick all {candidates.length}
          </label>
          {picked.size > 0 && (
            <span className="num text-slate-600">
              {picked.size} ticked · {rs(total)} to collect
            </span>
          )}
          {r && <span className={r.ok ? "text-emerald-700" : "text-red-700"}>{r.ok ? r.message : r.error}</span>}
        </div>
      </div>

      {candidates.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-500">No accounts match. Change “Show” or the search.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {candidates.map((c) => (
            <li key={key(c)}>
              <label className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 ${picked.has(key(c)) ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-blue-700" checked={picked.has(key(c))} onChange={() => toggle(key(c))} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{c.borrower_name}</span>
                    <span className="text-xs text-slate-500">{c.folio}</span>
                    {c.seized && <span className="text-xs font-semibold text-red-700">Seized</span>}
                    {c.assigned_to && <span className="rounded bg-amber-50 px-1.5 text-xs font-semibold text-amber-800">with {c.assigned_to}</span>}
                  </span>
                  {c.address && <span className="block truncate text-xs text-slate-500">{c.address.replace(/\s+/g, " ")}</span>}
                </span>
                <span className="num shrink-0 text-right text-sm">
                  <span className={`block font-semibold ${c.arrears > 0 ? "text-red-700" : ""}`}>{rs(c.arrears > 0 ? c.arrears : c.emi)}</span>
                  <span className="block text-xs text-slate-500">
                    {c.overdue_emis > 0 ? `${c.overdue_emis} overdue` : c.next_due ? `due ${dmy(c.next_due)}` : ""}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {candidates.length === 300 && <p className="p-3 text-xs text-slate-500">Showing the first 300 — search to narrow down.</p>}
    </section>
  );
}

export function AssignedList({ items }: { items: Assigned[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [r, setR] = useState<CtlResult | null>(null);
  const [pending, start] = useTransition();
  if (items.length === 0) return <p className="rounded-xl bg-white p-4 text-sm text-slate-500 ring-1 ring-slate-200">Nothing assigned yet.</p>;

  const groups = new Map<string, Assigned[]>();
  for (const i of items) groups.set(i.collector, [...(groups.get(i.collector) ?? []), i]);
  return (
    <div className="space-y-3">
      {picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await unassignAccounts([...picked]);
                setR(res);
                if (res.ok) {
                  setPicked(new Set());
                  router.refresh();
                }
              })
            }
            className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-red-700 ring-1 ring-slate-300 hover:bg-red-50"
          >
            {pending ? "Removing…" : `Remove ${picked.size} from the list`}
          </button>
        </div>
      )}
      {r && <p className={`text-sm ${r.ok ? "text-emerald-700" : "text-red-700"}`}>{r.ok ? r.message : r.error}</p>}
      {[...groups.entries()].map(([who, list]) => (
        <div key={who} className="rounded-xl bg-white ring-1 ring-slate-200">
          <p className="border-b border-slate-100 px-3 py-2 text-sm font-semibold">
            {who} · {list.filter((i) => i.collected > 0).length}/{list.length} paid ·{" "}
            <span className="num text-emerald-700">{rs(list.reduce((t, i) => t + Number(i.collected), 0))}</span>
          </p>
          <ul className="divide-y divide-slate-100">
            {list.map((i) => (
              <li key={i.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-red-700"
                    checked={picked.has(i.id)}
                    onChange={() =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (n.has(i.id)) n.delete(i.id);
                        else n.add(i.id);
                        return n;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {i.borrower_name} <span className="text-xs text-slate-500">· {i.folio}</span>
                  </span>
                  {i.collected > 0 ? (
                    <span className="num text-xs font-semibold text-emerald-700">✓ {rs(i.collected)}</span>
                  ) : (
                    <span className="num text-xs text-slate-500">{rs(Number(i.arrears) > 0 ? i.arrears : i.emi)}</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

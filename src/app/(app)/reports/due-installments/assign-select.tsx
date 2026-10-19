"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateInput } from "@/components/date-input";
import { dmy, inr } from "@/lib/format";
import { fromPaise, toPaise, todayIST } from "@/lib/schedule";
import { assignAccounts, type CtlResult } from "../../control-actions";

/** One account in the report that can be ticked: key "old-123" / "new-45" and its EMI. */
export type Pick = { key: string; emi: string };

type Ctx = { picked: Set<string>; toggle: (k: string) => void; setAll: (on: boolean) => void; all: Pick[] };
const SelectCtx = createContext<Ctx | null>(null);
const useSel = () => useContext(SelectCtx);

const MAX = 500;

/** Wraps the report: ticks live here; the Assign bar sits at the bottom of the screen. */
export function AssignSelect({ all, staff, children }: { all: Pick[]; staff: { id: string; name: string }[]; children: React.ReactNode }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const ctx: Ctx = {
    picked,
    all,
    toggle: (k) =>
      setPicked((s) => {
        const n = new Set(s);
        if (n.has(k)) n.delete(k);
        else n.add(k);
        return n;
      }),
    setAll: (on) => setPicked(on ? new Set(all.slice(0, MAX).map((p) => p.key)) : new Set()),
  };
  return (
    <SelectCtx.Provider value={ctx}>
      {children}
      <AssignBar staff={staff} onDone={() => setPicked(new Set())} />
    </SelectCtx.Provider>
  );
}

/** Tick box on one row (shown only when the page is wrapped in AssignSelect). */
export function RowCheck({ k, label }: { k: string; label: string }) {
  const s = useSel();
  if (!s) return null;
  return (
    <input
      type="checkbox"
      aria-label={`Select ${label}`}
      className="h-5 w-5 accent-blue-700 print:hidden"
      checked={s.picked.has(k)}
      onChange={() => s.toggle(k)}
    />
  );
}

/** "Select all" in the table head: every account matching the filters (all pages, at most 500). */
export function AllCheck() {
  const s = useSel();
  if (!s) return null;
  const n = Math.min(s.all.length, MAX);
  const on = n > 0 && s.picked.size >= n;
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      title={`Select all ${n} accounts`}
      className="h-5 w-5 accent-blue-700 print:hidden"
      checked={on}
      onChange={() => s.setAll(!on)}
    />
  );
}

/** Phone: one "Select all" button above the cards. */
export function AllButton() {
  const s = useSel();
  if (!s) return null;
  const n = Math.min(s.all.length, MAX);
  const on = n > 0 && s.picked.size >= n;
  return (
    <button
      type="button"
      onClick={() => s.setAll(!on)}
      className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-blue-700 ring-1 ring-slate-300 print:hidden"
    >
      {on ? "Clear ticks" : `Select all ${n}`}
    </button>
  );
}

function AssignBar({ staff, onDone }: { staff: { id: string; name: string }[]; onDone: () => void }) {
  const s = useSel()!;
  const router = useRouter();
  const today = todayIST();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [day, setDay] = useState(today);
  const [note, setNote] = useState("");
  const [r, setR] = useState<CtlResult | null>(null);
  const [pending, start] = useTransition();

  const chosen = s.all.filter((p) => s.picked.has(p.key));
  const emi = fromPaise(chosen.reduce((t, p) => t + toPaise(p.emi), 0n));

  if (chosen.length === 0)
    return r?.ok ? (
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 md:bottom-0 flex justify-center p-3 print:hidden">
        <p role="status" className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-lg">
          ✓ {r.message}
          <button type="button" onClick={() => setR(null)} className="ml-3 underline">
            OK
          </button>
        </p>
      </div>
    ) : null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 md:bottom-0 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur print:hidden">
      <div className="mx-auto max-w-5xl space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="num text-sm">
            <b>{chosen.length}</b> account{chosen.length === 1 ? "" : "s"} ticked · EMI total <b>{inr(emi)}</b>
          </p>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => s.setAll(false)} className="h-11 rounded-lg px-3 text-sm font-semibold text-slate-600">
              Clear
            </button>
            {!open && (
              <button
                type="button"
                onClick={() => {
                  setOpen(true);
                  setR(null);
                }}
                className="h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800"
              >
                Assign…
              </button>
            )}
          </div>
        </div>

        {open && (
          <form
            className="grid gap-3 sm:grid-cols-[1fr_180px_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const items = chosen.map((p) => {
                  const [source, ref] = p.key.split("-");
                  return { source: source as "old" | "new", ref_id: Number(ref) };
                });
                const res = await assignAccounts(day, userId, items, note);
                setR(res);
                if (res.ok) {
                  setOpen(false);
                  setNote("");
                  onDone();
                  router.refresh();
                }
              });
            }}
          >
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Collection man *</span>
              <select value={userId} onChange={(e) => setUserId(e.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                <option value="">Choose…</option>
                {staff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">For the day *</span>
              <DateInput value={day} min={today} onChange={setDay} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Note (optional)</span>
              <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. bring by evening" className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={pending || !userId || !day}
                className="h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {pending ? "Assigning…" : `Assign ${chosen.length}${day ? ` for ${dmy(day)}` : ""}`}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-lg px-3 text-sm font-semibold text-slate-600">
                Back
              </button>
            </div>
          </form>
        )}
        {r && !r.ok && <p className="text-sm text-red-700">{r.error}</p>}
      </div>
    </div>
  );
}

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dmy, inr, isPositive } from "@/lib/format";
import { addMonths, todayIST } from "@/lib/schedule";
import { DateInput } from "@/components/date-input";
import { ADJ_LABEL, type Adjustment } from "@/lib/adjustments";
import { addAdjustment, cancelAdjustment, type AdjustInput, type FixResult } from "./fix-actions";

const input =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";
const btn = "h-10 rounded-lg bg-white px-4 text-sm font-semibold ring-1 ring-slate-300";

type Mode = "penalty" | "discount" | "reschedule" | "settle";

/**
 * Charges, discounts, closing and reschedules on one account. Everyone with access sees the history;
 * only the admin gets the buttons (the database checks it again).
 */
export function MoneyActions({
  source,
  refId,
  path,
  adjustments,
  balance,
  emi,
  intervalMonths,
  suggestedFee,
  feeNote,
  canAct,
  closed,
}: {
  source: "old" | "new";
  refId: number;
  path: string;
  adjustments: Adjustment[];
  balance: string;
  emi: string;
  intervalMonths: number;
  suggestedFee: number;
  feeNote: string;
  canAct: boolean;
  /** closed in this app (settled) or fully paid in the old software */
  closed: boolean;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const sorted = [...adjustments].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
  if (!canAct && sorted.length === 0) return null;
  const settledRow = sorted.find((a) => a.kind === "settle" && !a.cancelled_at);

  return (
    <section className="rounded-xl bg-white ring-1 ring-slate-200">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Late fees, discounts &amp; schedule</h2>
        {canAct && (
          <p className="text-xs text-slate-500">
            Balance now <b className="num text-slate-700">{inr(balance)}</b>. Every change needs a reason, is saved in the activity log and
            can be cancelled.
          </p>
        )}
      </div>

      {done && (
        <p role="status" className="mx-4 mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {done}
        </p>
      )}

      {canAct && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {settledRow ? (
            <button type="button" onClick={() => { setDone(null); setMode(null); setCancelId(settledRow.id); }} className={`${btn} text-amber-700 hover:bg-amber-50`}>
              Reopen account
            </button>
          ) : closed ? (
            <p className="text-sm text-slate-500">This account is fully paid in the old software.</p>
          ) : (
            <>
              <ModeButton m="penalty" cur={mode} set={(m) => { setDone(null); setMode(m); }} label="+ Late fee / charge" tone="text-red-700 hover:bg-red-50" />
              <ModeButton m="discount" cur={mode} set={(m) => { setDone(null); setMode(m); }} label="− Discount" tone="text-emerald-700 hover:bg-emerald-50" />
              <ModeButton m="reschedule" cur={mode} set={(m) => { setDone(null); setMode(m); }} label="Reschedule EMIs" tone="text-blue-700 hover:bg-blue-50" />
              <ModeButton m="settle" cur={mode} set={(m) => { setDone(null); setMode(m); }} label="Close / settle" tone="text-slate-800 hover:bg-slate-50" />
            </>
          )}
        </div>
      )}

      {canAct && mode && !closed && (
        <AdjustForm
          key={mode}
          mode={mode}
          source={source}
          refId={refId}
          path={path}
          balance={balance}
          emi={emi}
          intervalMonths={intervalMonths}
          suggestedFee={suggestedFee}
          feeNote={feeNote}
          onDone={(m) => {
            setMode(null);
            setDone(m);
          }}
        />
      )}

      {sorted.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          {sorted.map((a) => (
            <li key={a.id} className={`px-4 py-3 text-sm ${a.cancelled_at ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{ADJ_LABEL[a.kind]}</span>
                {a.kind === "reschedule" ? (
                  <span className="num">
                    EMI {inr(a.new_emi)} from {dmy(a.next_due)}
                  </span>
                ) : (
                  Number(a.amount) !== 0 && (
                    <span className={`num font-semibold ${Number(a.amount) > 0 ? "text-red-700" : "text-emerald-700"}`}>
                      {Number(a.amount) > 0 ? "+" : "−"}
                      {inr(String(Math.abs(Number(a.amount))))}
                    </span>
                  )
                )}
                <span className="text-slate-500">{dmy(a.entry_date)}</span>
                {a.cancelled_at && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">Cancelled</span>}
                {canAct && !a.cancelled_at && (a.kind === "settle" || !settledRow) && (
                  <button
                    type="button"
                    onClick={() => { setDone(null); setMode(null); setCancelId(cancelId === a.id ? null : a.id); }}
                    className="ml-auto text-sm font-semibold text-red-700"
                  >
                    {a.kind === "settle" ? "Reopen" : "Cancel"}
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-slate-600">{a.reason}</p>
              {a.cancelled_at && a.cancel_reason && <p className="text-xs text-slate-500">Cancelled: {a.cancel_reason}</p>}
              {cancelId === a.id && (
                <CancelAdj
                  a={a}
                  path={path}
                  onDone={(m) => {
                    setCancelId(null);
                    setDone(m);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-slate-500">No late fees, discounts or reschedules yet.</p>
      )}
    </section>
  );
}

function ModeButton({ m, cur, set, label, tone }: { m: Mode; cur: Mode | null; set: (m: Mode | null) => void; label: string; tone: string }) {
  return (
    <button type="button" aria-pressed={cur === m} onClick={() => set(cur === m ? null : m)} className={`${btn} ${tone} ${cur === m ? "ring-2 ring-blue-600" : ""}`}>
      {label}
    </button>
  );
}

function AdjustForm({
  mode, source, refId, path, balance, emi, intervalMonths, suggestedFee, feeNote, onDone,
}: {
  mode: Mode; source: "old" | "new"; refId: number; path: string; balance: string; emi: string; intervalMonths: number;
  suggestedFee: number; feeNote: string; onDone: (m: string) => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(mode === "penalty" && suggestedFee > 0 ? String(suggestedFee) : "");
  const [newEmi, setNewEmi] = useState(String(Number(emi)));
  const [nextDue, setNextDue] = useState(addMonths(todayIST(), Math.max(1, intervalMonths)));
  const [why, setWhy] = useState("");
  const [sure, setSure] = useState(false);
  const [r, setR] = useState<FixResult | null>(null);
  const [pending, start] = useTransition();
  const err = (k: string) => (r && !r.ok ? r.fieldErrors?.[k] : undefined);
  const owed = Number(balance);
  const emis = Number(newEmi) > 0 && owed > 0 ? Math.ceil(owed / Number(newEmi)) : 0;

  const submit = () =>
    start(async () => {
      const body: AdjustInput =
        mode === "penalty" || mode === "discount"
          ? { kind: mode, amount, reason: why }
          : mode === "reschedule"
            ? { kind: "reschedule", new_emi: newEmi, next_due: nextDue, reason: why }
            : { kind: "settle", reason: why };
      const res = await addAdjustment(source, refId, path, body);
      setR(res);
      if (res.ok) {
        router.refresh();
        onDone(res.message);
      }
    });

  return (
    <form
      className="mx-4 mt-3 space-y-3 rounded-lg bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {mode === "penalty" && (
        <>
          <L label="Late fee / charge (₹)" error={err("amount")}>
            <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          </L>
          {suggestedFee > 0 && <p className="text-xs text-slate-500">Suggested {inr(String(suggestedFee))}: {feeNote}. Change it if you want.</p>}
        </>
      )}
      {mode === "discount" && (
        <L label={`Discount (₹) — balance is ${inr(balance)}`} error={err("amount")}>
          <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        </L>
      )}
      {mode === "reschedule" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <L label="New EMI (₹)" error={err("new_emi")}>
              <input className={input} inputMode="decimal" value={newEmi} onChange={(e) => setNewEmi(e.target.value.replace(/[^\d.]/g, ""))} />
            </L>
            <L label="Next due date" error={err("next_due")}>
              <DateInput className={input} value={nextDue} onChange={setNextDue} />
            </L>
          </div>
          <p className="text-sm text-slate-600">
            Balance <b className="num">{inr(balance)}</b> will be paid in <b>{emis}</b> EMI{emis === 1 ? "" : "s"} of{" "}
            <b className="num">{inr(newEmi || "0")}</b> from <b>{dmy(nextDue)}</b>
            {intervalMonths > 1 ? `, every ${intervalMonths} months` : ", monthly"}. Arrears before today are forgiven.
          </p>
        </>
      )}
      {mode === "settle" && (
        <>
          <p className="text-sm text-slate-700">
            {isPositive(balance) ? (
              <>
                The balance of <b className="num text-red-700">{inr(balance)}</b> will be <b>written off</b> and the account closed. Take any
                final payment first with Collect.
              </>
            ) : (
              <>Nothing is left to pay. The account will be closed.</>
            )}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-blue-700" checked={sure} onChange={(e) => setSure(e.target.checked)} />
            Yes, close this account
          </label>
        </>
      )}
      <L label="Reason *" error={err("reason")}>
        <input className={input} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why? (saved in the history)" />
      </L>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || (mode === "settle" && !sure)}
          className="h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : { penalty: "Add late fee", discount: "Give discount", reschedule: "Save new schedule", settle: "Close account" }[mode]}
        </button>
        {r && !r.ok && <span className="text-sm text-red-700">{r.error}</span>}
      </div>
    </form>
  );
}

function CancelAdj({ a, path, onDone }: { a: Adjustment; path: string; onDone: (m: string) => void }) {
  const router = useRouter();
  const [why, setWhy] = useState("");
  const [r, setR] = useState<FixResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-amber-50 p-3">
      <L label={a.kind === "settle" ? "Why reopen? *" : "Why cancel? *"} error={r && !r.ok ? r.fieldErrors?.reason : undefined}>
        <input className={input} value={why} onChange={(e) => setWhy(e.target.value)} />
      </L>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await cancelAdjustment(a.id, path, why);
              setR(res);
              if (res.ok) {
                router.refresh();
                onDone(res.message);
              }
            })
          }
          className="h-10 rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : a.kind === "settle" ? "Reopen account" : "Cancel it"}
        </button>
        {r && !r.ok && <span className="text-sm text-red-700">{r.error}</span>}
      </div>
    </div>
  );
}

function L({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error && <span className="mt-1 block text-sm text-red-700">{error}</span>}
    </label>
  );
}

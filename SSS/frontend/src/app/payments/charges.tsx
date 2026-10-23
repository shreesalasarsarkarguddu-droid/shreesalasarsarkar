import { useState, useTransition } from "react";
import { dmy, inr } from "@/lib/format";
import { fromPaise, toPaise, todayIST } from "@/lib/schedule";
import type { ChargeInfo } from "@/lib/ledger";
import { setSeized } from "../seize-actions";
import type { PaymentField } from "./actions";

/** What is typed for the charges. od: the admin's own OD amount ("" = days × rate). */
export type ChargeForm = { od: string; seize: string; other: string; other_note: string; showOther: boolean };
export const emptyCharges = (): ChargeForm => ({ od: "", seize: "", other: "", other_note: "", showOther: false });

type ChargeField = Extract<PaymentField, "od_amount" | "seize_amount" | "other_amount" | "other_note">;
export type ChargeTotals = {
  odDays: number; odAuto: bigint; od: bigint; seize: bigint; other: bigint; total: bigint;
  error: { field: ChargeField; msg: string } | null;
};

const isAmount = (v: string) => /^\d{1,9}(\.\d{1,2})?$/.test(v);
const plain = (p: bigint) => (p % 100n === 0n ? String(p / 100n) : fromPaise(p));
const days = (from: string, to: string) => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000);

/** OD = days since the oldest unpaid EMI's due date (to the paid date) × the rate; who may (info.can_change_od) can type another amount. */
export function chargeTotals(info: ChargeInfo | null, paidDate: string, f: ChargeForm): ChargeTotals {
  const odDays = info?.od_from && paidDate && paidDate > info.od_from ? days(info.od_from, paidDate) : 0;
  const odAuto = BigInt(odDays) * BigInt(Math.round((info?.od_rate ?? 0) * 100));
  let error: ChargeTotals["error"] = null;
  const amt = (v: string, field: ChargeField) => {
    if (!v.trim()) return 0n;
    if (!isAmount(v.trim())) {
      error ??= { field, msg: "Enter the amount (numbers only)" };
      return 0n;
    }
    return toPaise(v.trim());
  };
  const od = odDays > 0 ? (info?.can_change_od && f.od.trim() !== "" ? amt(f.od, "od_amount") : odAuto) : 0n;
  const seize = amt(f.seize, "seize_amount");
  const other = f.showOther ? amt(f.other, "other_amount") : 0n;
  if (other > 0n && !f.other_note.trim()) error ??= { field: "other_note", msg: "Write what the other charge is for" };
  return { odDays, odAuto, od, seize, other, total: od + seize + other, error };
}

/** The charges part of the payment form: OD (locked for those who may not change it), seize charge (seized vehicles), other with a note. */
export function ChargesBox({
  info, totals, form, emi, errors, onChange,
}: {
  info: ChargeInfo; totals: ChargeTotals; form: ChargeForm; emi: bigint;
  errors: Partial<Record<PaymentField, string>>; onChange: (f: ChargeForm) => void;
}) {
  const set = (k: keyof ChargeForm, v: string | boolean) => onChange({ ...form, [k]: v });
  const seizedDays = info.seized_on ? days(info.seized_on, todayIST()) : null;
  const showSeize = info.seized || form.seize !== "";
  if (totals.odDays === 0 && !showSeize && !form.showOther) {
    return (
      <button type="button" onClick={() => set("showOther", true)} className="text-sm font-semibold text-blue-700">
        + Add a charge (other)
      </button>
    );
  }
  return (
    <div className="space-y-3 rounded-lg bg-amber-50/70 p-3 ring-1 ring-amber-200">
      <p className="text-sm font-semibold text-slate-700">
        Charges <span className="font-normal text-slate-500">· same receipt, not in the loan balance</span>
      </p>
      {info.seized && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">
          🚗 Vehicle seized{info.seized_on ? ` on ${dmy(info.seized_on)} (${seizedDays} days)` : ""}
        </p>
      )}

      {totals.odDays > 0 && (
        <div>
          <label htmlFor="pay-od_amount" className="mb-1 flex items-baseline justify-between gap-2 text-sm font-medium text-slate-700">
            <span>OD (delay)</span>
            <span className="num text-xs font-normal text-slate-500">
              {totals.odDays} days × ₹{info.od_rate} · EMI due {dmy(info.od_from)}
            </span>
          </label>
          <div className="flex items-center gap-2">
            <input
              id="pay-od_amount"
              inputMode="decimal"
              autoComplete="off"
              disabled={!info.can_change_od}
              value={info.can_change_od && form.od !== "" ? form.od : plain(totals.odAuto)}
              onChange={(e) => set("od", e.target.value.replace(/[^\d.]/g, ""))}
              aria-invalid={!!errors.od_amount}
              className={`num h-11 min-w-0 flex-1 rounded-lg border bg-white px-3 text-base font-semibold disabled:bg-slate-100 disabled:text-slate-600 ${errors.od_amount ? "border-red-500" : "border-slate-300"}`}
            />
            {info.can_change_od && form.od !== "" && (
              <button type="button" onClick={() => set("od", "")} className="shrink-0 text-xs font-semibold text-blue-700">
                Reset
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {info.can_change_od ? "You can change it (more, less or 0). A changed OD is shown in Activity." : "🔒 Only the admin can change the OD."}
          </p>
          {errors.od_amount && <p className="mt-1 text-sm text-red-700">{errors.od_amount}</p>}
        </div>
      )}

      {showSeize && (
        <Amount id="seize_amount" label="Seize charge" value={form.seize} error={errors.seize_amount} onChange={(v) => set("seize", v)} />
      )}

      {form.showOther ? (
        <div className="space-y-2">
          <Amount id="other_amount" label="Other charge" value={form.other} error={errors.other_amount} onChange={(v) => set("other", v)} />
          <input
            id="pay-other_note"
            placeholder="What is it for? (e.g. RC transfer) *"
            maxLength={100}
            value={form.other_note}
            onChange={(e) => set("other_note", e.target.value)}
            aria-invalid={!!errors.other_note}
            className={`h-10 w-full rounded-lg border bg-white px-3 text-sm ${errors.other_note ? "border-red-500" : "border-slate-300"}`}
          />
          {errors.other_note && <p className="text-sm text-red-700">{errors.other_note}</p>}
        </div>
      ) : (
        <button type="button" onClick={() => set("showOther", true)} className="text-sm font-semibold text-blue-700">
          + Other charge
        </button>
      )}

      {totals.total > 0n && (
        <p className="num rounded-md bg-white px-2 py-1.5 text-sm ring-1 ring-amber-200">
          EMI {inr(fromPaise(emi))} + charges {inr(fromPaise(totals.total))} = <b>{inr(fromPaise(emi + totals.total))}</b> to collect
        </p>
      )}
    </div>
  );
}

function Amount({ id, label, value, error, onChange }: { id: ChargeField; label: string; value: string; error?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={`pay-${id}`} className="mb-1 block text-sm font-medium text-slate-700">
        {label} (₹)
      </label>
      <input
        id={`pay-${id}`}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        aria-invalid={!!error}
        className={`num h-11 w-full rounded-lg border bg-white px-3 text-base font-semibold ${error ? "border-red-500" : "border-slate-300"}`}
      />
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}

/** After a payment on a seized vehicle (admin): give the vehicle back now? */
export function ReleaseOffer({ source, refId, receiptNo, onDone }: { source: "old" | "new"; refId: number; receiptNo: number; onDone: (released: boolean) => void }) {
  const [remarks, setRemarks] = useState(`Payment received · receipt ${receiptNo}`);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [key] = useState(() => crypto.randomUUID());
  return (
    <div className="space-y-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900 ring-1 ring-red-200">
      <p className="font-semibold">🚗 This vehicle is seized. Give it back now?</p>
      <input
        aria-label="Reason for release"
        maxLength={300}
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        className="h-10 w-full rounded-lg border border-red-200 bg-white px-3 text-sm text-slate-900"
      />
      {error && <p className="text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setSeized({ source, refId, seize: false, actionDate: todayIST(), remarks, idempotencyKey: key });
              if (r.ok) onDone(true);
              else setError(r.error);
            })
          }
          className="h-10 flex-1 rounded-lg bg-emerald-700 px-3 font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Release vehicle"}
        </button>
        <button type="button" onClick={() => onDone(false)} className="h-10 rounded-lg bg-white px-3 font-semibold text-slate-700 ring-1 ring-slate-300">
          Not now
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inr } from "@/lib/format";
import { purgeLoan, type FixResult } from "../../fix-actions";

const input =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";

/**
 * Admin only: delete a loan completely, payments and all. Step 1 shows what goes and asks the reason and the folio no.;
 * step 2 asks the delete PIN.
 */
export function PurgeLoan({ id, folio, name, payments, paid }: { id: number; folio: string; name: string; payments: number; paid: string }) {
  const router = useRouter();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [why, setWhy] = useState("");
  const [typed, setTyped] = useState("");
  const [pin, setPin] = useState("");
  const [r, setR] = useState<FixResult | null>(null);
  const [pending, start] = useTransition();
  const folioOk = typed.trim().toUpperCase() === folio.trim().toUpperCase();

  if (step === 0)
    return (
      <button
        type="button"
        onClick={() => setStep(1)}
        className="h-11 rounded-lg bg-white px-4 text-sm font-semibold text-red-700 ring-1 ring-slate-300 hover:bg-red-50"
      >
        Delete loan completely
      </button>
    );

  return (
    <section className="space-y-3 rounded-xl bg-red-50 p-4 ring-1 ring-red-200">
      <p className="text-sm font-semibold text-red-800">
        Delete folio {folio} · {name} completely?
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-red-800">
        <li>
          The loan and the customer&apos;s details{payments > 0 && <>, and its {payments} payment(s) of {inr(paid)}</>}
        </li>
        <li>Late fees, discounts, seize history, visit remarks and collection lists of this loan</li>
        {payments > 0 && <li>Its payments also leave the Day Book, Dashboard and cash reports of those days</li>}
      </ul>
      <p className="text-xs text-red-900">A restore point is saved first and a full copy goes to the activity log, so it can be undone.</p>

      {step === 1 ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Reason *</span>
              <input className={input} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. test entry / entered by mistake" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Type the folio no. <b>{folio}</b> to confirm
              </span>
              <input className={input} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={why.trim().length < 3 || !folioOk}
              onClick={() => setStep(2)}
              className="h-11 rounded-lg bg-red-700 px-5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              Next
            </button>
            <button type="button" onClick={() => setStep(0)} className="h-11 rounded-lg px-4 text-sm font-semibold text-slate-600">
              Keep it
            </button>
          </div>
        </>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await purgeLoan(id, why, typed, pin);
              setR(res);
              if (res.ok) router.replace("/accounts?deleted=1");
            });
          }}
        >
          <label className="block max-w-xs">
            <span className="mb-1 block text-sm font-medium text-slate-700">Delete PIN *</span>
            <input
              className={input}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
            {r && !r.ok && r.fieldErrors?.pin && <span className="mt-1 block text-sm text-red-700">{r.fieldErrors.pin}</span>}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={pending || pin.length < 4}
              className="h-11 rounded-lg bg-red-700 px-5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {pending ? "Deleting…" : "Delete for ever"}
            </button>
            <button type="button" onClick={() => setStep(1)} className="h-11 rounded-lg px-4 text-sm font-semibold text-slate-600">
              Back
            </button>
            {r && !r.ok && <span className="text-sm text-red-700">{r.error}</span>}
          </div>
        </form>
      )}
    </section>
  );
}

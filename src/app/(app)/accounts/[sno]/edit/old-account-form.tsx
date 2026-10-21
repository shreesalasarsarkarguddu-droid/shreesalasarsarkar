"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateInput } from "@/components/date-input";
import { OLD_ACCOUNT_FORM, type OldAccountFields } from "@/lib/old-account";
import { editOldAccount, type OldFixResult } from "../../../old-fix-actions";

const input =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";

/** Admin only: change the details of an account that came from the old software. */
export function OldAccountForm({ sno, initial }: { sno: number; initial: Record<OldAccountFields, string> }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [why, setWhy] = useState("");
  const [r, setR] = useState<OldFixResult | null>(null);
  const [pending, start] = useTransition();
  const err = (k: string) => (r && !r.ok ? r.fieldErrors?.[k] : undefined);
  const set = (k: OldAccountFields, val: string) => setV((o) => ({ ...o, [k]: val }));
  const parts = ["finance_amount", "interest_amount", "agreement_amount", "hp_amount"] as const;
  const sum = Math.round(parts.reduce((t, k) => t + Number(v[k] || 0), 0) * 100) / 100;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await editOldAccount(sno, v, why);
          setR(res);
          if (res.ok) {
            router.push(`/accounts/${sno}`);
            router.refresh();
          }
        });
      }}
    >
      {OLD_ACCOUNT_FORM.map((s) => (
        <section key={s.title} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{s.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {s.fields.map(([k, label, kind]) => (
              <label key={k} className={`block ${k.endsWith("address") ? "sm:col-span-2 lg:col-span-3" : ""}`}>
                <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
                {kind === "date" ? (
                  <DateInput className={input} value={v[k]} onChange={(val) => set(k, val)} />
                ) : (
                  <input
                    className={input}
                    value={v[k]}
                    inputMode={kind === "money" ? "decimal" : kind === "number" || kind === "mobile" ? "numeric" : undefined}
                    onChange={(e) =>
                      set(k, kind === "money" ? e.target.value.replace(/[^\d.]/g, "") : kind === "number" || kind === "mobile" ? e.target.value.replace(/\D/g, "") : e.target.value)
                    }
                  />
                )}
                {err(k) && <span className="mt-1 block text-sm text-red-700">{err(k)}</span>}
              </label>
            ))}
          </div>
          {s.title === "Loan" && (
            <p className="num mt-3 text-sm text-slate-500">
              Finance + interest + agreement + HP = ₹{sum.toLocaleString("en-IN")}
              {sum !== Number(v.total_amount || 0) && (
                <>
                  {" "}
                  — not the same as the total payable.{" "}
                  <button type="button" className="font-semibold text-blue-700" onClick={() => set("total_amount", String(sum))}>
                    Use ₹{sum.toLocaleString("en-IN")}
                  </button>
                </>
              )}
            </p>
          )}
        </section>
      ))}

      <section className="space-y-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Reason for the change *</span>
          <input className={input} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. mobile number was wrong in the old software" />
          {err("reason") && <span className="mt-1 block text-sm text-red-700">{err("reason")}</span>}
        </label>
        <p className="text-xs text-amber-900">
          Saved in the activity log with the old and new values. If the total payable or EMI changes, the balance and the later payments are
          recalculated. A later import from the old software keeps this account as changed here.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className="h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
            {pending ? "Saving…" : "Save changes"}
          </button>
          <Link href={`/accounts/${sno}`} className="inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-300">
            Back
          </Link>
          {r && !r.ok && <span className="text-sm text-red-700">{r.error}</span>}
        </div>
      </section>
    </form>
  );
}

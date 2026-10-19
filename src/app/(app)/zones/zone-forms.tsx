"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveZone, type CtlResult } from "../control-actions";

export type Zone = {
  id: number; name: string; receipt_start: number; receipt_end: number | null; active: boolean;
  last_used: number | null; next_no: number | null; accounts: number;
};

const input = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";

function ZoneFields({ name, start, setName, setStart }: { name: string; start: string; setName: (v: string) => void; setStart: (v: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Zone name</span>
        <input className={`${input} uppercase`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. NARHARPUR" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Zone receipt no. starts with</span>
        <input className={`${input} num`} inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 500001" />
      </label>
    </div>
  );
}

export function NewZone() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [r, setR] = useState<CtlResult | null>(null);
  const [pending, run] = useTransition();

  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setOpen(true)} className="h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800">
          + Add zone
        </button>
        {r?.ok && <span className="text-sm text-emerald-700">{r.message}</span>}
      </div>
    );

  return (
    <form
      className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-slate-200"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const res = await saveZone({ action: "add", name, receipt_start: start });
          setR(res);
          if (res.ok) {
            setOpen(false);
            setName("");
            setStart("");
            router.refresh();
          }
        });
      }}
    >
      <ZoneFields name={name} start={start} setName={setName} setStart={setStart} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? "Saving…" : "Add zone"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-lg px-3 text-sm font-semibold text-slate-600">
          Cancel
        </button>
        {r && !r.ok && <span className="text-sm text-red-700">{r.error}</span>}
      </div>
    </form>
  );
}

export function ZoneRow({ z }: { z: Zone }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(z.name);
  const [start, setStart] = useState(String(z.receipt_start));
  const [r, setR] = useState<CtlResult | null>(null);
  const [pending, run] = useTransition();
  const go = (input: Parameters<typeof saveZone>[0]) =>
    run(async () => {
      const res = await saveZone(input);
      setR(res);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  const b = "h-9 rounded-lg bg-white px-3 text-sm font-semibold ring-1 ring-slate-300 disabled:opacity-60";

  return (
    <li className={`rounded-xl bg-white p-4 ring-1 ring-slate-200 ${z.active ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="font-semibold">{z.name}</p>
        {!z.active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Hidden</span>}
        <span className="ml-auto text-xs text-slate-500">
          {z.accounts} account{z.accounts === 1 ? "" : "s"}
        </span>
      </div>
      <p className="num mt-1 text-sm text-slate-600">
        Receipts {z.receipt_start} – {z.receipt_end ?? "onwards"}
        {" · "}last used {z.last_used ?? "—"}
        {" · "}
        {z.next_no != null ? (
          <>
            next <b className="text-slate-900">{z.next_no}</b>
          </>
        ) : (
          <b className="text-red-700">series full</b>
        )}
      </p>

      {editing ? (
        <form
          className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            go({ action: "edit", id: z.id, name, receipt_start: start });
          }}
        >
          <ZoneFields name={name} start={start} setName={setName} setStart={setStart} />
          {name.trim().toUpperCase() !== z.name && z.accounts > 0 && (
            <p className="text-xs text-slate-600">The {z.accounts} account(s) in this zone move to the new name.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="h-10 rounded-lg px-3 text-sm font-semibold text-slate-600">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} onClick={() => setEditing(true)} className={`${b} text-blue-700`}>
            Edit
          </button>
          <button type="button" disabled={pending} onClick={() => go({ action: z.active ? "hide" : "show", id: z.id })} className={`${b} text-slate-700`}>
            {z.active ? "Hide" : "Show again"}
          </button>
          {z.accounts === 0 && (
            <button type="button" disabled={pending} onClick={() => go({ action: "delete", id: z.id })} className={`${b} text-red-700`}>
              Delete
            </button>
          )}
        </div>
      )}
      {r && !r.ok && <p className="mt-2 text-sm text-red-700">{r.error}</p>}
    </li>
  );
}

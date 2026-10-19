"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dateIST } from "@/lib/format";
import { openMainBook, saveZone, type CtlResult, type ZoneInput } from "../control-actions";

export type Zone = {
  id: number; name: string; active: boolean; accounts: number;
  book_id: number | null; book_no: number | null; book_code: string | null; book_start: number | null; book_opened: string | null;
  last_used: number | null; next_no: number | null; receipts: number;
  books: { code: string; book_no: number; start: number; opened: string; closed: string; last: number | null; receipts: number }[];
};

/** DHAMTARI = the main book (accounts with no zone). */
export type MainBook = {
  book_no: number; book_code: string; book_start: number; book_opened: string; last_used: number | null; next_no: number | null;
  receipts: number; accounts: number;
  books: { code: string; book_no: number; start: number; opened: string; closed: string; last: number | null; receipts: number }[];
};

const input = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";
const label = "mb-1 block text-sm font-medium text-slate-700";

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
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Zone name</span>
          <input className={`${input} uppercase`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. KURUD" />
        </label>
        <label className="block">
          <span className={label}>Zone receipt no. starts with</span>
          <input className={`${input} num`} inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 1" />
        </label>
      </div>
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
  const [mode, setMode] = useState<"none" | "book" | "rename">("none");
  const [start, setStart] = useState("");
  const [name, setName] = useState(z.name);
  const [sure, setSure] = useState(false);
  const [r, setR] = useState<CtlResult | null>(null);
  const [pending, run] = useTransition();
  const go = (input: ZoneInput) =>
    run(async () => {
      const res = await saveZone(input);
      setR(res);
      if (res.ok) {
        setMode("none");
        setStart("");
        setSure(false);
        router.refresh();
      }
    });
  const b = "h-9 rounded-lg bg-white px-3 text-sm font-semibold ring-1 ring-slate-300 disabled:opacity-60";

  return (
    <li className={`rounded-xl bg-white p-4 ring-1 ring-slate-200 ${z.active ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-lg font-semibold">{z.name}</p>
        {!z.active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Hidden</span>}
        <span className="ml-auto text-xs text-slate-500">
          {z.accounts} account{z.accounts === 1 ? "" : "s"}
        </span>
      </div>

      {z.book_code && (
        <div className="num mt-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-blue-100">
          <p>
            Open book <b className="text-slate-900">{z.book_code}</b> · starts at <b>{z.book_start}</b>
            {z.book_opened && <> · opened {dateIST(z.book_opened)}</>}
          </p>
          <p>
            {z.receipts} receipt{z.receipts === 1 ? "" : "s"} · last used {z.last_used ?? "—"} · next <b className="text-blue-800">{z.next_no}</b>
          </p>
        </div>
      )}

      {z.books.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-slate-600">Old books ({z.books.length})</summary>
          <ul className="num mt-1 space-y-0.5 pl-4 text-slate-600">
            {z.books.map((o) => (
              <li key={o.code}>
                <b className="text-slate-800">{o.code}</b> · from {o.start} · last {o.last ?? "—"} · {o.receipts} receipts · closed {dateIST(o.closed)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {mode === "book" && (
        <form
          className="mt-3 space-y-3 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200"
          onSubmit={(e) => {
            e.preventDefault();
            go({ action: "new_book", id: z.id, receipt_start: start });
          }}
        >
          <label className="block max-w-xs">
            <span className={label}>New book: first receipt no.</span>
            <input className={`${input} num`} inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ""))} autoFocus />
          </label>
          <label className="flex items-start gap-2 text-sm text-amber-900">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-amber-700" checked={sure} onChange={(e) => setSure(e.target.checked)} />
            <span>
              Close <b>{z.book_code}</b> and start <b>{z.name}-{(z.book_no ?? 0) + 1}</b>. Its receipts stay saved. People&apos;s receipt books in
              {" "}
              {z.book_code} close too.
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending || !sure} className="h-10 rounded-lg bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-50">
              {pending ? "Opening…" : "Open new book"}
            </button>
            <button type="button" onClick={() => setMode("none")} className="h-10 rounded-lg px-3 text-sm font-semibold text-slate-600">
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === "rename" && (
        <form
          className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            go({ action: "rename", id: z.id, name });
          }}
        >
          <label className="block max-w-xs">
            <span className={label}>Zone name</span>
            <input className={`${input} uppercase`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          {z.accounts > 0 && <p className="text-xs text-slate-600">The {z.accounts} account(s) in this zone move to the new name. Book names stay as they are.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setMode("none")} className="h-10 rounded-lg px-3 text-sm font-semibold text-slate-600">
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === "none" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} onClick={() => setMode("book")} className={`${b} text-amber-800`}>
            Open new receipt book
          </button>
          <button type="button" disabled={pending} onClick={() => setMode("rename")} className={`${b} text-blue-700`}>
            Rename
          </button>
          <button type="button" disabled={pending} onClick={() => go({ action: z.active ? "hide" : "show", id: z.id })} className={`${b} text-slate-700`}>
            {z.active ? "Hide" : "Show again"}
          </button>
          {z.accounts === 0 && z.receipts === 0 && z.books.length === 0 && (
            <button type="button" disabled={pending} onClick={() => go({ action: "delete", id: z.id })} className={`${b} text-red-700`}>
              Delete
            </button>
          )}
        </div>
      )}
      {r && <p className={`mt-2 text-sm ${r.ok ? "text-emerald-700" : "text-red-700"}`}>{r.ok ? r.message : r.error}</p>}
    </li>
  );
}

/** DHAMTARI card: the main book used by every account with no zone. "next" counts only receipts written in this app. */
export function MainBookRow({ m }: { m: MainBook }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [sure, setSure] = useState(false);
  const [r, setR] = useState<CtlResult | null>(null);
  const [pending, run] = useTransition();
  const b = "h-9 rounded-lg bg-white px-3 text-sm font-semibold ring-1 ring-slate-300 disabled:opacity-60";

  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-slate-300">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-lg font-semibold">DHAMTARI</p>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">main book · accounts with no zone</span>
        <span className="ml-auto text-xs text-slate-500">{m.accounts} accounts</span>
      </div>
      <div className="num mt-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-blue-100">
        <p>
          Open book <b className="text-slate-900">{m.book_code}</b>
          {m.book_no > 1 && (
            <>
              {" "}
              · starts at <b>{m.book_start}</b> · opened {dateIST(m.book_opened)}
            </>
          )}
        </p>
        <p>
          {m.receipts} receipt{m.receipts === 1 ? "" : "s"} in this app · last used {m.last_used ?? "—"} · next{" "}
          <b className="text-blue-800">{m.next_no ?? "—"}</b>
        </p>
        {m.book_no === 1 && <p className="text-xs text-slate-500">Counted from receipts written in this app (the old software has some wrong numbers).</p>}
      </div>

      {m.books.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-slate-600">Old books ({m.books.length})</summary>
          <ul className="num mt-1 space-y-0.5 pl-4 text-slate-600">
            {m.books.map((o) => (
              <li key={o.code}>
                <b className="text-slate-800">{o.code}</b> · from {o.start} · last in app {o.last ?? "—"} · {o.receipts} receipts · closed {dateIST(o.closed)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {open ? (
        <form
          className="mt-3 space-y-3 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const res = await openMainBook(start);
              setR(res);
              if (res.ok) {
                setOpen(false);
                setStart("");
                setSure(false);
                router.refresh();
              }
            });
          }}
        >
          <label className="block max-w-xs">
            <span className={label}>New book: first receipt no.</span>
            <input className={`${input} num`} inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ""))} autoFocus />
          </label>
          <label className="flex items-start gap-2 text-sm text-amber-900">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-amber-700" checked={sure} onChange={(e) => setSure(e.target.checked)} />
            <span>
              Close <b>{m.book_code}</b> and start <b>DHAMTARI-{m.book_no + 1}</b>. Its receipts stay saved. People&apos;s receipt books in {m.book_code} close too.
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending || !sure} className="h-10 rounded-lg bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-50">
              {pending ? "Opening…" : "Open new book"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="h-10 rounded-lg px-3 text-sm font-semibold text-slate-600">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3">
          <button type="button" onClick={() => setOpen(true)} className={`${b} text-amber-800`}>
            Open new receipt book
          </button>
        </div>
      )}
      {r && <p className={`mt-2 text-sm ${r.ok ? "text-emerald-700" : "text-red-700"}`}>{r.ok ? r.message : r.error}</p>}
    </section>
  );
}

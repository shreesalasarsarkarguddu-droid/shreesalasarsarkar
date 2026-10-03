"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { todayIST } from "@/lib/schedule";
import { setSeized } from "./seize-actions";

/** "Seize vehicle" (or "Release" when already seized) button with a small confirm form. */
export function SeizeControl({ source, refId, seized }: { source: "old" | "new"; refId: number; seized: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold ring-1 ${
          seized ? "bg-white text-emerald-800 ring-emerald-300 hover:bg-emerald-50" : "bg-white text-red-700 ring-red-300 hover:bg-red-50"
        }`}
      >
        {seized ? "Release (back to normal)" : "Seize vehicle"}
      </button>
      {open && <SeizeDialog source={source} refId={refId} seize={!seized} onClose={() => setOpen(false)} />}
    </>
  );
}

function SeizeDialog({ source, refId, seize, onClose }: { source: "old" | "new"; refId: number; seize: boolean; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [date, setDate] = useState(todayIST);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null);
  const [pending, start] = useTransition();
  const [key] = useState(() => crypto.randomUUID());

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  function close() {
    if (pending) return;
    ref.current?.close();
    onClose();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!seize && !remarks.trim()) return setError({ msg: "Enter the reason for releasing", field: "remarks" });
    start(async () => {
      try {
        const res = await setSeized({ source, refId, seize, actionDate: date, remarks, idempotencyKey: key });
        if (!res.ok) return setError({ msg: res.error, field: res.field });
        ref.current?.close();
        onClose();
        router.refresh();
      } catch {
        setError({ msg: "No connection. Check your internet and try again." });
      }
    });
  }

  const input = "w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="m-auto w-[min(440px,94vw)] rounded-2xl bg-white p-0 backdrop:bg-slate-900/60"
      aria-labelledby="seize-title"
    >
      <form onSubmit={submit} className="space-y-4 p-5">
        <div>
          <h2 id="seize-title" className={`text-lg font-bold ${seize ? "text-red-700" : "text-emerald-800"}`}>
            {seize ? "Seize this vehicle?" : "Release — back to normal?"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {seize
              ? "The account will show as Seized everywhere (reports, lists). Payments can still be taken."
              : "The account goes back to normal. The seizure stays in the history."}
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">{seize ? "Seized on" : "Released on"} *</span>
          <input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} required className={`${input} h-12`} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {seize ? "Remarks (optional)" : "Reason for releasing *"}
          </span>
          <textarea
            rows={2}
            maxLength={300}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder={seize ? "e.g. vehicle kept at yard, 2 EMIs not paid" : "e.g. dues paid, vehicle returned"}
            className={`${input} py-2.5 ${error?.field === "remarks" ? "border-red-500" : ""}`}
          />
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error.msg}
          </p>
        )}
        <div className="flex gap-3">
          <button type="button" onClick={close} className="h-12 flex-1 rounded-xl bg-white text-base font-semibold text-slate-700 ring-1 ring-slate-300">
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className={`h-12 flex-1 rounded-xl text-base font-semibold text-white disabled:opacity-60 ${
              seize ? "bg-red-700 hover:bg-red-800" : "bg-emerald-700 hover:bg-emerald-800"
            }`}
          >
            {pending ? "Saving…" : seize ? "Seize" : "Release"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export type SeizureEvent = { id: number; action: "seize" | "release"; action_date: string; remarks: string | null; created_at: string; staff: { full_name: string } | null };

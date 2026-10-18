"use client";

import { useState, useTransition } from "react";
import { createRestorePoint, deleteData, restore, type Result } from "./actions";

type Counts = Record<string, number>;
export type Overview = {
  counts: Counts;
  linked_new_on_old: { payments: number; seizures: number };
  restore_points: { id: number; created_at: string; by_name: string | null; reason: string; counts: Counts }[];
  audit: { id: number; at: string; by_name: string | null; action: string; details: Record<string, unknown> }[];
};

const card = "rounded-xl bg-white p-4 ring-1 ring-slate-200 space-y-3";
const head = "text-xs font-semibold uppercase tracking-wide text-slate-500";
const btn = "h-11 rounded-lg px-5 text-sm font-semibold disabled:opacity-50";
const input =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";

const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-IN");
const when = (s: string) => new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

function summary(c: Counts) {
  return `${n(c.legacy_accounts)} old accounts · ${n(c.legacy_payments)} old receipts · ${n(c.loans)} new loans · ${n(c.payments)} payments · ${n(c.seizures)} seizures`;
}

function Msg({ r }: { r: Result | null }) {
  if (!r) return null;
  return (
    <p role="status" className={`rounded-lg px-3 py-2 text-sm ${r.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
      {r.message}
    </p>
  );
}

export function DataManager({ o }: { o: Overview }) {
  const c = o.counts;
  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className={head}>Data now</h2>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {[
            ["Old accounts", c.legacy_accounts],
            ["Old receipts", c.legacy_payments],
            ["New loans", c.loans],
            ["Borrowers", c.borrowers],
            ["Payments (app)", c.payments],
            ["Seizures", c.seizures],
            ["Import batches", c.import_batches],
          ].map(([label, v]) => (
            <div key={label as string} className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="num text-lg font-semibold">{n(v as number)}</p>
            </div>
          ))}
        </div>
      </section>

      <BackupCard />
      <RestoreCard points={o.restore_points} />
      <DeleteCard o={o} />

      <section className={card}>
        <h2 className={head}>Activity</h2>
        {o.audit.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {o.audit.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-3 py-2">
                <span className="num text-slate-500">{when(a.at)}</span>
                <span className="font-medium">{a.by_name ?? "—"}</span>
                <span className="text-slate-700">{describe(a)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function describe(a: Overview["audit"][number]) {
  const d = a.details as Record<string, unknown>;
  if (a.action === "delete") return `deleted ${({ old: "old software data", new: "app entries", all: "all data" } as Record<string, string>)[d.scope as string] ?? d.scope} (undo: restore point #${d.restore_point})`;
  if (a.action === "restore") return `restored restore point #${d.restored} (state before saved as #${d.saved_before_restore})`;
  if (a.action === "restore_point") return `saved restore point #${d.restore_point}`;
  if (a.action === "import") return `imported files (restore point before: #${d.restore_point})`;
  return a.action;
}

function BackupCard() {
  const [r, setR] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className={card}>
      <h2 className={head}>Backup</h2>
      <p className="text-sm text-slate-500">
        The zip is a copy on your own device (one Excel-readable CSV per table). A restore point is a copy kept inside the database
        that can be put back with one button. The newest 5 restore points are kept.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href="/settings/backup" className={`${btn} inline-flex items-center bg-white text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50`}>
          Download backup (.zip)
        </a>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setR(await createRestorePoint()))}
          className={`${btn} bg-white text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50`}
        >
          {pending ? "Saving…" : "Save restore point now"}
        </button>
      </div>
      <Msg r={r} />
    </section>
  );
}

function RestoreCard({ points }: { points: Overview["restore_points"] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className={card}>
      <h2 className={head}>Restore points</h2>
      {points.length === 0 ? (
        <p className="text-sm text-slate-500">None yet. One is saved automatically before every delete, import or restore.</p>
      ) : (
        <ul className="space-y-2">
          {points.map((p) => (
            <li key={p.id} className="rounded-lg ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    #{p.id} · {p.reason}
                  </p>
                  <p className="text-xs text-slate-500">
                    {when(p.created_at)} · {p.by_name ?? "—"}
                  </p>
                  <p className="text-xs text-slate-500">{summary(p.counts)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(open === p.id ? null : p.id)}
                  className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-amber-700 ring-1 ring-slate-300 hover:bg-amber-50"
                >
                  Restore…
                </button>
              </div>
              {open === p.id && <Confirm word="RESTORE" label={`Put all data back as it was at #${p.id}`} run={(w, pw) => restore(p.id, w, pw)} tone="amber" />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Confirm({
  word,
  label,
  run,
  tone,
  disabled,
}: {
  word: string;
  label: string;
  run: (word: string, password: string) => Promise<Result>;
  tone: "red" | "amber";
  disabled?: boolean;
}) {
  const [typed, setTyped] = useState("");
  const [pw, setPw] = useState("");
  const [r, setR] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const color = tone === "red" ? "bg-red-700 hover:bg-red-800" : "bg-amber-600 hover:bg-amber-700";
  return (
    <div className="space-y-3 border-t border-slate-200 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Type <b>{word}</b> to confirm
          </span>
          <input className={input} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Your password</span>
          <input className={input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
        </label>
      </div>
      <button
        type="button"
        disabled={disabled || pending || typed !== word || !pw}
        onClick={() =>
          start(async () => {
            const res = await run(typed, pw);
            setR(res);
            if (res.ok) {
              setTyped("");
              setPw("");
            }
          })
        }
        className={`${btn} text-white ${color}`}
      >
        {pending ? "Working… do not close this page" : label}
      </button>
      <Msg r={r} />
    </div>
  );
}

function DeleteCard({ o }: { o: Overview }) {
  const [scope, setScope] = useState<"old" | "new" | "all" | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const c = o.counts;
  const linked = o.linked_new_on_old;
  const options = [
    {
      key: "old" as const,
      title: "Old software data",
      text: `${n(c.legacy_accounts)} accounts, ${n(c.legacy_payments)} receipts and the import history.`,
      warn:
        linked.payments + linked.seizures > 0
          ? `Also deletes ${n(linked.payments)} payments and ${n(linked.seizures)} seizures entered in this app on those old accounts.`
          : null,
    },
    { key: "new" as const, title: "Entries made in this app", text: `${n(c.loans)} loans, ${n(c.borrowers)} borrowers, ${n(c.payments)} payments, ${n(c.seizures)} seizures.`, warn: null },
    { key: "all" as const, title: "Everything", text: "All of the above. Users, settings and the activity log stay.", warn: null },
  ];
  return (
    <section className={`${card} ring-red-200`}>
      <h2 className={`${head} text-red-700`}>Delete data</h2>
      <p className="text-sm text-slate-500">
        Logins, settings and this page&apos;s history are never deleted. A restore point is saved first, so you can undo it from
        Restore points above.
      </p>
      <div className="space-y-2">
        {options.map((op) => (
          <label key={op.key} className={`flex cursor-pointer gap-3 rounded-lg p-3 ring-1 ${scope === op.key ? "bg-red-50 ring-red-300" : "ring-slate-200"}`}>
            <input type="radio" name="scope" className="mt-1 h-5 w-5 accent-red-700" checked={scope === op.key} onChange={() => setScope(op.key)} />
            <span>
              <span className="block text-sm font-semibold">{op.title}</span>
              <span className="block text-xs text-slate-600">{op.text}</span>
              {op.warn && <span className="mt-1 block text-xs font-medium text-red-700">⚠ {op.warn}</span>}
            </span>
          </label>
        ))}
      </div>
      {scope && (
        <div className="rounded-lg ring-1 ring-red-200">
          <div className="space-y-2 p-3">
            <p className="text-sm font-medium">Step 1: download a backup to your device</p>
            <a
              href="/settings/backup"
              onClick={() => setDownloaded(true)}
              className={`${btn} inline-flex items-center bg-white text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50`}
            >
              {downloaded ? "✓ Backup downloaded" : "Download backup (.zip)"}
            </a>
          </div>
          {downloaded ? (
            <Confirm word="DELETE" label="Delete now" tone="red" run={(w, pw) => deleteData(scope, w, pw)} />
          ) : (
            <p className="border-t border-slate-200 p-3 text-sm text-slate-500">Step 2 (confirm and delete) opens after the download.</p>
          )}
        </div>
      )}
    </section>
  );
}

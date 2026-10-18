"use client";

import { useState, useTransition } from "react";
import { Section } from "@/components/section";
import { commitImport, createRestorePoint, deleteData, restore, type Result } from "./actions";

type Counts = Record<string, number>;
export type Overview = {
  counts: Counts;
  linked_new_on_old: { payments: number; seizures: number };
  restore_points: { id: number; created_at: string; by_name: string | null; reason: string; counts: Counts }[];
  audit: { id: number; at: string; by_name: string | null; action: string; details: Record<string, unknown> }[];
};

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
      <Section title="Data now" hint={`${n(c.legacy_accounts)} old accounts · ${n(c.loans)} new loans · ${n(c.payments)} app payments`}>
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
      </Section>

      <BackupCard />
      <RestoreCard points={o.restore_points} />
      <ImportCard />
      <DeleteCard o={o} />

      <Section title="Activity" hint="Who saved, restored, deleted or imported data, and when.">
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
      </Section>
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
    <Section title="Backup" hint="Download a zip to your device, or save a restore point now.">
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
    </Section>
  );
}

function RestoreCard({ points }: { points: Overview["restore_points"] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Section
      title="Restore points"
      hint="Put all data back as it was at an earlier moment."
      badge={<span className="num rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{points.length}</span>}
    >
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
    </Section>
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
    <Section danger title="Delete data" hint="Remove old software data, app entries, or everything (password needed).">
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
    </Section>
  );
}

type Preview = {
  files: Record<string, { source_file: string; total: number; imported: number; skipped: number; flagged: number }>;
  checks: Record<string, { rows: number; total: string }>;
  duplicate_snos: number[];
  accounts: {
    in_files: number;
    new: number;
    changed: number;
    same: number;
    moved: number;
    not_in_files: number;
    examples_new: { sno: number; name: string }[];
    examples_changed: { sno: number; name: string }[];
    examples_moved: { sno: number; name: string; from: string; to: string }[];
    examples_not_in_files: { sno: number; name: string; ledger: string }[];
  };
  receipts: { in_files: number; now_for_these_accounts: number; added: number; removed: number };
  double_entry_risk: { sno: number; name: string; app_first: string; file_receipts_after: number }[];
  double_entry_likely?: {
    sno: number; borrower_name: string; why: string;
    app_receipt: number; app_date: string; app_amount: number;
    file_receipt: number | null; file_date: string | null; file_amount: number | null;
  }[];
};

const FILE_LABEL: Record<string, string> = {
  P_ACCOUNT: "Pending accounts",
  P_INSMENT: "Pending installments",
  F_ACC: "Closed accounts",
  F_INSMENT: "Closed installments",
};

function Examples({ title, items }: { title: string; items: { sno: number; name: string; extra?: string }[] }) {
  if (!items.length) return null;
  return (
    <p className="text-xs text-slate-500">
      {title}: {items.map((x) => `SNO ${x.sno} ${x.name}${x.extra ? ` (${x.extra})` : ""}`).join(", ")}
      {items.length === 10 ? " …" : ""}
    </p>
  );
}

function ImportCard() {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);

  const check = async () => {
    setBusy(true);
    setErr(null);
    setPv(null);
    setJob(null);
    try {
      const fd = new FormData();
      // gzip in the browser: the table files are ~7 MB together and the hosting refuses uploads over 4.5 MB
      for (const f of files) {
        const gz = typeof CompressionStream === "undefined" ? f : await new Response(f.stream().pipeThrough(new CompressionStream("gzip"))).blob();
        fd.append("files", gz, f.name);
      }
      const res = await fetch("/settings/data/import", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({ ok: false, message: "The server did not answer. Try again." }));
      if (!body.ok) setErr(body.message);
      else {
        setJob(body.job);
        setPv(body.preview);
      }
    } catch {
      setErr("Could not upload. Check the internet connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const a = pv?.accounts;
  return (
    <Section title="Import from the old software" hint="Bring in the latest P_ACCOUNT, P_INSMENT, F_ACCOUNT, F_INSMENT files.">
      <p className="text-sm text-slate-500">
        Choose all 4 files from the old software&apos;s folder: P_ACCOUNT, P_INSMENT, F_ACCOUNT, F_INSMENT (.DAT; the older .xlsx
        exports also work). Do this again any time to bring in the latest changes. First you see what would change; nothing is saved
        until you confirm. Accounts are updated by SNO, new ones are added, and accounts missing from the files are kept. Old-software
        receipts are refreshed for the accounts in the files. Loans, payments and seizures entered in this app are not touched.
      </p>
      <input
        type="file"
        multiple
        accept=".dat,.DAT,.dbf,.DBF,.xlsx"
        onChange={(e) => {
          setFiles([...(e.target.files ?? [])]);
          setPv(null);
          setJob(null);
          setErr(null);
        }}
        className="block w-full text-sm file:mr-3 file:h-10 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:font-semibold file:text-blue-700"
      />
      {files.length > 0 && (
        <p className="text-xs text-slate-500">
          {files.length} file{files.length > 1 ? "s" : ""}: {files.map((f) => f.name).join(", ")}
        </p>
      )}
      <button type="button" disabled={busy || files.length === 0} onClick={check} className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}>
        {busy ? "Reading and comparing… (up to a minute)" : "Check files"}
      </button>
      {err && <Msg r={{ ok: false, message: err }} />}

      {pv && a && job && (
        <div className="space-y-3 rounded-lg ring-1 ring-slate-200">
          <div className="space-y-3 p-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="py-1 pr-3">File</th>
                    <th className="py-1 pr-3 text-right">Rows</th>
                    <th className="py-1 pr-3 text-right">Skipped</th>
                    <th className="py-1 pr-3 text-right">Flagged</th>
                    <th className="py-1 text-right">Total ₹</th>
                  </tr>
                </thead>
                <tbody>
                  {(["P_ACCOUNT", "P_INSMENT", "F_ACC", "F_INSMENT"] as const).map((k) => (
                    <tr key={k} className="border-t border-slate-100">
                      <td className="py-1 pr-3">
                        <span className="font-medium">{FILE_LABEL[k]}</span>{" "}
                        <span className="text-xs text-slate-500">{pv.files[k].source_file}</span>
                      </td>
                      <td className="num py-1 pr-3 text-right">{n(pv.files[k].imported)}</td>
                      <td className="num py-1 pr-3 text-right">{n(pv.files[k].skipped)}</td>
                      <td className="num py-1 pr-3 text-right">{n(pv.files[k].flagged)}</td>
                      <td className="num py-1 text-right">
                        {Number(pv.checks[k].total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
              {(
                [
                  ["New accounts", a.new],
                  ["Changed", a.changed],
                  ["Unchanged", a.same],
                  ["Pending ↔ closed", a.moved],
                  ["Not in files (kept)", a.not_in_files],
                ] as const
              ).map(([label, v]) => (
                <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="num text-lg font-semibold">{n(v)}</p>
                </div>
              ))}
            </div>
            <Examples title="New" items={a.examples_new} />
            <Examples title="Changed" items={a.examples_changed} />
            <Examples title="Moved" items={a.examples_moved.map((x) => ({ ...x, extra: `${x.from} → ${x.to}` }))} />
            <Examples title="Not in files" items={a.examples_not_in_files.map((x) => ({ ...x, extra: x.ledger }))} />

            <p className="text-sm">
              Receipts: <b className="num">{n(pv.receipts.in_files)}</b> in the files,{" "}
              <b className="num">{n(pv.receipts.now_for_these_accounts)}</b> now for these accounts —{" "}
              <b className="num text-emerald-700">+{n(pv.receipts.added)}</b> added,{" "}
              <b className="num text-red-700">−{n(pv.receipts.removed)}</b> removed.
            </p>

            {pv.duplicate_snos.length > 0 && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                The files contain the same SNO twice ({pv.duplicate_snos.slice(0, 10).join(", ")}). Fix the files; this cannot be
                imported.
              </p>
            )}
            {(pv.double_entry_likely?.length ?? 0) > 0 && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                <p className="font-semibold">⚠ {pv.double_entry_likely!.length} receipt(s) look entered in both programs</p>
                <p className="text-xs">
                  Each line is a receipt in the files that matches a payment taken in this app. If it is the same money, it will be
                  counted twice: delete it in the old software (then copy the files again) or delete the app payment, before importing.
                </p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-red-700">
                        <th className="py-1 pr-3">Account</th>
                        <th className="py-1 pr-3">In this app</th>
                        <th className="py-1 pr-3">In the files</th>
                        <th className="py-1">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pv.double_entry_likely!.slice(0, 50).map((x, i) => (
                        <tr key={i} className="border-t border-red-100">
                          <td className="py-1 pr-3">SNO {x.sno} {x.borrower_name}</td>
                          <td className="num py-1 pr-3">
                            Rcpt {x.app_receipt} · {x.app_date} · ₹{Number(x.app_amount).toLocaleString("en-IN")}
                          </td>
                          <td className="num py-1 pr-3">
                            Rcpt {x.file_receipt ?? "—"} · {x.file_date ?? "—"} · ₹{Number(x.file_amount ?? 0).toLocaleString("en-IN")}
                          </td>
                          <td className="py-1">{x.why}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {pv.double_entry_risk.length > 0 && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-semibold">⚠ Check for double entries on {pv.double_entry_risk.length} account(s)</p>
                <p className="text-xs">
                  These accounts have payments taken in this app, and the files also have receipts on or after that date. If the same
                  money was entered in both places, it will be counted twice.
                </p>
                <p className="mt-1 text-xs">
                  {pv.double_entry_risk
                    .slice(0, 15)
                    .map((x) => `SNO ${x.sno} ${x.name} (${x.file_receipts_after} receipts)`)
                    .join(", ")}
                </p>
              </div>
            )}
            <p className="text-xs text-slate-500">
              A restore point is saved first. After importing, the totals are checked against the files; if anything does not match,
              nothing is saved.
            </p>
          </div>
          {pv.duplicate_snos.length === 0 && (
            <Confirm word="IMPORT" label="Import now" tone="amber" run={(w, pw) => commitImport(job, w, pw)} />
          )}
        </div>
      )}
    </Section>
  );
}

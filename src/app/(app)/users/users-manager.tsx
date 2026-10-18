"use client";

import { useState, useTransition } from "react";
import { PERMISSIONS, PRESETS } from "@/lib/permissions";
import { createUser, setPassword, signOutUser, updateUser, type Result } from "./actions";

export type UserRow = {
  user_id: string;
  email: string;
  full_name: string;
  role: "admin" | "staff";
  active: boolean;
  permissions: string[];
  last_sign_in_at: string | null;
  created_at: string;
};

const input =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";
const btn = "h-10 rounded-lg px-4 text-sm font-semibold disabled:opacity-60";

export function UsersManager({ users }: { users: UserRow[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      {adding ? (
        <NewUser onDone={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className={`${btn} h-11 bg-blue-700 text-white hover:bg-blue-800`}>
          + Add user
        </button>
      )}
      <ul className="space-y-3">
        {users.map((u) => (
          <UserCard key={u.user_id} u={u} />
        ))}
      </ul>
    </div>
  );
}

function presetOf(role: "admin" | "staff", perms: string[]) {
  const p = PRESETS.find((x) => x.role === role && (role === "admin" || (x.perms.length === perms.length && x.perms.every((k) => perms.includes(k)))));
  return p?.label ?? "Custom";
}

function Access({
  role,
  perms,
  setRole,
  setPerms,
}: {
  role: "admin" | "staff";
  perms: string[];
  setRole: (r: "admin" | "staff") => void;
  setPerms: (p: string[]) => void;
}) {
  const toggle = (k: string) => {
    const next = perms.includes(k) ? perms.filter((x) => x !== k) : [...perms, k];
    // anything at all needs "View accounts"; unticking View accounts clears the rest
    if (k === "view_accounts" && !next.includes(k)) return setPerms([]);
    setPerms(next.length && !next.includes("view_accounts") ? [...next, "view_accounts"] : next);
  };
  return (
    <div className="space-y-3">
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Type of user</span>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const on = presetOf(role, perms) === p.label;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setRole(p.role);
                  setPerms([...p.perms]);
                }}
                className={`h-10 rounded-lg px-4 text-sm font-medium ring-1 ${on ? "bg-blue-700 text-white ring-blue-700" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
      {role === "admin" ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Admins can do everything: all daily work and every extra power, plus Users, Settings and the Data page.
        </p>
      ) : (
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Can do</legend>
          {(["Daily work", "Extra powers"] as const).map((g) => (
            <div key={g} className="mb-2">
              <p className="mt-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{g}</p>
              <div className="space-y-1">
                {PERMISSIONS.filter((p) => p.group === g).map((p) => (
                  <label key={p.key} className="flex min-h-11 items-start gap-3 rounded-lg px-1 py-1.5 hover:bg-slate-50">
                    <input type="checkbox" className="mt-0.5 h-5 w-5 accent-blue-700" checked={perms.includes(p.key)} onChange={() => toggle(p.key)} />
                    <span>
                      <span className="block text-sm font-medium text-slate-800">{p.label}</span>
                      <span className="block text-xs text-slate-500">{p.text}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {perms.length === 0 && <p className="mt-1 text-xs text-red-600">Nothing ticked: this person can sign in but cannot open anything.</p>}
        </fieldset>
      )}
    </div>
  );
}

function Msg({ r }: { r: Result | null }) {
  if (!r) return null;
  return (
    <p role="status" className={`rounded-lg px-3 py-2 text-sm ${r.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
      {r.message}
    </p>
  );
}

function NewUser({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "staff">("staff");
  const [perms, setPerms] = useState<string[]>([...PRESETS[0].perms]);
  const [r, setR] = useState<Result | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4 rounded-xl bg-white p-4 ring-1 ring-slate-200"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await createUser({ name, email, password, role, permissions: perms });
          setR(res);
          if (res.ok) setTimeout(onDone, 1200);
        });
      }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">New user</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Full name</span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Email (their login)</span>
          <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
          <input className={input} type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="off" />
          <span className="mt-1 block text-xs text-slate-500">At least 8 characters. Tell them to change it from Profile after the first sign-in.</span>
        </label>
      </div>
      <Access role={role} perms={perms} setRole={setRole} setPerms={setPerms} />
      <Msg r={r} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}>
          {pending ? "Creating…" : "Create login"}
        </button>
        <button type="button" onClick={onDone} className={`${btn} bg-white text-slate-700 ring-1 ring-slate-300`}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function SignOutNow({ userId, name }: { userId: string; name: string }) {
  const [sure, setSure] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 border-t border-slate-200 pt-4">
      <span className="block text-sm font-medium text-slate-700">Sign out now</span>
      <p className="text-xs text-slate-500">
        Lost phone, or someone left? This signs {name} out on every phone and computer straight away. They can sign in again with
        their password — change the password too if needed.
      </p>
      {!sure ? (
        <button type="button" onClick={() => setSure(true)} className={`${btn} bg-white text-red-700 ring-1 ring-slate-300 hover:bg-red-50`}>
          Sign out everywhere…
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setR(await signOutUser(userId));
                setSure(false);
              })
            }
            className={`${btn} bg-red-700 text-white hover:bg-red-800`}
          >
            {pending ? "Signing out…" : `Yes, sign ${name} out now`}
          </button>
          <button type="button" onClick={() => setSure(false)} className={`${btn} bg-white text-slate-700 ring-1 ring-slate-300`}>
            Keep
          </button>
        </div>
      )}
      <Msg r={r} />
    </div>
  );
}

function UserCard({ u }: { u: UserRow }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(u.full_name);
  const [role, setRole] = useState(u.role);
  const [perms, setPerms] = useState<string[]>(u.permissions);
  const [active, setActive] = useState(u.active);
  const [r, setR] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const [pw, setPw] = useState("");
  const [pwR, setPwR] = useState<Result | null>(null);
  const [pwPending, startPw] = useTransition();

  const summary = u.role === "admin" ? "Admin · everything" : u.permissions.length ? PERMISSIONS.filter((p) => u.permissions.includes(p.key)).map((p) => p.label).join(" · ") : "No access";

  return (
    <li className={`rounded-xl bg-white ring-1 ring-slate-200 ${u.active ? "" : "opacity-70"}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-4 text-left" aria-expanded={open}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-700 font-bold text-white">{u.full_name.charAt(0).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{u.full_name}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{presetOf(u.role, u.permissions)}</span>
            {!u.active && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">Switched off</span>}
          </span>
          <span className="block truncate text-sm text-slate-500">{u.email}</span>
          <span className="block truncate text-xs text-slate-500">{summary}</span>
        </span>
        <span aria-hidden className="text-slate-400">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-200 p-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Full name</span>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <Access role={role} perms={perms} setRole={setRole} setPerms={setPerms} />
          <label className="flex items-center gap-3">
            <input type="checkbox" className="h-5 w-5 accent-blue-700" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span className="text-sm text-slate-800">
              Login is on <span className="text-slate-500">(untick to block this person immediately; their data stays)</span>
            </span>
          </label>
          <Msg r={r} />
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setR(await updateUser(u.user_id, { name, role, active, permissions: perms })))}
            className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}
          >
            {pending ? "Saving…" : "Save"}
          </button>

          <div className="space-y-2 border-t border-slate-200 pt-4">
            <span className="block text-sm font-medium text-slate-700">Set a new password</span>
            <div className="flex flex-wrap gap-2">
              <input className={`${input} max-w-xs`} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (8+ characters)" autoComplete="off" />
              <button
                type="button"
                disabled={pwPending || pw.length < 8}
                onClick={() =>
                  startPw(async () => {
                    const res = await setPassword(u.user_id, pw);
                    setPwR(res);
                    if (res.ok) setPw("");
                  })
                }
                className={`${btn} bg-white text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50`}
              >
                {pwPending ? "Changing…" : "Change password"}
              </button>
            </div>
            <Msg r={pwR} />
          </div>
          <SignOutNow userId={u.user_id} name={u.full_name} />
          <p className="text-xs text-slate-400">
            Last sign-in: {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "never"}
          </p>
        </div>
      )}
    </li>
  );
}

"use client";

import { useActionState, useEffect, useRef } from "react";
import { changePassword, type PasswordState } from "./actions";

const initial: PasswordState = { error: null, ok: false };
const input =
  "h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, initial);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Current password</span>
        <input name="current" type="password" autoComplete="current-password" required className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">New password</span>
        <input name="next" type="password" autoComplete="new-password" minLength={8} required className={input} />
        <span className="mt-1 block text-xs text-slate-500">At least 8 characters.</span>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Repeat new password</span>
        <input name="confirm" type="password" autoComplete="new-password" minLength={8} required className={input} />
      </label>

      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Password changed.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-lg bg-blue-700 text-base font-semibold text-white hover:bg-blue-800 disabled:opacity-60 sm:w-auto sm:px-6"
      >
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}

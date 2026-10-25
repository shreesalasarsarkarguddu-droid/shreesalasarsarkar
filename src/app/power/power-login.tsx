"use client";

import { useActionState } from "react";
import { powerSignIn, type PowerState } from "./actions";

export function PowerLogin() {
  const [state, action, pending] = useActionState<PowerState, FormData>(powerSignIn, { error: null });
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
        <input name="email" type="email" autoComplete="username" required className="h-12 w-full rounded-lg border border-slate-300 px-3" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className="h-12 w-full rounded-lg border border-slate-300 px-3" />
      </label>
      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="h-12 w-full rounded-lg bg-blue-700 font-semibold text-white disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

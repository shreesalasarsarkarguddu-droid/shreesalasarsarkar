import { useState } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "@/lib/auth";
import { homeFor } from "@/lib/permissions";

export default function LoginPage() {
  const { staff, signIn } = useAuth();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (staff) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== "/login" ? from : homeFor(staff)} replace />;
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4">
      <title>Sign in · Shree Salasar Sarkar</title>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
<img src="/icons/icon-192.png" alt="" width={56} height={56} className="mb-3 h-14 w-14 rounded-xl" />
        <h1 className="text-xl font-bold text-slate-900">Shree Salasar Sarkar</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">Sign in to view accounts</p>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const email = String(fd.get("email") ?? "").trim();
            const password = String(fd.get("password") ?? "");
            if (!email || !password) return setError("Enter your email and password.");
            setPending(true);
            setError(await signIn(email, password));
            setPending(false);
          }}
        >
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            />
          </label>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="h-12 w-full rounded-lg bg-blue-700 text-base font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}

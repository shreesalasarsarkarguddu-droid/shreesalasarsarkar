import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Shree Salasar Sarkar" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold text-slate-900">Shree Salasar Sarkar</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">Sign in to view accounts</p>
        <LoginForm />
      </div>
    </main>
  );
}

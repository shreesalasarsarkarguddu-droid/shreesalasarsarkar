import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Profile · Shree Salasar Sarkar" };

export default async function ProfilePage() {
  const supabase = await createClient();
  const [{ data: claims }, { data: staff }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("staff").select("full_name, role").maybeSingle(),
  ]);
  const email = (claims?.claims?.email as string | undefined) ?? "—";
  const name = staff?.full_name ?? "—";

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-bold">Profile</h1>

      <section className="flex items-center gap-4 rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xl font-bold text-white">
          {name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{name}</p>
          <p className="truncate text-sm text-slate-500">{email}</p>
          <span className="mt-1 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-slate-700">
            {staff?.role ?? "—"}
          </span>
        </div>
      </section>

      <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Change password</h2>
        <PasswordForm />
      </section>

      <form action={signOut}>
        <button className="h-12 w-full rounded-xl bg-white text-base font-semibold text-red-700 ring-1 ring-slate-200 hover:bg-red-50">
          Sign out
        </button>
      </form>
    </div>
  );
}

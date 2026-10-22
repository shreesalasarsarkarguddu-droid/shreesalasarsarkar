import Link from "next/link";
import { useAuth, useStaff } from "@/lib/auth";
import { PasswordForm } from "./password-form";
import { autodealUrl } from "@/lib/autodeal";
import { can, controlLinks } from "@/lib/permissions";
import { API } from "@/lib/api";

export default function ProfilePage() {
  const staff = useStaff();
  const { signOut } = useAuth();
  const name = staff.full_name ?? "—";

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <title>Profile · Shree Salasar Sarkar</title>
      <h1 className="text-xl font-bold">Profile</h1>

      <section className="flex items-center gap-4 rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xl font-bold text-white">
          {name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{name}</p>
          <p className="truncate text-sm text-slate-500">{staff.email}</p>
          <span className="mt-1 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-slate-700">
            {staff.role}
          </span>
        </div>
      </section>

      {controlLinks(staff).map((l) => (
        <Link key={l.href} href={l.href} className="flex items-center justify-between rounded-xl bg-white p-4 ring-1 ring-slate-200 hover:bg-slate-50">
          <span>
            <span className="block font-semibold text-blue-700">{l.label}</span>
            <span className="block text-sm text-slate-500">{l.text}</span>
          </span>
          <span aria-hidden className="text-slate-400">›</span>
        </Link>
      ))}

      {autodealUrl(staff) && (
        <a href={autodealUrl(staff)!} className="flex items-center justify-between rounded-xl bg-white p-4 ring-1 ring-slate-200 hover:bg-slate-50">
          <span>
            <span className="block font-semibold text-blue-700">Auto Deal</span>
            <span className="block text-sm text-slate-500">Used-vehicle stock, sales and payments.</span>
          </span>
          <span aria-hidden className="text-slate-400">›</span>
        </a>
      )}

      {staff.role !== "admin" && can(staff, "backup") && (
        <a href={`${API}/api/backup`} className="flex items-center justify-between rounded-xl bg-white p-4 ring-1 ring-slate-200 hover:bg-slate-50">
          <span>
            <span className="block font-semibold text-blue-700">Download backup</span>
            <span className="block text-sm text-slate-500">Every account and payment as a zip. Keep it private.</span>
          </span>
          <span aria-hidden className="text-slate-400">↓</span>
        </a>
      )}

      <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Change password</h2>
        <PasswordForm />
      </section>

      <button
        onClick={() => void signOut()}
        className="h-12 w-full rounded-xl bg-white text-base font-semibold text-red-700 ring-1 ring-slate-200 hover:bg-red-50"
      >
        Sign out
      </button>
    </div>
  );
}

import type { Metadata } from "next";
import { requireAdmin } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { UsersManager, type UserRow } from "./users-manager";

export const metadata: Metadata = { title: "Users · Shree Salasar Sarkar" };

export default async function UsersPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_users");
  if (error) throw new Error("Could not load users.");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Users</h1>
        <p className="text-sm text-slate-500">Create logins for your staff and choose what each person can do. Only admins can see this page.</p>
      </div>
      <UsersManager users={data as UserRow[]} />
    </div>
  );
}

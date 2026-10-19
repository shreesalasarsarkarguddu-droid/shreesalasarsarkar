"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: boolean; message: string };

type Input = { name: string; role: "admin" | "staff"; permissions: string[] };

// Admin-only: every function below refuses anyone else inside the database.
function explain(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "Only an admin can manage users.";
  if (error.code === "22023" || error.code === "23505") return error.message.charAt(0).toUpperCase() + error.message.slice(1) + ".";
  console.error("user admin failed:", error.message);
  return "Something went wrong. Try again.";
}

export async function createUser(v: Input & { email: string; password: string }): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_user", {
    p_email: v.email,
    p_name: v.name,
    p_password: v.password,
    p_role: v.role,
    p_perms: v.permissions,
  });
  if (error) return { ok: false, message: explain(error) };
  revalidatePath("/users");
  return { ok: true, message: "Login created. Share the email and password with them." };
}

export async function updateUser(userId: string, v: Input & { active: boolean }): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_user", {
    p_user: userId,
    p_name: v.name,
    p_role: v.role,
    p_active: v.active,
    p_perms: v.permissions,
  });
  if (error) return { ok: false, message: explain(error) };
  revalidatePath("/users");
  return { ok: true, message: "Saved." };
}

export async function archiveUser(userId: string, archive: boolean): Promise<Result> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_archive_user", { p_user: userId, p_archive: archive });
  if (error) return { ok: false, message: explain(error) };
  revalidatePath("/users");
  if (!archive) return { ok: true, message: "Restored. The login is still off — tick “Login is on” and Save to let them sign in again." };
  const d = data as { books_closed: number; list_entries_removed: number };
  return {
    ok: true,
    message:
      "Removed. They are signed out and hidden from lists; their past entries keep their name." +
      (d.books_closed ? ` ${d.books_closed} receipt book(s) closed.` : "") +
      (d.list_entries_removed ? ` Taken off ${d.list_entries_removed} collection list entr${d.list_entries_removed === 1 ? "y" : "ies"}.` : ""),
  };
}

export async function signOutUser(userId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_sign_out_user", { p_user: userId });
  if (error) return { ok: false, message: explain(error) };
  return { ok: true, message: "Signed out everywhere. They must sign in again." };
}

export async function setPassword(userId: string, password: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_password", { p_user: userId, p_password: password });
  if (error) return { ok: false, message: explain(error) };
  return { ok: true, message: "Password changed. They are signed out and must use the new one." };
}

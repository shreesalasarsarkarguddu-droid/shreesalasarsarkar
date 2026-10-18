"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: boolean; message: string };

// Re-check the admin's own password before anything destructive.
async function checkPassword(password: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email as string | undefined;
  if (!email) return "Your session has expired. Sign in again.";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? "Your password is incorrect." : null;
}

function explain(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "Only an admin can do this.";
  if (error.code === "22023") return error.message.charAt(0).toUpperCase() + error.message.slice(1) + ".";
  if (error.code === "57014") return "It took too long and was cancelled. Nothing was changed. Try again.";
  console.error("data action failed:", error.message);
  return "Something went wrong. Nothing was changed.";
}

export async function createRestorePoint(): Promise<Result> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_restore_point", { p_reason: "Manual" });
  if (error) return { ok: false, message: explain(error) };
  revalidatePath("/settings/data");
  return { ok: true, message: `Restore point #${data} saved.` };
}

export async function deleteData(scope: "old" | "new" | "all", confirm: string, password: string): Promise<Result> {
  const bad = await checkPassword(password);
  if (bad) return { ok: false, message: bad };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_delete_data", { p_scope: scope, p_confirm: confirm });
  if (error) return { ok: false, message: explain(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: `Deleted. You can undo this with restore point #${(data as { restore_point: number }).restore_point}.` };
}

export async function restore(point: number, confirm: string, password: string): Promise<Result> {
  const bad = await checkPassword(password);
  if (bad) return { ok: false, message: bad };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_restore", { p_point: point, p_confirm: confirm });
  if (error) return { ok: false, message: explain(error) };
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `Restored to #${point}. The data as it was just before is saved as restore point #${(data as { saved_before_restore: number }).saved_before_restore}.`,
  };
}

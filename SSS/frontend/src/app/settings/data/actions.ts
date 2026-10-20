import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: boolean; message: string };

// Anything that replaces data sends the admin's own password; the server checks it again before changing anything.
function explain(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "Only an admin can do this.";
  if (error.code === "22023") return error.message.charAt(0).toUpperCase() + error.message.slice(1) + ".";
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
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_delete_data", { p_scope: scope, p_confirm: confirm, p_password: password });
  if (error) return { ok: false, message: explain(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: `Deleted. You can undo this with restore point #${(data as { restore_point: number }).restore_point}.` };
}

export async function restore(point: number, confirm: string, password: string): Promise<Result> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_restore", { p_point: point, p_confirm: confirm, p_password: password });
  if (error) return { ok: false, message: explain(error) };
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `Restored to #${point}. The data as it was just before is saved as restore point #${(data as { saved_before_restore: number }).saved_before_restore}.`,
  };
}

export async function restoreFromFile(job: string, confirm: string, password: string): Promise<Result> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_backup_commit", { p_job: job, p_confirm: confirm, p_password: password });
  if (error) return { ok: false, message: explain(error) };
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `Restored from the backup file. The data as it was just before is saved as restore point #${(data as { saved_before_restore: number }).saved_before_restore}.`,
  };
}

export async function commitImport(job: string, confirm: string, password: string): Promise<Result> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_import_commit", { p_job: job, p_confirm: confirm, p_password: password });
  if (error) return { ok: false, message: explain(error) };
  revalidatePath("/", "layout");
  const d = data as { restore_point: number; accounts: number; receipts: number };
  return {
    ok: true,
    message: `Imported ${d.accounts.toLocaleString("en-IN")} accounts and ${d.receipts.toLocaleString("en-IN")} receipts. Totals matched the files. To undo, restore #${d.restore_point}.`,
  };
}

/** Send rows to the server a slice at a time (one request stays well under the hosting's upload limit). */
export async function stageRows(fn: string, params: Record<string, unknown>, rows: unknown[], size = 1000): Promise<void> {
  const supabase = await createClient();
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await supabase.rpc(fn, { ...params, p_rows: rows.slice(i, i + size) });
    if (error) throw new Error(error.code === "22023" ? explain(error) : "Could not upload the rows. Nothing was changed. Try again.");
  }
}

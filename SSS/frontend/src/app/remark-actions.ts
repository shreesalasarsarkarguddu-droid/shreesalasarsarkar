// Visit remarks. The database checks the permission again (collect to write; same day or "fix mistakes" to delete).

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type RemarkResult = { ok: true; message: string } | { ok: false; error: string };

function fail(e: { code?: string; message: string }, fallback: string): RemarkResult {
  if (e.code === "42501") return { ok: false, error: e.message.startsWith("only") ? "Only the admin can delete an older remark." : "Your login is not allowed to do this." };
  if (e.code === "22023" || e.code === "P0002") return { ok: false, error: e.message.charAt(0).toUpperCase() + e.message.slice(1) + "." };
  console.error(fallback, e);
  return { ok: false, error: `${fallback} Check your internet and try again.` };
}

const remarkInput = z.object({
  source: z.enum(["old", "new"]),
  refId: z.number().int().positive(),
  installmentNo: z.number().int().positive().nullable(),
  remark: z.string().trim().min(2, { error: "Write what the customer said" }).max(300, { error: "Too long (300 letters at most)" }),
  promiseDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Enter the date as DD/MM/YYYY" })]),
});
export type RemarkInput = z.input<typeof remarkInput>;

export async function addRemark(input: RemarkInput): Promise<RemarkResult> {
  const parsed = remarkInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_remark", {
    p: { source: v.source, ref_id: v.refId, installment_no: v.installmentNo, remark: v.remark, promise_date: v.promiseDate },
  });
  if (error) return fail(error, "Could not save the remark.");
  revalidatePath(v.source === "old" ? `/accounts/${v.refId}` : `/loans/${v.refId}`);
  revalidatePath("/remarks");
  revalidatePath("/my-collections");
  return { ok: true, message: "Remark saved." };
}

export async function deleteRemark(id: number, path: string): Promise<RemarkResult> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Invalid request. Reload the page." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_remark", { p_id: id });
  if (error) return fail(error, "Could not delete.");
  if (/^\/(accounts|loans)\/\d+$/.test(path)) revalidatePath(path);
  revalidatePath("/remarks");
  return { ok: true, message: "Remark deleted." };
}

"use server";

// Admin only: edit an account or a receipt that came from the old software, or cancel such a receipt. The database
// checks the admin role again and writes the activity log; what is changed here is kept if the files are imported again.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStaff } from "@/lib/staff";
import { oldAccountSchema, oldReceiptSchema, type OldReceiptInput } from "@/lib/old-account";

export type OldFixResult = { ok: true; message: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const reason = z.string().trim().min(3, { error: "Write the reason (at least 3 letters)" }).max(300, { error: "Reason is too long" });

function dbError(e: { code?: string; message: string }, fallback: string): OldFixResult {
  if (e.code === "42501") return { ok: false, error: "Only an admin can change data from the old software." };
  if (e.code === "P0002") return { ok: false, error: "Not found. It may have been changed already; reload the page." };
  if (e.code === "22023") return { ok: false, error: e.message.charAt(0).toUpperCase() + e.message.slice(1) + "." };
  console.error(fallback, e);
  return { ok: false, error: `${fallback} Check your internet and try again.` };
}

async function adminOnly(): Promise<OldFixResult | null> {
  const staff = await getStaff();
  return staff?.role === "admin" ? null : { ok: false, error: "Only an admin can change data from the old software." };
}

function invalid(issues: z.core.$ZodIssue[]): OldFixResult {
  const fieldErrors: Record<string, string> = {};
  for (const i of issues) fieldErrors[String(i.path[0])] ??= i.message;
  return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
}

function refresh(sno: number) {
  revalidatePath(`/accounts/${sno}`);
  revalidatePath("/accounts");
  revalidatePath("/activity");
}

const owedText = (owed: unknown) => `Balance now ₹${Number(owed).toLocaleString("en-IN", { maximumFractionDigits: 2 })}.`;

export async function editOldAccount(sno: number, values: Record<string, string>, why: string): Promise<OldFixResult> {
  const denied = await adminOnly();
  if (denied) return denied;
  const parsed = oldAccountSchema.safeParse(values);
  const r = reason.safeParse(why);
  if (!parsed.success || !r.success) {
    return invalid([...(parsed.success ? [] : parsed.error.issues), ...(r.success ? [] : r.error.issues.map((i) => ({ ...i, path: ["reason"] })))]);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_edit_legacy_account", { p_sno: sno, p: parsed.data, p_reason: r.data });
  if (error) return dbError(error, "Could not save the account.");
  refresh(sno);
  return { ok: true, message: `Account updated. ${owedText((data as { owed: number }).owed)}` };
}

export async function editOldReceipt(id: number, sno: number, input: OldReceiptInput & { reason: string }): Promise<OldFixResult> {
  const denied = await adminOnly();
  if (denied) return denied;
  const parsed = oldReceiptSchema.safeParse(input);
  const r = reason.safeParse(input.reason);
  if (!parsed.success || !r.success) {
    return invalid([...(parsed.success ? [] : parsed.error.issues), ...(r.success ? [] : r.error.issues.map((i) => ({ ...i, path: ["reason"] })))]);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_edit_legacy_payment", { p_id: id, p: parsed.data, p_reason: r.data });
  if (error) return dbError(error, "Could not save the receipt.");
  refresh(sno);
  return { ok: true, message: `Receipt updated. ${owedText((data as { owed: number }).owed)}` };
}

export async function cancelOldReceipt(id: number, sno: number, why: string): Promise<OldFixResult> {
  const denied = await adminOnly();
  if (denied) return denied;
  const r = reason.safeParse(why);
  if (!r.success) return { ok: false, error: r.error.issues[0].message, fieldErrors: { reason: r.error.issues[0].message } };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_cancel_legacy_payment", { p_id: id, p_reason: r.data });
  if (error) return dbError(error, "Could not cancel the receipt.");
  refresh(sno);
  return { ok: true, message: `Receipt cancelled. It is kept in the activity log. ${owedText((data as { owed: number }).owed)}` };
}

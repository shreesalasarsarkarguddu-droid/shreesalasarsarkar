"use server";

// Admin fixes: edit / cancel a payment, edit / delete a new loan. The database checks the admin role again
// (and writes the activity log), so these are only a thin, validated door to it.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStaff } from "@/lib/staff";
import { loanSchema, type LoanFields } from "@/lib/loan";
import { PAYMENT_MODES } from "@/lib/payment";
import { todayIST } from "@/lib/schedule";

export type FixResult = { ok: true; message: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const reason = z.string().trim().min(3, { error: "Write the reason (at least 3 letters)" }).max(300, { error: "Reason is too long" });

function dbError(e: { code?: string; message: string }, fallback: string): FixResult {
  if (e.code === "42501") return { ok: false, error: "Only an admin can do this." };
  if (e.code === "P0002") return { ok: false, error: "Not found. It may have been changed already; reload the page." };
  if (e.code === "22023") return { ok: false, error: e.message.charAt(0).toUpperCase() + e.message.slice(1) + "." };
  if (e.code === "23505")
    return /receipt/.test(e.message)
      ? { ok: false, error: "That receipt number is already used.", fieldErrors: { receipt_no: "Already used" } }
      : { ok: false, error: "That folio number is already used.", fieldErrors: { folio_no: "This folio number is already used" } };
  if (e.code === "23514") return { ok: false, error: "Some values are not allowed (check mobile numbers and amounts)." };
  console.error(fallback, e);
  return { ok: false, error: `${fallback} Check your internet and try again.` };
}

async function adminOnly(): Promise<FixResult | null> {
  const staff = await getStaff();
  return staff?.role === "admin" ? null : { ok: false, error: "Only an admin can do this." };
}

function refresh(path: string) {
  revalidatePath(path);
  revalidatePath("/accounts");
  revalidatePath("/activity");
}

// ---------------------------------------------------------------- payments
const paymentFix = z
  .object({
    paid_amount: z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, { error: "Enter the amount" }).refine((v) => Number(v) > 0, { error: "Must be more than 0" }),
    paid_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Enter the date" }).refine((v) => v <= todayIST(), { error: "Cannot be in the future" }),
    payment_mode: z.enum(PAYMENT_MODES, { error: "Choose the mode" }),
    receipt_no: z.string().trim().regex(/^\d{1,12}$/, { error: "Enter the receipt number" }).refine((v) => Number(v) > 0, { error: "Enter the receipt number" }),
    reference_no: z.string().trim().max(30, { error: "Too long" }),
    bank_name: z.string().trim().max(60, { error: "Too long" }),
    installments_covered: z.string().trim().regex(/^\d{1,3}$/, { error: "1 or more" }).refine((v) => Number(v) >= 1 && Number(v) <= 360, { error: "1 or more" }),
    reason,
  })
  .refine((v) => v.payment_mode !== "CHEQUE" || v.reference_no !== "", { error: "Enter the cheque number", path: ["reference_no"] })
  .refine((v) => v.payment_mode !== "BANK" || v.bank_name !== "", { error: "Enter the bank name", path: ["bank_name"] });

export type PaymentFixInput = z.input<typeof paymentFix>;

export async function editPayment(id: number, path: string, input: PaymentFixInput): Promise<FixResult> {
  const denied = await adminOnly();
  if (denied) return denied;
  const parsed = paymentFix.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const { reason: why, ...p } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_edit_payment", {
    p_id: id,
    p: { ...p, receipt_no: Number(p.receipt_no), installments_covered: Number(p.installments_covered) },
    p_reason: why,
  });
  if (error) return dbError(error, "Could not save the change.");
  refresh(path);
  return { ok: true, message: "Payment updated. Later payments on this account were recalculated." };
}

export async function cancelPayment(id: number, path: string, why: string): Promise<FixResult> {
  const denied = await adminOnly();
  if (denied) return denied;
  const r = reason.safeParse(why);
  if (!r.success) return { ok: false, error: r.error.issues[0].message, fieldErrors: { reason: r.error.issues[0].message } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_cancel_payment", { p_id: id, p_reason: r.data });
  if (error) return dbError(error, "Could not cancel the payment.");
  refresh(path);
  return { ok: true, message: "Payment cancelled. It is kept in the activity log." };
}

// ---------------------------------------------------------------- loans
export type LoanFixResult = { ok: true; id: number } | { ok: false; error: string; fieldErrors?: Partial<Record<LoanFields | "reason", string>> };

export async function editLoan(id: number, values: Record<string, string>, why: string): Promise<LoanFixResult> {
  const denied = await adminOnly();
  if (denied) return denied as LoanFixResult;
  const parsed = loanSchema.safeParse(values);
  const r = reason.safeParse(why);
  if (!parsed.success || !r.success) {
    const fieldErrors: Partial<Record<LoanFields | "reason", string>> = {};
    if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[i.path[0] as LoanFields] ??= i.message;
    if (!r.success) fieldErrors.reason = r.error.issues[0].message;
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_edit_loan", { p_loan: id, p: parsed.data, p_reason: r.data });
  if (error) return dbError(error, "Could not save the loan.") as LoanFixResult;
  refresh(`/loans/${id}`);
  return { ok: true, id };
}

export async function deleteLoan(id: number, why: string, confirm: string): Promise<FixResult> {
  const denied = await adminOnly();
  if (denied) return denied;
  const r = reason.safeParse(why);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_loan", { p_loan: id, p_reason: r.data, p_confirm: confirm });
  if (error) return dbError(error, "Could not delete the loan.");
  refresh("/accounts");
  return { ok: true, message: "Loan deleted. A full copy is kept in the activity log." };
}

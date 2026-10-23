// Admin fixes: edit / cancel a payment, edit / delete a new loan. The database checks the admin role again
// (and writes the activity log), so these are only a thin, validated door to it.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStaff } from "@/lib/staff";
import { can, type Permission } from "@/lib/permissions";
import { loanSchema, type LoanFields } from "@/lib/loan";
import { PAYMENT_MODES } from "@/lib/payment";
import { todayIST } from "@/lib/schedule";

export type FixResult = { ok: true; message: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const reason = z.string().trim().min(3, { error: "Write the reason (at least 3 letters)" }).max(300, { error: "Reason is too long" });

function dbError(e: { code?: string; message: string }, fallback: string): FixResult {
  if (e.code === "42501") return { ok: false, error: "Your login is not allowed to do this." };
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

async function allowed(p: Permission): Promise<FixResult | null> {
  const staff = await getStaff();
  return can(staff, p) ? null : { ok: false, error: "Your login is not allowed to do this." };
}

function refresh(path: string) {
  revalidatePath(path);
  revalidatePath("/accounts");
  revalidatePath("/activity");
}

// ---------------------------------------------------------------- payments
const moneyPart = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, { error: "Enter each part's amount" }).refine((v) => Number(v) > 0, { error: "Each part must be more than 0" });
const paymentFix = z
  .object({
    paid_amount: z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, { error: "Enter the amount" }).refine((v) => Number(v) > 0, { error: "Must be more than 0" }),
    paid_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Enter the date" }).refine((v) => v <= todayIST(), { error: "Cannot be in the future" }),
    payment_mode: z.enum([...PAYMENT_MODES, "SPLIT"], { error: "Choose the mode" }),
    receipt_no: z.string().trim().regex(/^\d{1,12}$/, { error: "Enter the receipt number" }).refine((v) => Number(v) > 0, { error: "Enter the receipt number" }),
    reference_no: z.string().trim().max(30, { error: "Too long" }),
    bank_name: z.string().trim().max(60, { error: "Too long" }),
    installments_covered: z.string().trim().regex(/^\d{1,3}$/, { error: "1 or more" }).refine((v) => Number(v) >= 1 && Number(v) <= 360, { error: "1 or more" }),
    reason,
    // the receipt's charges (OD / seize / other + note); a split covers EMI + charges (their sum)
    od_amount: z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, { error: "Numbers only" }).optional(),
    seize_amount: z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, { error: "Numbers only" }).optional(),
    other_amount: z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, { error: "Numbers only" }).optional(),
    other_note: z.string().trim().max(100, { error: "Too long" }).optional(),
    charges: z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/).optional(),
    // split payment: e.g. cash + bank on one receipt
    parts: z
      .array(
        z.object({
          mode: z.enum(PAYMENT_MODES),
          amount: moneyPart,
          bank_name: z.string().trim().max(60),
          reference_no: z.string().trim().max(30),
        }),
      )
      .max(4)
      .optional(),
  })
  .refine((v) => v.payment_mode !== "CHEQUE" || v.reference_no !== "", { error: "Enter the cheque number", path: ["reference_no"] })
  .refine((v) => v.payment_mode !== "BANK" || v.bank_name !== "", { error: "Enter the bank name", path: ["bank_name"] })
  .refine((v) => v.payment_mode !== "SPLIT" || (v.parts?.length ?? 0) >= 2, { error: "A split payment needs 2 parts", path: ["parts"] })
  .refine(
    (v) =>
      v.payment_mode !== "SPLIT" ||
      !v.parts ||
      Math.round(v.parts.reduce((t, p) => t + Number(p.amount), 0) * 100) === Math.round(Number(v.paid_amount) * 100) + Math.round(Number(v.charges ?? 0) * 100),
    { error: "The parts must add up to the amount (EMI + charges)", path: ["parts"] },
  )
  .refine((v) => v.payment_mode !== "SPLIT" || !v.parts?.some((p) => p.mode === "BANK" && !p.bank_name), { error: "Enter the bank name for the bank part", path: ["parts"] })
  .refine((v) => v.payment_mode !== "SPLIT" || !v.parts?.some((p) => p.mode === "CHEQUE" && !p.reference_no), { error: "Enter the cheque number for the cheque part", path: ["parts"] });

export type PaymentFixInput = z.input<typeof paymentFix>;

export async function editPayment(id: number, path: string, input: PaymentFixInput): Promise<FixResult> {
  const denied = await allowed("fix_entries");
  if (denied) return denied;
  const parsed = paymentFix.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const { reason: why, parts, ...p } = parsed.data; // p.charges is only for the check above (the database keeps the charges)
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_edit_payment", {
    p_id: id,
    p: {
      ...p,
      receipt_no: Number(p.receipt_no),
      installments_covered: Number(p.installments_covered),
      ...(p.payment_mode === "SPLIT"
        ? { parts: parts!.map((x) => ({ ...x, bank_name: x.mode === "BANK" ? x.bank_name : "", reference_no: x.mode === "CASH" ? "" : x.reference_no })) }
        : {}),
    },
    p_reason: why,
  });
  if (error) return dbError(error, "Could not save the change.");
  refresh(path);
  return { ok: true, message: "Payment updated. Later payments on this account were recalculated." };
}

export async function cancelPayment(id: number, path: string, why: string): Promise<FixResult> {
  const denied = await allowed("fix_entries");
  if (denied) return denied;
  const r = reason.safeParse(why);
  if (!r.success) return { ok: false, error: r.error.issues[0].message, fieldErrors: { reason: r.error.issues[0].message } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_cancel_payment", { p_id: id, p_reason: r.data });
  if (error) return dbError(error, "Could not cancel the payment.");
  refresh(path);
  return { ok: true, message: "Payment cancelled. It is kept in the activity log." };
}

// ---------------------------------------------------------------- late fee / discount / close / reschedule
const moneyStr = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, { error: "Enter the amount" }).refine((v) => Number(v) > 0, { error: "Must be more than 0" });
const adjustInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("penalty"), amount: moneyStr, reason }),
  z.object({ kind: z.literal("discount"), amount: moneyStr, reason }),
  z.object({ kind: z.literal("settle"), reason }),
  z.object({
    kind: z.literal("reschedule"),
    new_emi: moneyStr,
    next_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Enter the next due date" }),
    reason,
  }),
]);
export type AdjustInput = z.input<typeof adjustInput>;

export async function addAdjustment(source: "old" | "new", refId: number, path: string, input: AdjustInput): Promise<FixResult> {
  const denied = await allowed("money");
  if (denied) return denied;
  const parsed = adjustInput.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_adjust", { p: { source, ref_id: refId, ...parsed.data } });
  if (error) return dbError(error, "Could not save.");
  refresh(path);
  const owed = Number((data as { owed: number }).owed).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const done = { penalty: "Late fee added", discount: "Discount given", settle: "Account closed", reschedule: "Rescheduled" }[parsed.data.kind];
  return { ok: true, message: `${done}. Balance now ₹${owed}.` };
}

export async function cancelAdjustment(id: number, path: string, why: string): Promise<FixResult> {
  const denied = await allowed("money");
  if (denied) return denied;
  const r = reason.safeParse(why);
  if (!r.success) return { ok: false, error: r.error.issues[0].message, fieldErrors: { reason: r.error.issues[0].message } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_cancel_adjustment", { p_id: id, p_reason: r.data });
  if (error) return dbError(error, "Could not cancel.");
  refresh(path);
  return { ok: true, message: "Cancelled. It stays in the history and the activity log." };
}

// ---------------------------------------------------------------- loans
export type LoanFixResult = { ok: true; id: number } | { ok: false; error: string; fieldErrors?: Partial<Record<LoanFields | "reason", string>> };

export async function editLoan(id: number, values: Record<string, string>, why: string): Promise<LoanFixResult> {
  const denied = await allowed("fix_entries");
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

/** Admin only: delete a loan with everything on it (payments too), after the reason, the folio no. and the delete PIN. */
export async function purgeLoan(id: number, why: string, folio: string, pin: string): Promise<FixResult> {
  const staff = await getStaff();
  if (staff?.role !== "admin") return { ok: false, error: "Only an admin can delete a loan completely." };
  const r = reason.safeParse(why);
  if (!r.success) return { ok: false, error: r.error.issues[0].message, fieldErrors: { reason: r.error.issues[0].message } };
  if (!/^\d{4,8}$/.test(pin.trim())) return { ok: false, error: "Enter the PIN.", fieldErrors: { pin: "Enter the PIN" } };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_purge_loan", { p_loan: id, p_reason: r.data, p_folio: folio, p_pin: pin.trim() });
  if (error) {
    if (error.message === "wrong PIN") return { ok: false, error: "Wrong PIN. Nothing was deleted.", fieldErrors: { pin: "Wrong PIN" } };
    return dbError(error, "Could not delete the loan.");
  }
  refresh("/accounts");
  const d = data as { payments: number; restore_point: number };
  return { ok: true, message: `Loan deleted with its ${d.payments} payment(s). To undo, restore #${d.restore_point} in Settings → Data.` };
}

export async function deleteLoan(id: number, why: string, confirm: string): Promise<FixResult> {
  const denied = await allowed("fix_entries");
  if (denied) return denied;
  const r = reason.safeParse(why);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_loan", { p_loan: id, p_reason: r.data, p_confirm: confirm });
  if (error) return dbError(error, "Could not delete the loan.");
  refresh("/accounts");
  return { ok: true, message: "Loan deleted. A full copy is kept in the activity log." };
}

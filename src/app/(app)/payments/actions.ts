"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getLedger, type Ledger } from "@/lib/ledger";
import { todayIST } from "@/lib/schedule";
import { PAYMENT_MODES } from "@/lib/payment";

const ref = z.object({ source: z.enum(["old", "new"]), refId: z.number().int().positive() });

export async function loadLedger(source: string, refId: number): Promise<{ ok: true; ledger: Ledger } | { ok: false; error: string }> {
  const parsed = ref.safeParse({ source, refId });
  if (!parsed.success) return { ok: false, error: "Invalid account." };
  try {
    const ledger = await getLedger(await createClient(), parsed.data.source, parsed.data.refId);
    return ledger ? { ok: true, ledger } : { ok: false, error: "This account is no longer pending." };
  } catch (e) {
    console.error("loadLedger failed:", e);
    return { ok: false, error: "Could not load. Check your internet and try again." };
  }
}

const paymentSchema = z.object({
  source: z.enum(["old", "new"]),
  refId: z.number().int().positive(),
  idempotencyKey: z.uuid(),
  paid_amount: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, { error: "Enter the amount (numbers only, up to 2 decimals)" })
    .refine((v) => Number(v) > 0, { error: "Amount must be more than 0" }),
  paid_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Enter the paid date" })
    .refine((v) => v <= todayIST(), { error: "Paid date cannot be in the future" }),
  payment_mode: z.enum([...PAYMENT_MODES, "SPLIT"], { error: "Choose payment mode" }),
  receipt_no: z.string().trim().regex(/^\d{1,12}$/, { error: "Enter the receipt number" }),
  reference_no: z.string().trim().max(30, { error: "Too long" }),
  bank_name: z.string().trim().max(60, { error: "Too long" }),
  installments_covered: z.number().int().min(1, { error: "At least 1 EMI" }).max(360),
  // split payment: e.g. cash + bank on one receipt
  parts: z
    .array(
      z.object({
        mode: z.enum(PAYMENT_MODES),
        amount: z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, { error: "Enter each part's amount" }).refine((v) => Number(v) > 0, { error: "Each part must be more than 0" }),
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
    (v) => v.payment_mode !== "SPLIT" || !v.parts || Math.round(v.parts.reduce((t, p) => t + Number(p.amount), 0) * 100) === Math.round(Number(v.paid_amount) * 100),
    { error: "The parts must add up to the amount", path: ["parts"] },
  )
  .refine((v) => v.payment_mode !== "SPLIT" || !v.parts?.some((p) => p.mode === "BANK" && !p.bank_name), { error: "Enter the bank name for the bank part", path: ["parts"] })
  .refine((v) => v.payment_mode !== "SPLIT" || !v.parts?.some((p) => p.mode === "CHEQUE" && !p.reference_no), { error: "Enter the cheque number for the cheque part", path: ["parts"] });

// Plain strings from the form; everything is validated on the server below.
export type PaymentInput = {
  source: string;
  refId: number;
  idempotencyKey: string;
  paid_amount: string;
  paid_date: string;
  payment_mode: string;
  receipt_no: string;
  reference_no: string;
  bank_name: string;
  installments_covered: number;
  parts?: { mode: string; amount: string; bank_name: string; reference_no: string }[];
};
export type PaymentField = "paid_amount" | "paid_date" | "payment_mode" | "receipt_no" | "reference_no" | "bank_name" | "installments_covered" | "parts";
export type RecordResult =
  | { ok: true; receiptNo: number; installmentNo: number; ledger: Ledger | null; review: string | null; pending: boolean }
  | { ok: false; error: string; fieldErrors?: Partial<Record<PaymentField, string>> };

export async function recordPayment(input: PaymentInput): Promise<RecordResult> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<PaymentField, string>> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path[0] as PaymentField] ??= i.message;
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const v = parsed.data;
  const supabase = await createClient();

  // Receipt numbers also must not repeat ones issued by the old software.
  const { count } = await supabase
    .from("legacy_payments")
    .select("id", { count: "exact", head: true })
    .eq("receipt_no", Number(v.receipt_no));
  if (count) {
    return { ok: false, error: "Receipt number already used.", fieldErrors: { receipt_no: "This receipt no. was already used in the old software" } };
  }

  const { data, error } = await supabase.rpc("record_payment", {
    p: {
      source: v.source,
      ref_id: v.refId,
      idempotency_key: v.idempotencyKey,
      paid_amount: v.paid_amount,
      paid_date: v.paid_date,
      payment_mode: v.payment_mode,
      receipt_no: v.receipt_no,
      reference_no: v.reference_no,
      bank_name: v.payment_mode === "BANK" ? v.bank_name : "",
      installments_covered: v.installments_covered,
      ...(v.payment_mode === "SPLIT"
        ? {
            parts: v.parts!.map((p) => ({
              mode: p.mode,
              amount: p.amount,
              bank_name: p.mode === "BANK" ? p.bank_name : "",
              reference_no: p.mode === "CASH" ? "" : p.reference_no,
            })),
          }
        : {}),
    },
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Receipt number already used.", fieldErrors: { receipt_no: "This receipt no. is already used" } };
    if (error.code === "P0002") return { ok: false, error: "This account is no longer pending." };
    if (error.code === "42501") return { ok: false, error: "Your login is not allowed to take payments." };
    if (error.code === "22023") return { ok: false, error: error.message };
    console.error("record_payment failed:", error);
    return { ok: false, error: "Could not save. Check your internet and press Save again." };
  }
  const r = data as { receipt_no: number; installment_no: number; review: string | null; pending: boolean };
  const ledger = await getLedger(supabase, v.source, v.refId).catch(() => null);
  return { ok: true, receiptNo: r.receipt_no, installmentNo: r.installment_no, ledger, review: r.review ?? null, pending: !!r.pending };
}

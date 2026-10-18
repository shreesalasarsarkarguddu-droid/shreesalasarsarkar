"use server";

// Cash closing, approvals and receipt books. The database checks each permission again.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CtlResult = { ok: true; message: string } | { ok: false; error: string };

function fail(e: { code?: string; message: string }, fallback: string): CtlResult {
  if (e.code === "42501") return { ok: false, error: "Your login is not allowed to do this." };
  if (e.code === "22023" || e.code === "P0002") return { ok: false, error: e.message.charAt(0).toUpperCase() + e.message.slice(1) + "." };
  console.error(fallback, e);
  return { ok: false, error: `${fallback} Check your internet and try again.` };
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/);

export async function receiveCash(userId: string, d: string, amount: string, note: string): Promise<CtlResult> {
  if (!z.uuid().safeParse(userId).success || !day.safeParse(d).success) return { ok: false, error: "Invalid request. Reload the page." };
  if (!money.safeParse(amount).success) return { ok: false, error: "Enter the cash received (numbers only)." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cash_receive", { p_user: userId, p_day: d, p_amount: amount, p_note: note.slice(0, 300) });
  if (error) return fail(error, "Could not save.");
  revalidatePath("/cash");
  const short = Number((data as { short: number }).short);
  return {
    ok: true,
    message: short > 0 ? `Saved. SHORT by ₹${short.toLocaleString("en-IN")}.` : short < 0 ? `Saved. ₹${(-short).toLocaleString("en-IN")} extra.` : "Saved. Cash matches.",
  };
}

export async function reviewPayment(id: number, approve: boolean, note: string): Promise<CtlResult> {
  if (!approve && note.trim().length < 3) return { ok: false, error: "Write why you reject it (at least 3 letters)." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_payment", { p_id: id, p_approve: approve, p_note: note.slice(0, 300) });
  if (error) return fail(error, "Could not save.");
  revalidatePath("/approvals");
  revalidatePath("/accounts");
  return { ok: true, message: approve ? "Approved." : "Rejected — the payment was cancelled and the balance put back." };
}

const book = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    user_id: z.uuid({ error: "Choose the person" }),
    from_no: z.string().trim().regex(/^\d{1,12}$/, { error: "Enter the first receipt no." }),
    to_no: z.string().trim().regex(/^\d{1,12}$/, { error: "Enter the last receipt no." }),
    note: z.string().max(200),
  }),
  z.object({ action: z.enum(["close", "reopen", "delete"]), id: z.number().int().positive() }),
]);
export type BookInput = z.input<typeof book>;

export async function receiptBook(input: BookInput): Promise<CtlResult> {
  const parsed = book.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const p = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_receipt_book", {
    p: p.action === "add" ? { ...p, from_no: Number(p.from_no), to_no: Number(p.to_no) } : p,
  });
  if (error) return fail(error, "Could not save.");
  revalidatePath("/receipt-books");
  return { ok: true, message: { add: "Receipt book given.", close: "Book closed.", reopen: "Book reopened.", delete: "Book deleted." }[p.action] };
}

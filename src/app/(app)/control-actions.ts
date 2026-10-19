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

export async function reviewPending(ids: number[], approve: boolean, note: string): Promise<CtlResult> {
  const parsed = z.array(z.number().int().positive()).min(1, { error: "Tick at least one payment." }).max(1000).safeParse(ids);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!approve && note.trim().length < 3) return { ok: false, error: "Write why you reject (at least 3 letters)." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_pending", { p_ids: parsed.data, p_approve: approve, p_note: note.slice(0, 300) });
  if (error) return fail(error, "Could not save.");
  revalidatePath("/approvals");
  revalidatePath("/cash");
  revalidatePath("/my-collections");
  revalidatePath("/accounts");
  const d = data as { done: number; amount: number; failed: { receipt_no: number; reason: string }[] };
  const money = `₹${Number(d.amount).toLocaleString("en-IN")}`;
  const failed = d.failed.length
    ? ` ${d.failed.length} could not be approved: ${d.failed.map((f) => `Rcpt ${f.receipt_no} (${f.reason})`).join("; ")}.`
    : "";
  return d.failed.length && d.done === 0
    ? { ok: false, error: `Nothing approved.${failed}` }
    : { ok: true, message: `${approve ? "Approved" : "Rejected"} ${d.done} · ${money}.${failed}` };
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

const item = z.object({ source: z.enum(["old", "new"]), ref_id: z.number().int().positive() });

export async function assignAccounts(d: string, userId: string, items: { source: "old" | "new"; ref_id: number }[], note: string): Promise<CtlResult> {
  if (!day.safeParse(d).success) return { ok: false, error: "Choose the day." };
  if (!z.uuid().safeParse(userId).success) return { ok: false, error: "Choose the collection man." };
  const parsed = z.array(item).min(1, { error: "Tick at least one account." }).max(500).safeParse(items);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_collections", { p_day: d, p_user: userId, p_items: parsed.data, p_note: note.slice(0, 200) });
  if (error) return fail(error, "Could not assign.");
  revalidatePath("/assign");
  revalidatePath("/my-collections");
  const r = data as { assigned: number; moved: number };
  return { ok: true, message: `${r.assigned} account(s) assigned${r.moved ? ` (${r.moved} moved from someone else)` : ""}.` };
}

export async function unassignAccounts(ids: number[]): Promise<CtlResult> {
  const parsed = z.array(z.number().int().positive()).min(1).max(1000).safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Nothing chosen." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unassign_collections", { p_ids: parsed.data });
  if (error) return fail(error, "Could not remove.");
  revalidatePath("/assign");
  revalidatePath("/my-collections");
  return { ok: true, message: `${data} removed from the list.` };
}

const book = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    user_id: z.uuid({ error: "Choose the person" }),
    from_no: z.string().trim().regex(/^\d{1,12}$/, { error: "Enter the first receipt no." }),
    to_no: z.string().trim().regex(/^\d{1,12}$/, { error: "Enter the last receipt no." }),
    note: z.string().max(200),
    series_id: z.number().int().positive().optional(),
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

// ---------------------------------------------------------------- zones and their receipt books (admin)
const startNo = z.string().trim().regex(/^\d{1,12}$/, { error: "Enter the first receipt no. of the book" }).refine((v) => Number(v) > 0, { error: "Enter the first receipt no. of the book" });
const zoneName = z.string().trim().min(1, { error: "Enter the zone name" }).max(60, { error: "Name is too long" });
const zone = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), name: zoneName, receipt_start: startNo }),
  z.object({ action: z.literal("rename"), id: z.number().int().positive(), name: zoneName }),
  z.object({ action: z.literal("new_book"), id: z.number().int().positive(), receipt_start: startNo }),
  z.object({ action: z.enum(["hide", "show", "delete"]), id: z.number().int().positive() }),
]);
export type ZoneInput = z.input<typeof zone>;

export async function saveZone(input: ZoneInput): Promise<CtlResult> {
  const parsed = zone.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const p = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_zone", { p: "receipt_start" in p ? { ...p, receipt_start: Number(p.receipt_start) } : p });
  if (error) return fail(error, "Could not save.");
  revalidatePath("/zones");
  revalidatePath("/receipt-books");
  const done = { add: "Zone added.", rename: "Zone renamed.", new_book: "New receipt book opened.", hide: "Zone hidden.", show: "Zone shown again.", delete: "Zone deleted." };
  return { ok: true, message: done[p.action] };
}

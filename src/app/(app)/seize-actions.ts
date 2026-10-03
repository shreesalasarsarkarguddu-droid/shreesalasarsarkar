"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/schedule";

const schema = z
  .object({
    source: z.enum(["old", "new"]),
    refId: z.number().int().positive(),
    seize: z.boolean(),
    actionDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Enter the date" })
      .refine((v) => v <= todayIST(), { error: "Date cannot be in the future" }),
    remarks: z.string().trim().max(300, { error: "Keep remarks under 300 letters" }),
    idempotencyKey: z.uuid(),
  })
  .refine((v) => v.seize || v.remarks !== "", { error: "Enter the reason for releasing", path: ["remarks"] });

export type SeizeInput = z.input<typeof schema>;
export type SeizeResult = { ok: true } | { ok: false; error: string; field?: "actionDate" | "remarks" };

/** Seize a vehicle or release it back to normal. Recorded permanently (who / when / why). */
export async function setSeized(input: SeizeInput): Promise<SeizeResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: issue.path[0] as "actionDate" | "remarks" };
  }
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_seized", {
    p: { source: v.source, ref_id: v.refId, seize: v.seize, action_date: v.actionDate, remarks: v.remarks, idempotency_key: v.idempotencyKey },
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "Your login is not allowed to do this." };
    if (error.code === "22023" || error.code === "P0002") return { ok: false, error: error.message.charAt(0).toUpperCase() + error.message.slice(1) + "." };
    console.error("set_seized failed:", error);
    return { ok: false, error: "Could not save. Check your internet and try again." };
  }
  return { ok: true };
}

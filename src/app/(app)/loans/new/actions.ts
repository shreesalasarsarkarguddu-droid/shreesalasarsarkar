"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loanSchema, type LoanFields } from "@/lib/loan";

export type CreateLoanResult =
  | { ok: true; id: number }
  | { ok: false; error: string; fieldErrors?: Partial<Record<LoanFields, string>> };

const UUID = z.uuid();

export async function createLoan(idempotencyKey: string, values: Record<string, string>): Promise<CreateLoanResult> {
  if (!UUID.safeParse(idempotencyKey).success) return { ok: false, error: "Invalid request. Reload the page and try again." };

  // Never trust the browser: validate everything again on the server.
  const parsed = loanSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<LoanFields, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as LoanFields;
      fieldErrors[key] ??= issue.message;
    }
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_loan", {
    p: { ...parsed.data, idempotency_key: idempotencyKey },
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "This folio number is already used.", fieldErrors: { folio_no: "This folio number is already used" } };
    }
    if (error.code === "42501") return { ok: false, error: "Your login is not allowed to create loans." };
    console.error("create_loan failed:", error);
    return { ok: false, error: "Could not save the loan. Check your internet connection and try again." };
  }
  return { ok: true, id: Number(data) };
}

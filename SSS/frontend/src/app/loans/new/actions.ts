import { z } from "zod";
import { act } from "@/lib/api";
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

  return act<CreateLoanResult>("POST", "/loans", { idempotencyKey, values });
}

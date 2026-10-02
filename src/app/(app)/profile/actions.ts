"use server";

import { createClient } from "@/lib/supabase/server";

export type PasswordState = { error: string | null; ok: boolean };

export async function changePassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!current || !next) return { error: "Fill in all fields.", ok: false };
  if (next.length < 8) return { error: "New password must be at least 8 characters.", ok: false };
  if (next !== confirm) return { error: "New passwords do not match.", ok: false };
  if (next === current) return { error: "New password must be different from the current one.", ok: false };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email as string | undefined;
  if (!email) return { error: "Your session has expired. Sign in again.", ok: false };

  // Confirm the current password before changing it.
  const { error: checkError } = await supabase.auth.signInWithPassword({ email, password: current });
  if (checkError) return { error: "Current password is incorrect.", ok: false };

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    console.error("password change failed:", error.message);
    return {
      error: error.code === "weak_password" ? "That password is too weak. Try a longer one." : "Could not change password. Try again.",
      ok: false,
    };
  }
  return { error: null, ok: true };
}

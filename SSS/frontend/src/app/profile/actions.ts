import { act } from "@/lib/api";

export type PasswordState = { error: string | null; ok: boolean };

export async function changePassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!current || !next) return { error: "Fill in all fields.", ok: false };
  if (next.length < 8) return { error: "New password must be at least 8 characters.", ok: false };
  if (next !== confirm) return { error: "New passwords do not match.", ok: false };
  if (next === current) return { error: "New password must be different from the current one.", ok: false };

  // the server checks the current password before changing it
  const r = await act<{ ok: boolean; error?: string }>("POST", "/password", { current, next });
  return r.ok ? { error: null, ok: true } : { error: r.error ?? "Could not change password. Try again.", ok: false };
}

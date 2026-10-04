"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: boolean; message: string };

// Admin-only: the database functions refuse anyone else (is_admin()).
export async function saveSettings(values: Record<string, unknown>): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_notification_settings", { p: values });
  if (error) {
    console.error("save settings failed:", error.message);
    return { ok: false, message: error.code === "42501" ? "Only an admin can change settings." : "Could not save. Check the values and try again." };
  }
  revalidatePath("/settings");
  return { ok: true, message: "Settings saved." };
}

/** Sends a test message and waits a few seconds for the delivery result. */
export async function sendTest(channel: "telegram" | "whatsapp" | "summary", mobile?: string): Promise<Result> {
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("send_test_notification", { p_channel: channel, p_mobile: mobile ?? null });
  if (error) return { ok: false, message: error.code === "22023" ? capital(error.message) + "." : "Could not send the test." };

  // pg_net sends in the background; poll for up to ~8 s
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const { data } = await supabase.rpc("notification_result", { p_id: id });
    const r = data as { status: string; detail: string | null } | null;
    if (r?.status === "sent") {
      revalidatePath("/settings");
      return { ok: true, message: "Sent ✓ — check " + (channel === "whatsapp" ? "the phone." : "the Telegram group.") };
    }
    if (r?.status === "failed") {
      revalidatePath("/settings");
      return { ok: false, message: "Failed: " + explain(r.detail) };
    }
  }
  revalidatePath("/settings");
  return { ok: false, message: "No reply yet. Look at the log below in a minute." };
}

function capital(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function explain(detail: string | null) {
  const d = detail ?? "";
  if (/Unauthorized|401/.test(d)) return "wrong bot token.";
  if (/chat not found/i.test(d)) return "group not found — add the bot to the group and check the group id.";
  if (/kicked|not a member/i.test(d)) return "the bot is not in the group.";
  if (/resolve host|Could not resolve|Couldn't resolve/i.test(d)) return "gateway host not reachable — check the host.";
  return d.slice(0, 200) || "unknown error.";
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStaff } from "@/lib/staff";
import { backupStamp, buildBackupZip, encryptBackup } from "@/lib/backup-zip";

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

/**
 * "Backup now" (admin): the backup zip, encrypted like the nightly one, sent to the Telegram chat of the nightly backup.
 * Needs BACKUP_PASSWORD, BACKUP_TELEGRAM_TOKEN and BACKUP_TELEGRAM_CHAT_ID in the site's environment (Vercel), the same
 * values as the GitHub backup's secrets.
 */
export async function backupNow(): Promise<Result> {
  const staff = await getStaff();
  if (staff?.role !== "admin") return { ok: false, message: "Only an admin can do this." };
  const pass = process.env.BACKUP_PASSWORD ?? "";
  const token = process.env.BACKUP_TELEGRAM_TOKEN ?? "";
  const chat = process.env.BACKUP_TELEGRAM_CHAT_ID ?? "";
  if (!pass || !token || !chat) {
    return { ok: false, message: "Not set up: add BACKUP_PASSWORD, BACKUP_TELEGRAM_TOKEN and BACKUP_TELEGRAM_CHAT_ID in Vercel → Settings → Environment Variables." };
  }
  let file: Buffer;
  try {
    file = encryptBackup(await buildBackupZip(await createClient()), pass);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not make the backup." };
  }
  const name = `salasar-backup-${backupStamp()}.zip.enc`;
  const form = new FormData();
  form.append("chat_id", chat);
  form.append("caption", `Encrypted backup ${name} (Backup now, by ${staff.full_name}). Open it on Settings → Data → Restore from a backup file, with the backup password.`);
  form.append("document", new Blob([new Uint8Array(file)]), name);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!res.ok || !j?.ok) return { ok: false, message: `Backup made, but Telegram refused it: ${explain(j?.description ?? String(res.status))}` };
  } catch {
    return { ok: false, message: "Backup made, but Telegram could not be reached. Try again." };
  }
  return { ok: true, message: `Backup sent to Telegram ✓ (${name}, ${Math.round(file.length / 1024)} KB)` };
}

import "server-only";
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zipSync, strToU8 } from "fflate";

// Tables in the backup zip (app_settings is left out on purpose: it holds the bot / gateway keys).
const TABLES = [
  "legacy_accounts", "legacy_payments", "borrowers", "loans", "payments", "seizures", "adjustments",
  "receipt_books", "cash_closings", "collection_assignments", "pending_payments", "staff", "import_batches", "zones", "receipt_series", "visit_remarks",
] as const;
const PAGE = 1000;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
}

/** Every table as CSV (Excel-readable), zipped; the same file as Settings → Download backup. Throws when a table cannot be read. */
export async function buildBackupZip(supabase: SupabaseClient): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const summary: string[] = [];
  for (const t of TABLES) {
    const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
    if (error) throw new Error(`Could not read ${t}.`);
    const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
    const chunks = await Promise.all(
      Array.from({ length: pages }, (_, i) =>
        supabase.from(t).select("*").order(t === "staff" ? "user_id" : "id").range(i * PAGE, i * PAGE + PAGE - 1),
      ),
    );
    const rows: Record<string, unknown>[] = [];
    for (const c of chunks) {
      if (c.error) throw new Error(`Could not read ${t}.`);
      rows.push(...((c.data ?? []) as Record<string, unknown>[]));
    }
    files[`${t}.csv`] = strToU8("﻿" + toCsv(rows)); // BOM so Excel reads names correctly
    summary.push(`${t}: ${rows.length} rows`);
  }
  files["README.txt"] = strToU8(`Backup taken ${new Date().toISOString()}\r\n\r\n${summary.join("\r\n")}\r\n`);
  return zipSync(files, { level: 6 });
}

/** Same format as "openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt" (the nightly backup; Data page opens it with the password). */
export function encryptBackup(data: Uint8Array, password: string): Buffer {
  const salt = randomBytes(8);
  const kiv = pbkdf2Sync(password, salt, 200000, 48, "sha256");
  const c = createCipheriv("aes-256-cbc", kiv.subarray(0, 32), kiv.subarray(32, 48));
  return Buffer.concat([Buffer.from("Salted__"), salt, c.update(data), c.final()]);
}

export const backupStamp = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

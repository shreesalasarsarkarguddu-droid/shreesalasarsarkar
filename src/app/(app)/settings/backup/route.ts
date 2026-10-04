import { zipSync, strToU8 } from "fflate";
import { createClient } from "@/lib/supabase/server";
import { getStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Tables included in the manual backup (app_settings is left out on purpose: it holds the bot / gateway keys).
const TABLES = ["legacy_accounts", "legacy_payments", "borrowers", "loans", "payments", "seizures", "staff", "import_batches"] as const;
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

/** Admin-only: every table as CSV, zipped. */
export async function GET() {
  const staff = await getStaff();
  if (staff?.role !== "admin") return new Response("Only an admin can download backups.", { status: 403 });

  const supabase = await createClient();
  const files: Record<string, Uint8Array> = {};
  const summary: string[] = [];

  for (const t of TABLES) {
    const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
    if (error) return new Response(`Could not read ${t}.`, { status: 500 });
    const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
    const chunks = await Promise.all(
      Array.from({ length: pages }, (_, i) =>
        supabase.from(t).select("*").order(t === "staff" ? "user_id" : "id").range(i * PAGE, i * PAGE + PAGE - 1),
      ),
    );
    const rows: Record<string, unknown>[] = [];
    for (const c of chunks) {
      if (c.error) return new Response(`Could not read ${t}.`, { status: 500 });
      rows.push(...((c.data ?? []) as Record<string, unknown>[]));
    }
    files[`${t}.csv`] = strToU8("﻿" + toCsv(rows)); // BOM so Excel reads names correctly
    summary.push(`${t}: ${rows.length} rows`);
  }
  files["README.txt"] = strToU8(`Backup taken ${new Date().toISOString()}\r\n\r\n${summary.join("\r\n")}\r\n`);

  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Response(Buffer.from(zipSync(files, { level: 6 })), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="salasar-backup-${stamp}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

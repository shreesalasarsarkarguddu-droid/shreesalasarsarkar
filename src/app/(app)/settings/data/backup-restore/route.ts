import { gunzipSync, strFromU8 } from "fflate";
import { createClient } from "@/lib/supabase/server";
import { getStaff } from "@/lib/staff";
import { parseCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CHUNK = 1000;
const TABLES = new Set([
  "import_batches", "legacy_accounts", "legacy_payments", "borrowers", "loans", "payments", "seizures", "adjustments",
  "receipt_books", "cash_closings",
]);
const fail = (message: string, status = 400) => Response.json({ ok: false, message }, { status });

// Admin-only. The page unzips (and decrypts) the backup in the browser and sends it here one table at a time:
//   action=begin  (file, taken)          -> job id
//   action=stage  (job, table, csv.gz)   -> rows staged
//   action=preview (job)                 -> what would change
// Nothing is changed until the page confirms with the admin's password (server action restoreFromFile).
export async function POST(req: Request) {
  const staff = await getStaff();
  if (staff?.role !== "admin") return fail("Only an admin can restore.", 403);
  const form = await req.formData();
  const action = String(form.get("action") ?? "");
  const supabase = await createClient();

  if (action === "begin") {
    const { data, error } = await supabase.rpc("admin_backup_begin", { p_file: String(form.get("file") ?? ""), p_taken: String(form.get("taken") ?? "") });
    if (error) return fail("Could not start.", 500);
    return Response.json({ ok: true, job: data });
  }

  const job = String(form.get("job") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(job)) return fail("Invalid request.");

  if (action === "stage") {
    const table = String(form.get("table") ?? "");
    if (!TABLES.has(table)) return fail(`"${table}" is not a data table.`);
    const f = form.get("csv");
    if (!(f instanceof File)) return fail("No data was sent.");
    let rows: Record<string, string>[];
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const text = strFromU8(bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes);
      rows = parseCsv(text);
    } catch (e) {
      return fail(`${table}.csv could not be read: ${e instanceof Error ? e.message : "damaged file"}`);
    }
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase.rpc("admin_backup_stage", { p_job: job, p_tbl: table, p_rows: rows.slice(i, i + CHUNK) });
      if (error) {
        console.error("backup stage failed:", error.message);
        return fail(error.code === "22023" ? error.message : "Could not upload the rows. Nothing was changed. Try again.", 500);
      }
    }
    return Response.json({ ok: true, rows: rows.length });
  }

  if (action === "preview") {
    const { data, error } = await supabase.rpc("admin_backup_preview", { p_job: job });
    if (error) {
      console.error("backup preview failed:", error.message);
      return fail(error.code === "22023" ? error.message : "Could not compare the backup with the data.", 500);
    }
    return Response.json({ ok: true, preview: data });
  }
  return fail("Unknown action.");
}

import { gunzipSync } from "fflate";
import { createClient } from "@/lib/supabase/server";
import { getStaff } from "@/lib/staff";
import { ImportError, parseAll, type FileKey, type Files } from "@/lib/legacy/parse";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CHUNK = 2000;

/** Which of the 4 files is this? Decided by the old software's file names (P_ACCOUNT, P_INSMENT, F_ACC(OUNT), F_INSMENT). */
function keyOf(name: string): FileKey | null {
  const m = /^\s*([PF])[\s_-]*(ACC|INS)/i.exec(name);
  if (!m) return null;
  const pf = m[1].toUpperCase();
  const acc = m[2].toUpperCase() === "ACC";
  return pf === "P" ? (acc ? "P_ACCOUNT" : "P_INSMENT") : acc ? "F_ACC" : "F_INSMENT";
}

const fail = (message: string, status = 400) => Response.json({ ok: false, message }, { status });

// Admin-only: read the 4 files, stage the rows in the database and return the preview. Nothing is imported here.
export async function POST(req: Request) {
  const staff = await getStaff();
  if (staff?.role !== "admin") return fail("Only an admin can import.", 403);

  const form = await req.formData();
  const files = {} as Files;
  for (const f of form.getAll("files")) {
    if (!(f instanceof File)) continue;
    const key = keyOf(f.name);
    if (!key) return fail(`"${f.name}" is not one of P_ACCOUNT, P_INSMENT, F_ACCOUNT, F_INSMENT.`);
    if (files[key]) return fail(`Two files look like ${key}: "${files[key].name}" and "${f.name}".`);
    let bytes = new Uint8Array(await f.arrayBuffer());
    // the page gzips the files (the hosting refuses uploads over 4.5 MB; the table files are ~7 MB together)
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      try {
        bytes = gunzipSync(bytes);
      } catch {
        return fail(`"${f.name}" did not arrive complete. Try again.`);
      }
    }
    if (bytes.length > 40 * 1024 * 1024) return fail(`"${f.name}" is too large.`);
    files[key] = { name: f.name, bytes };
  }
  const missing = (["P_ACCOUNT", "P_INSMENT", "F_ACC", "F_INSMENT"] as const).filter((k) => !files[k]);
  if (missing.length) return fail(`Choose all 4 files. Missing: ${missing.join(", ")}.`);

  let parsed;
  try {
    parsed = parseAll(files);
  } catch (e) {
    if (e instanceof ImportError) return fail(e.message);
    console.error("import parse failed:", e);
    return fail("These files could not be read. Are they the exports from the old software?");
  }

  const supabase = await createClient();
  const { data: job, error } = await supabase.rpc("admin_import_begin", { p_batches: parsed.batches, p_checks: parsed.checks });
  if (error) return fail("Could not start the import.", 500);
  for (const [kind, rows] of [["acc", parsed.accounts], ["pay", parsed.payments]] as const) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error: e } = await supabase.rpc("admin_import_stage", { p_job: job, p_kind: kind, p_rows: rows.slice(i, i + CHUNK) });
      if (e) {
        console.error("import stage failed:", e.message);
        return fail("Could not upload the rows. Nothing was imported. Try again.", 500);
      }
    }
  }
  const { data: preview, error: pe } = await supabase.rpc("admin_import_preview", { p_job: job });
  if (pe) {
    console.error("import preview failed:", pe.message);
    return fail("Could not compare the files with the data. Nothing was imported.", 500);
  }
  return Response.json({ ok: true, job, preview });
}

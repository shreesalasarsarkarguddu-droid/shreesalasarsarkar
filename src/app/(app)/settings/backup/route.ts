import { createClient } from "@/lib/supabase/server";
import { getStaff } from "@/lib/staff";
import { can } from "@/lib/permissions";
import { backupStamp, buildBackupZip } from "@/lib/backup-zip";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Admin-only: every table as CSV, zipped. */
export async function GET() {
  const staff = await getStaff();
  if (!can(staff, "backup")) return new Response("Your login is not allowed to download backups.", { status: 403 });

  let zip: Uint8Array;
  try {
    zip = await buildBackupZip(await createClient());
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Could not make the backup.", { status: 500 });
  }
  const stamp = backupStamp();
  return new Response(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="salasar-backup-${stamp}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

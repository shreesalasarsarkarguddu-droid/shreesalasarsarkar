import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { DataManager, type Overview } from "./data-manager";

export const metadata: Metadata = { title: "Data · Shree Salasar Sarkar" };
// restore / delete can take ~30 s on the free database; let the server action run that long
export const maxDuration = 120;

export default async function DataPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_data_overview");
  if (error) throw new Error("Could not load data overview.");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href="/settings" className="text-sm font-medium text-blue-700">
          ← Settings
        </Link>
        <h1 className="text-xl font-bold">Data</h1>
        <p className="text-sm text-slate-500">
          Backups, restore points and deleting data. Before every delete or restore, a restore point is saved automatically, so it
          can be undone.
        </p>
      </div>
      <DataManager o={data as Overview} />
    </div>
  );
}

import type { Metadata } from "next";
import { requireAdmin } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { NewZone, ZoneRow, type Zone } from "./zone-forms";

export const metadata: Metadata = { title: "Zones · Shree Salasar Sarkar" };

export default async function ZonesPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("zone_status");
  if (error) {
    console.error("zone_status failed:", error);
    throw new Error("Could not load zones.");
  }
  const zones = (data ?? []) as Zone[];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Zones</h1>
        <p className="text-sm text-slate-500">
          Each zone has its own receipt numbers. A zone&apos;s receipts start at its number and go up to just before the next
          zone&apos;s start. When you collect from an account in a zone, the next free number of that zone is suggested.
        </p>
      </div>

      <NewZone />

      {zones.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">No zones yet.</p>
      ) : (
        <ul className="space-y-3">
          {zones.map((z) => (
            <ZoneRow key={z.id} z={z} />
          ))}
        </ul>
      )}
    </div>
  );
}

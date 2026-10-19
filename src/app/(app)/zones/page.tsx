import type { Metadata } from "next";
import { requireAdmin } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { MainBookRow, NewZone, ZoneRow, type MainBook, type Zone } from "./zone-forms";

export const metadata: Metadata = { title: "Zones · Shree Salasar Sarkar" };

export default async function ZonesPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data, error }, { data: main }] = await Promise.all([supabase.rpc("zone_status"), supabase.rpc("main_book_status")]);
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
          Each zone has its own receipt book. A receipt no. only has to be unique inside its book, so two zones can use the same
          numbers. When a new printed book starts, press <b>Open new receipt book</b>: the old book closes (its receipts stay as they
          are) and the new one starts from the number you give. Accounts with no zone use the DHAMTARI (main) book.
        </p>
      </div>

      {main && <MainBookRow m={main as MainBook} />}

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

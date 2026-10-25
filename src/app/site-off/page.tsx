import type { Metadata } from "next";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Site closed · Shree Salasar Sarkar", robots: { index: false } };
export const dynamic = "force-dynamic";

/** What everyone sees while the power admin has switched the site off (the proxy shows it for every page). */
export default async function SiteOffPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("site_status");
  const message = (data as { message?: string | null } | null)?.message ?? "The site is closed for some time. Please come back later.";
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-7 text-center shadow-sm ring-1 ring-slate-200">
        <Image src="/icons/icon-192.png" alt="" width={64} height={64} className="mx-auto h-16 w-16 rounded-xl" priority />
        <h1 className="mt-4 text-xl font-bold text-slate-900">Site is closed right now</h1>
        <p className="mt-2 whitespace-pre-line text-slate-600">{message}</p>
      </div>
    </main>
  );
}

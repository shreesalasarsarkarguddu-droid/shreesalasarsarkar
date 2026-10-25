import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { dateTimeIST } from "@/lib/format";
import { powerSignOut, powerToggle } from "./actions";
import { PowerLogin } from "./power-login";

export const metadata: Metadata = { title: "Site power · Shree Salasar Sarkar", robots: { index: false } };
export const dynamic = "force-dynamic";

type Status = { off: boolean; message: string | null; changed_at: string | null; power: boolean };

/** The whole site on / off: the power admin only (works while the site is off). */
export default async function PowerPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("site_status");
  const s = (data ?? { off: false, message: null, changed_at: null, power: false }) as Status;
  const { data: claims } = await supabase.auth.getClaims();
  const email = (claims?.claims?.email as string | undefined) ?? "";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold text-slate-900">Site power</h1>
        {!s.power ? (
          <>
            <p className="mt-1 mb-4 text-sm text-slate-500">Only the power admin can sign in here.</p>
            <PowerLogin />
          </>
        ) : (
          <>
            <p className="mt-1 mb-4 text-sm text-slate-500">
              Signed in as {email} (power admin). This switch is for the whole site: every page and all the data.
            </p>
            <div className={`flex items-center gap-2 rounded-xl px-4 py-3 font-bold ${s.off ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
              <span className={`h-3 w-3 rounded-full ${s.off ? "bg-red-500" : "bg-emerald-500"}`} />
              {s.off ? "Site is OFF — nobody can open it (admins too)" : "Site is ON — working normally"}
            </div>
            {s.changed_at && <p className="mt-2 text-xs text-slate-500">Last changed {dateTimeIST(s.changed_at)}</p>}
            <form action={powerToggle} className="mt-4 space-y-3">
              {s.off ? (
                <>
                  <input type="hidden" name="off" value="0" />
                  <button className="h-12 w-full rounded-xl bg-emerald-700 font-bold text-white hover:bg-emerald-800">Turn the site ON</button>
                </>
              ) : (
                <>
                  <input type="hidden" name="off" value="1" />
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">Message for everyone (optional)</span>
                    <textarea
                      name="message"
                      rows={3}
                      maxLength={500}
                      placeholder="The site is closed for some time. Please come back later."
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <button className="h-12 w-full rounded-xl bg-red-700 font-bold text-white hover:bg-red-800">Turn the site OFF</button>
                </>
              )}
            </form>
            <form action={powerSignOut}>
              <button className="mt-3 h-10 w-full rounded-lg text-sm text-slate-600 hover:bg-slate-100">Sign out</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

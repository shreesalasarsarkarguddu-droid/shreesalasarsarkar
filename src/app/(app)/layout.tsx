import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");

  const { data: staff } = await supabase.from("staff").select("full_name").maybeSingle();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/accounts" className="text-base font-bold text-slate-900">
            Shree Salasar Sarkar
          </Link>
          <div className="flex items-center gap-3">
            {staff && <span className="hidden text-sm text-slate-500 sm:inline">{staff.full_name}</span>}
            <form action={signOut}>
              <button className="h-10 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-4">
        {staff ? (
          children
        ) : (
          <div className="mt-10 rounded-xl bg-white p-6 text-center ring-1 ring-slate-200">
            <p className="font-semibold">Your login does not have access yet.</p>
            <p className="mt-1 text-sm text-slate-500">Ask the admin to add you as staff.</p>
          </div>
        )}
      </main>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { BottomNav, TopNav } from "./nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");

  const { data: staff } = await supabase.from("staff").select("full_name").maybeSingle();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur print:hidden">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <Link href="/accounts" className="text-base font-bold text-slate-900">
              Shree Salasar Sarkar
            </Link>
            {staff && <TopNav />}
          </div>
          <div className="hidden items-center gap-3 md:flex">
            {staff && <span className="text-sm text-slate-500">{staff.full_name}</span>}
            <form action={signOut}>
              <button className="h-10 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-4 md:pb-16 print:max-w-none print:p-0">
        {staff ? (
          children
        ) : (
          <div className="mt-10 rounded-xl bg-white p-6 text-center ring-1 ring-slate-200">
            <p className="font-semibold">Your login does not have access yet.</p>
            <p className="mt-1 text-sm text-slate-500">Ask the admin to add you as staff.</p>
            <form action={signOut} className="mt-4">
              <button className="h-11 rounded-lg px-4 text-sm font-medium text-blue-700 ring-1 ring-slate-300">
                Sign out
              </button>
            </form>
          </div>
        )}
      </main>
      {staff && <BottomNav />}
    </div>
  );
}

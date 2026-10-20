import { Suspense } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "@/lib/auth";
import { BottomNav, TopNav } from "./nav";
import { InstallBanner } from "./install-banner";
import Loading from "./loading";

/** The signed-in shell: top bar, page, phone bottom bar (src/app/(app)/layout.tsx of the old app). */
export default function AppLayout() {
  const { staff, loading, signOut } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoading />;
  if (!staff) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur print:hidden">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between gap-4 px-4 lg:px-6">
          <div className="flex items-center gap-6">
            <Link to="/accounts" className="text-base font-bold text-slate-900">
              Shree Salasar Sarkar
            </Link>
            <TopNav access={staff} />
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <span className="text-sm text-slate-500">{staff.full_name}</span>
            <button onClick={() => void signOut()} className="h-10 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-screen-2xl px-4 pb-28 pt-4 md:pb-16 lg:px-6 print:max-w-none print:p-0">
        <InstallBanner />
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav access={staff} />
    </div>
  );
}

function FullPageLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center" aria-busy="true" aria-label="Loading">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-700" />
    </div>
  );
}

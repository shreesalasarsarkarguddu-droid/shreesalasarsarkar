import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useStaff } from "@/lib/auth";
import { can, homeFor, type Permission } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import Loading from "@/app/loading";

/** Page guard: people without this permission go to the first page they can use (requirePerm of the old app). */
export function RequirePerm({ perm, any, admin, children }: { perm?: Permission; any?: Permission[]; admin?: boolean; children: ReactNode }) {
  const staff = useStaff();
  if ((admin && staff.role !== "admin") || (perm && !can(staff, perm)) || (any && !any.some((p) => can(staff, p)))) {
    return <Navigate to={homeFor(staff)} replace />;
  }
  return <>{children}</>;
}

/** Loading skeleton / error box / not found for a page's data. */
export function PageData<T>({ q, children }: { q: { data: T | undefined; error: unknown; isPending: boolean; refetch: () => unknown }; children: (d: T) => ReactNode }) {
  if (q.isPending) return <Loading />;
  if (q.error) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="mx-auto mt-6 max-w-md rounded-xl bg-white p-6 text-center ring-1 ring-slate-200">
        <p className="font-semibold">{notFound ? "Not found" : (q.error as Error).message || "Something went wrong."}</p>
        {!notFound && (
          <button onClick={() => q.refetch()} className="mt-4 h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white">
            Try again
          </button>
        )}
      </div>
    );
  }
  return <>{children(q.data as T)}</>;
}

/** Pages not built yet in the new app (filled in by the later phases). */
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="mx-auto mt-6 max-w-md rounded-xl bg-white p-6 text-center ring-1 ring-slate-200">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-slate-500">This page is being moved to the new system and will be here soon.</p>
    </div>
  );
}

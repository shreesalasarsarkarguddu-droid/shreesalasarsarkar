import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, homeFor, type Permission } from "@/lib/permissions";

export type Staff = { full_name: string; role: "admin" | "staff"; permissions: string[] };

/** The signed-in, active staff member (or null). Cached per request, so layout + page share one query. */
export const getStaff = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("staff").select("full_name, role, active, permissions").maybeSingle();
  if (!data || !data.active) return null;
  return { full_name: data.full_name, role: data.role, permissions: data.permissions ?? [] } as Staff;
});

/** Route guard: send people without this permission to the first page they can use. */
export async function requirePerm(p: Permission) {
  const staff = await getStaff();
  if (!staff) notFound(); // layout already shows "no access"
  if (!can(staff, p)) redirect(homeFor(staff));
  return staff;
}

export async function requireAdmin() {
  const staff = await getStaff();
  if (!staff) notFound();
  if (staff.role !== "admin") redirect(homeFor(staff));
  return staff;
}

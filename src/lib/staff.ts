import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, homeFor, type Permission } from "@/lib/permissions";

export type Staff = { full_name: string; role: "admin" | "staff"; permissions: string[]; power: boolean };

/** The signed-in, active staff member (or null). Cached per request, so layout + page share one query. */
export const getStaff = cache(async () => {
  const supabase = await createClient();
  const [{ data }, { data: claims }] = await Promise.all([
    supabase.from("staff").select("full_name, role, active, permissions, force_logout_at, is_poweradmin").maybeSingle(),
    supabase.auth.getClaims(),
  ]);
  if (!data || !data.active) return null;
  // signed out by the admin after this login was issued (the database refuses it too)
  const iat = Number(claims?.claims?.iat ?? 0);
  if (data.force_logout_at && iat < Math.floor(Date.parse(data.force_logout_at) / 1000)) return null;
  return { full_name: data.full_name, role: data.role, permissions: data.permissions ?? [], power: !!data.is_poweradmin } as Staff;
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

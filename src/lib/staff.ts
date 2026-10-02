import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** The signed-in staff member (or null). Cached per request, so layout + page share one query. */
export const getStaff = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("staff").select("full_name, role").maybeSingle();
  return data as { full_name: string; role: "admin" | "staff" } | null;
});

"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type PowerState = { error: string | null };

async function clearSession() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const store = await cookies();
  for (const c of store.getAll()) if (c.name.startsWith("sb-")) store.delete(c.name);
}

/** Sign in at /power: only the power admin may stay signed in here. */
export async function powerSignIn(_prev: PowerState, formData: FormData): Promise<PowerState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter the email and password." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Wrong email or password, or this login is not the power admin." };
  const { data } = await supabase.rpc("site_status");
  if (!(data as { power?: boolean } | null)?.power) {
    await clearSession();
    return { error: "Wrong email or password, or this login is not the power admin." };
  }
  redirect("/power");
}

/** Switch the whole site on or off (the database refuses anyone but the power admin). */
export async function powerToggle(formData: FormData) {
  const off = formData.get("off") === "1";
  const message = String(formData.get("message") ?? "").slice(0, 500);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_site_power", { p_off: off, p_message: message });
  if (error) console.error("set_site_power:", error.message);
  revalidatePath("/power");
  redirect("/power");
}

export async function powerSignOut() {
  await clearSession();
  redirect("/power");
}

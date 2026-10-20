import { act } from "@/lib/api";

export type RpcError = { code?: string; message: string };

/**
 * Call a server function by the old database function's name (POST /api/rpc/{name}) with the same parameters.
 * Answers like supabase.rpc(): { data, error } — error.code is the old Postgres code (42501 not allowed, 22023 bad input,
 * P0002 not found, 23505 duplicate), so the copied screens keep their messages.
 */
export async function rpc<T = unknown>(name: string, params: Record<string, unknown> = {}): Promise<{ data: T | null; error: RpcError | null }> {
  const r = await act<{ ok: boolean; data?: T; error?: string | RpcError }>("POST", `/rpc/${name}`, params);
  if (r.ok) return { data: (r.data ?? null) as T | null, error: null };
  const e = r.error;
  return { data: null, error: typeof e === "object" && e ? e : { message: e || "Could not save. Check your internet and try again." } };
}

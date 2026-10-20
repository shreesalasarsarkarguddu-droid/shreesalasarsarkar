import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, act, get, SIGNED_OUT } from "@/lib/api";
import { queryClient } from "@/lib/query";
import type { Access } from "@/lib/permissions";

/** The person signed in (null = not signed in). */
export type Staff = Access & { id: string; email: string; full_name: string };

type AuthState = {
  staff: Staff | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

/** Forget every screen's data but keep the "me" query alive (clear() would detach it from the app). */
function forgetData(): void {
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
}

async function fetchMe(): Promise<Staff | null> {
  try {
    return (await get<{ user: Staff }>("/me")).user;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 419)) return null;
    throw e;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 5 * 60_000 });

  // any request answered "signed out" -> forget the person and every cached screen
  useEffect(() => {
    const onOut = () => {
      forgetData();
      queryClient.setQueryData(["me"], null);
    };
    window.addEventListener(SIGNED_OUT, onOut);
    return () => window.removeEventListener(SIGNED_OUT, onOut);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await act<{ ok: boolean; error?: string; user?: Staff }>("POST", "/login", { email, password });
    if (!r.ok || !r.user) return r.error ?? "Email or password is incorrect.";
    forgetData();
    queryClient.setQueryData(["me"], r.user);
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await act("POST", "/logout");
    forgetData();
    queryClient.setQueryData(["me"], null);
  }, []);

  return <Ctx.Provider value={{ staff: me.data ?? null, loading: me.isPending, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

/** The signed-in person (screens inside the app layout always have one). */
export function useStaff(): Staff {
  const s = useAuth().staff;
  if (!s) throw new Error("not signed in");
  return s;
}

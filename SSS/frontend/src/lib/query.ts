import { QueryClient } from "@tanstack/react-query";

/** One cache for the whole app. "router.refresh()" (compat) clears it so every screen loads fresh data. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: (n, e) => n < 1 && !(e instanceof Error && "status" in e && (e as { status: number }).status < 500), refetchOnWindowFocus: false },
  },
});

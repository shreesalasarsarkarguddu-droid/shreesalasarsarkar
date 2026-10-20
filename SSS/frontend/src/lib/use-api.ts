import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";

/**
 * Load JSON from the API (cached per URL; router.refresh() reloads it).
 * keep: show the previous result while the next one loads (lists with a search box).
 */
export function useApi<T>(url: string | null, opts?: { keep?: boolean }) {
  return useQuery({
    queryKey: [url],
    queryFn: () => get<T>(url!),
    enabled: url !== null,
    placeholderData: opts?.keep ? keepPreviousData : undefined,
  });
}

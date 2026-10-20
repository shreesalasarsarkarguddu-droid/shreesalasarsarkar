// "@/lib/staff" for the copied server actions: the signed-in person from the app's cache.
import { queryClient } from "@/lib/query";
import type { Staff } from "@/lib/auth";

export async function getStaff(): Promise<Staff | null> {
  return (queryClient.getQueryData(["me"]) as Staff | null | undefined) ?? null;
}

// next/cache for the copied server actions: after a change every screen reloads its data.
import { queryClient } from "@/lib/query";

export function revalidatePath(path?: string): void {
  void path;
  void queryClient.invalidateQueries();
}

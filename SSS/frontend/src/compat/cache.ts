// next/cache for the copied server actions: after a change every screen reloads its data.
import { queryClient } from "@/lib/query";

export function revalidatePath(path?: string, type?: "page" | "layout"): void {
  void type;
  void path;
  void queryClient.invalidateQueries();
}

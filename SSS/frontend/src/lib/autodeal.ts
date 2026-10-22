// Auto Deal (used-vehicle stock and sales) runs on the Laravel side under /autodeal with the same login (session cookie).
import { API } from "@/lib/api";
import { can, type Access } from "@/lib/permissions";

/** Where the "Auto Deal" menu link goes, or null when this person may not use it (or it is switched off on the server). */
export function autodealUrl(a: Access | null | undefined): string | null {
  const on = (a as { modules?: { autodeal?: boolean } } | null | undefined)?.modules?.autodeal;
  return a && on !== false && can(a, "autodeal") ? `${API}/autodeal/vehicles` : null;
}

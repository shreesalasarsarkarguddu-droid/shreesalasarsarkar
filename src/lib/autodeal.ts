// Auto Deal (used-vehicle stock and sales) is part of the Laravel site (SSS/backend, /autodeal); this app links to it.
// Signing in there uses the Laravel site's login. NEXT_PUBLIC_AUTODEAL_URL="" hides the link.
import { can, type Access } from "@/lib/permissions";

const URL = process.env.NEXT_PUBLIC_AUTODEAL_URL ?? "https://api.businesstradecore.in/autodeal/vehicles";

/** Where the "Auto Deal" menu link goes, or null when this person may not use it. */
export function autodealUrl(a: Access | null | undefined): string | null {
  return a && URL && can(a, "autodeal") ? URL : null;
}

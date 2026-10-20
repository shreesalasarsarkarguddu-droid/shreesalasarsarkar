// An account's zone on the collection screens (from public.account_zone_info).

export type ZoneInfo = {
  /** the account's zone; null = DHAMTARI (main book, no zone) */
  zone: string | null;
  /** the zone is one of the zones in the list (an old text such as "OLD" is not) */
  in_list: boolean;
  /** active zones to choose from */
  zones: string[];
  /** no zone yet: anyone who collects; already in a zone: only "fix mistakes" */
  can_change: boolean;
};

export const MAIN_ZONE = "DHAMTARI";

"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PaymentDialog } from "./payment-dialog";
import { isPhone, type PendingRow } from "./collect-list";

/** "Collect payment" button for an account/loan page; opens the same window as the Collect screen. */
export function CollectButton({ row }: { row: PendingRow }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          isPhone() ? router.push(`/payments/${row.source}/${row.ref_id}?back=${encodeURIComponent(pathname)}`) : setOpen(true)
        }
        className="inline-flex h-11 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
        Collect payment
      </button>
      {open && <PaymentDialog row={row} onClose={() => setOpen(false)} />}
    </>
  );
}

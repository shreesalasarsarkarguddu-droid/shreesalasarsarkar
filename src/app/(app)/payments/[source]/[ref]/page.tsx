import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLedger } from "@/lib/ledger";
import { CollectPanel } from "../../payment-dialog";

export const metadata = { title: "Collect payment · Shree Salasar Sarkar" };

/** Full-page collection screen (used on phones instead of the pop-up window). */
export default async function CollectPage({ params, searchParams }: PageProps<"/payments/[source]/[ref]">) {
  const [{ source, ref }, sp] = await Promise.all([params, searchParams]);
  const id = Number.parseInt(ref, 10);
  if ((source !== "old" && source !== "new") || !Number.isInteger(id) || String(id) !== ref) notFound();

  const ledger = await getLedger(await createClient(), source, id);
  if (!ledger) notFound();

  const back = typeof sp.back === "string" && sp.back.startsWith("/") && !sp.back.startsWith("//") ? sp.back : "/payments";
  return (
    <div className="space-y-2">
      <Link href={back} className="inline-flex h-10 items-center text-sm font-medium text-blue-700">
        ← Back
      </Link>
      <CollectPanel
        variant="page"
        initialLedger={ledger}
        row={{ source, ref_id: id, folio: ledger.folio, borrower_name: ledger.name, borrower_mobile: ledger.mobile }}
      />
    </div>
  );
}

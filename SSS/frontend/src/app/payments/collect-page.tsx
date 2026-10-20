import Link from "next/link";
import { useParams } from "react-router";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getLedger } from "@/lib/ledger";
import { PageData } from "@/components/page-state";
import { CollectPanel } from "./payment-dialog";

/** Full-page collection screen (used on phones instead of the pop-up window). */
export default function CollectPage() {
  const { source = "", ref = "" } = useParams();
  const sp = useSearchParams();
  const id = Number.parseInt(ref, 10);
  const valid = (source === "old" || source === "new") && Number.isInteger(id) && String(id) === ref;
  const q = useQuery({ queryKey: ["ledger", source, id], queryFn: () => getLedger(source as "old" | "new", id), enabled: valid });
  const back = (sp.get("back") ?? "").startsWith("/") && !(sp.get("back") ?? "").startsWith("//") ? sp.get("back")! : "/payments";
  if (!valid) return <PageData q={{ data: undefined, error: new Error("Not found"), isPending: false, refetch: () => undefined }}>{() => null}</PageData>;

  return (
    <PageData q={q}>
      {(ledger) =>
        ledger ? (
          <div className="space-y-2">
            <title>Collect payment · Shree Salasar Sarkar</title>
            <Link href={back} className="inline-flex h-10 items-center text-sm font-medium text-blue-700">
              ← Back
            </Link>
            <CollectPanel
              variant="page"
              initialLedger={ledger}
              row={{ source: source as "old" | "new", ref_id: id, folio: ledger.folio, borrower_name: ledger.name, borrower_mobile: ledger.mobile }}
            />
          </div>
        ) : (
          <p className="mx-auto mt-6 max-w-md rounded-xl bg-white p-6 text-center font-semibold ring-1 ring-slate-200">This account is no longer pending.</p>
        )
      }
    </PageData>
  );
}

import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getStatement } from "@/lib/statement";
import { PageData } from "@/components/page-state";
import { StatementView } from "./statement-view";

/** Printable statement of an old account (/accounts/:sno/statement) or a new loan (/loans/:id/statement). */
export default function StatementPage({ source }: { source: "old" | "new" }) {
  const p = useParams();
  const ref = (source === "old" ? p.sno : p.id) ?? "";
  const id = Number.parseInt(ref, 10);
  const valid = Number.isInteger(id) && String(id) === ref;
  const q = useQuery({ queryKey: ["statement", source, id], queryFn: () => getStatement(source, id), enabled: valid });
  if (!valid) return <PageData q={{ data: undefined, error: new Error("Not found"), isPending: false, refetch: () => undefined }}>{() => null}</PageData>;
  return (
    <PageData q={q}>
      {(s) =>
        s ? (
          <>
            <title>{`Statement ${source === "old" ? `SNO ${id}` : s.folio} · Shree Salasar Sarkar`}</title>
            <StatementView s={s} backHref={source === "old" ? `/accounts/${id}` : `/loans/${id}`} />
          </>
        ) : (
          <p className="mx-auto mt-6 max-w-md rounded-xl bg-white p-6 text-center font-semibold ring-1 ring-slate-200">Not found</p>
        )
      }
    </PageData>
  );
}

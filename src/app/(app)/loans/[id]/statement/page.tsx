import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStatement } from "@/lib/statement";
import { StatementView } from "../../../statement-view";

export async function generateMetadata({ params }: PageProps<"/loans/[id]/statement">) {
  const { id } = await params;
  return { title: `Statement loan ${id} · Shree Salasar Sarkar` };
}

export default async function LoanStatementPage({ params }: PageProps<"/loans/[id]/statement">) {
  const { id: idParam } = await params;
  const id = Number.parseInt(idParam, 10);
  if (!Number.isInteger(id) || String(id) !== idParam) notFound();
  const s = await getStatement(await createClient(), "new", id);
  if (!s) notFound();
  return <StatementView s={s} backHref={`/loans/${id}`} />;
}

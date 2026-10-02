import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStatement } from "@/lib/statement";
import { StatementView } from "../../../statement-view";

export async function generateMetadata({ params }: PageProps<"/accounts/[sno]/statement">) {
  const { sno } = await params;
  return { title: `Statement SNO ${sno} · Shree Salasar Sarkar` };
}

export default async function AccountStatementPage({ params }: PageProps<"/accounts/[sno]/statement">) {
  const { sno: snoParam } = await params;
  const sno = Number.parseInt(snoParam, 10);
  if (!Number.isInteger(sno) || String(sno) !== snoParam) notFound();
  const s = await getStatement(await createClient(), "old", sno);
  if (!s) notFound();
  return <StatementView s={s} backHref={`/accounts/${sno}`} />;
}

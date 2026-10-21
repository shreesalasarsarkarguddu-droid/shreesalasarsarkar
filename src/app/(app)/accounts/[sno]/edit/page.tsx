import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { OLD_ACCOUNT_FORM, plainMoney, type OldAccountFields } from "@/lib/old-account";
import { OldAccountForm } from "./old-account-form";

export async function generateMetadata({ params }: PageProps<"/accounts/[sno]/edit">) {
  const { sno } = await params;
  return { title: `Edit SNO ${sno} · Shree Salasar Sarkar` };
}

const FIELDS = OLD_ACCOUNT_FORM.flatMap((s) => s.fields);

export default async function EditOldAccountPage({ params }: PageProps<"/accounts/[sno]/edit">) {
  await requireAdmin();
  const { sno: snoParam } = await params;
  const sno = Number.parseInt(snoParam, 10);
  if (!Number.isInteger(sno) || String(sno) !== snoParam) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legacy_accounts")
    .select(FIELDS.map(([k, , kind]) => (kind === "money" ? `${k}::text` : k)).join(", ") + ", sno, edited_in_app")
    .eq("sno", sno)
    .maybeSingle();
  if (error) {
    console.error("edit old account query failed:", error);
    throw new Error("Could not load this account.");
  }
  if (!data) notFound();
  const a = data as unknown as Record<string, string | number | boolean | null>;
  const initial = Object.fromEntries(
    FIELDS.map(([k, , kind]) => [k, a[k] == null ? "" : kind === "money" ? plainMoney(String(a[k])) : String(a[k])]),
  ) as Record<OldAccountFields, string>;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <Link href={`/accounts/${sno}`} className="text-sm font-medium text-blue-700">
          ← SNO {sno}
        </Link>
        <h1 className="text-xl font-bold">Edit old account · SNO {sno}</h1>
        <p className="text-sm text-slate-500">
          Data from the old software. Only an admin can change it.
          {a.edited_in_app === true && " This account was already changed in this app."}
        </p>
      </div>
      <OldAccountForm sno={sno} initial={initial} />
    </div>
  );
}

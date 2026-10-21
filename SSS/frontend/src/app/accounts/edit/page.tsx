import Link from "next/link";
import { useParams } from "react-router";
import { useApi } from "@/lib/use-api";
import { PageData } from "@/components/page-state";
import { OLD_ACCOUNT_FORM, plainMoney, type OldAccountFields } from "@/lib/old-account";
import { OldAccountForm } from "./old-account-form";

const FIELDS = OLD_ACCOUNT_FORM.flatMap((s) => s.fields);

/** Admin only: change the details of an account that came from the old software. */
export default function EditOldAccountPage() {
  const { sno: snoParam = "" } = useParams();
  const sno = Number.parseInt(snoParam, 10);
  const valid = Number.isInteger(sno) && String(sno) === snoParam;
  const res = useApi<{ account: Record<string, string | number | boolean | null> }>(valid ? `/legacy-accounts/${sno}` : null);
  return (
    <PageData q={res}>
      {(d) => {
        const a = d.account;
        const initial = Object.fromEntries(
          FIELDS.map(([k, , kind]) => [k, a[k] == null ? "" : kind === "money" ? plainMoney(String(a[k])) : String(a[k])]),
        ) as Record<OldAccountFields, string>;
        return (
          <div className="mx-auto max-w-4xl space-y-4">
            <title>{`Edit SNO ${sno} · Shree Salasar Sarkar`}</title>
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
      }}
    </PageData>
  );
}

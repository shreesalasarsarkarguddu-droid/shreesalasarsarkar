import type { Metadata } from "next";
import Link from "next/link";
import { requirePerm } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { dmy, inr } from "@/lib/format";
import { ReviewButtons } from "./review-buttons";

export const metadata: Metadata = { title: "Approvals · Shree Salasar Sarkar" };

type Row = {
  id: number; subject: string; source: "old" | "new"; ref_id: number; paid_amount: number; paid_date: string; receipt_no: number;
  payment_mode: string; reason: string; by_name: string; created_at: string;
};

export default async function ApprovalsPage() {
  await requirePerm("approve");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pending_approvals");
  if (error) {
    console.error("pending_approvals failed:", error);
    throw new Error("Could not load approvals.");
  }
  const rows = (data ?? []) as Row[];
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Approvals</h1>
        <p className="text-sm text-slate-500">
          Payments that are back-dated or above the limit in Settings, entered by people without that right. They already count in the
          balance; approve to clear them, or reject to cancel the payment.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">Nothing is waiting for approval. ✓</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl bg-white p-4 ring-1 ring-amber-200">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link href={r.source === "old" ? `/accounts/${r.ref_id}` : `/loans/${r.ref_id}`} className="font-semibold text-blue-700">
                  {r.subject}
                </Link>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">{r.reason}</span>
              </div>
              <p className="num mt-1 text-sm">
                <b className="text-emerald-700">{inr(String(r.paid_amount))}</b> · paid {dmy(r.paid_date)} · {r.payment_mode} · Rcpt {r.receipt_no}
              </p>
              <p className="text-xs text-slate-500">
                Entered by {r.by_name} on{" "}
                {new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}
              </p>
              <ReviewButtons id={r.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

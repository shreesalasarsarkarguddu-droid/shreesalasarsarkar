import type { Metadata } from "next";
import Link from "next/link";
import { requirePerm } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { ApproveGroup, type Waiting } from "./review-buttons";

export const metadata: Metadata = { title: "Approvals · Shree Salasar Sarkar" };

const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));

export default async function ApprovalsPage() {
  await requirePerm("approve");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pending_approvals");
  if (error) {
    console.error("pending_approvals failed:", error);
    throw new Error("Could not load approvals.");
  }
  const rows = (data ?? []) as Waiting[];

  // one group per collection man per day
  const groups = new Map<string, { who: string; userId: string; day: string; rows: Waiting[] }>();
  for (const r of rows) {
    const day = dayOf(r.created_at);
    const k = `${r.user_id}|${day}`;
    if (!groups.has(k)) groups.set(k, { who: r.by_name, userId: r.user_id, day, rows: [] });
    groups.get(k)!.rows.push(r);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Approvals</h1>
        <p className="text-sm text-slate-500">
          Payments taken by collection men wait here and do not count yet. Count each person&apos;s cash (Daily cash), then approve the
          receipts the money covers — only then the balance changes and the customer gets the WhatsApp receipt. Reject removes a
          payment (kept in the activity log).
        </p>
      </div>
      {groups.size === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">Nothing is waiting for approval. ✓</p>
      ) : (
        [...groups.values()].map((g) => (
          <section key={`${g.userId}-${g.day}`} className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <h2 className="text-sm font-semibold">
                {g.who} · {new Date(g.day + "T00:00:00Z").toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })}
              </h2>
              <Link href={`/cash?day=${g.day}`} className="text-sm font-semibold text-blue-700">
                Daily cash for this day →
              </Link>
            </div>
            <ApproveGroup rows={g.rows} />
          </section>
        ))
      )}
    </div>
  );
}

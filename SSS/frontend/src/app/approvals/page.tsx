import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useStaff } from "@/lib/auth";
import Loading from "@/app/loading";
import { dmy, weekday } from "@/lib/format";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ApproveGroup, type Waiting } from "./review-buttons";

const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));

export default function ApprovalsPage() {
  const staff = useStaff();
  void staff;
  const search = useSearchParams();
  const sp = Object.fromEntries(search) as Record<string, string | undefined>;
  void sp;
  const page = useQuery({
    queryKey: ["page", "SSS/frontend/src/app/approvals/page.tsx", search.toString()],
    queryFn: async () => {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("pending_approvals");
      return { data, error };
    },
  });
  if (page.isPending) return <Loading />;
  if (page.error) throw page.error;
  const { data, error } = page.data;
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
      <title>Approvals · Shree Salasar Sarkar</title>
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
                {g.who} · {weekday(g.day).slice(0, 3)} {dmy(g.day)}
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

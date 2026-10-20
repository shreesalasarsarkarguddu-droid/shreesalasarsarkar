import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import Loading from "@/app/loading";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/format";
import { todayIST } from "@/lib/schedule";
import { AssignPicker, AssignedList, type Candidate, type Assigned } from "./assign-forms";
import { DateInput } from "@/components/date-input";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const FILTERS = [
  ["due_day", "Due on this day"],
  ["week", "Due this week"],
  ["overdue", "Overdue (any)"],
  ["overdue3", "3+ EMIs overdue"],
  ["unassigned", "Not assigned yet"],
  ["all", "All pending (incl. seized)"],
] as const;

export default function AssignPage() {
  const search = useSearchParams();
  const sp = Object.fromEntries(search) as Record<string, string | undefined>;
  void sp;
  const today = todayIST();
  const raw = one(sp.day);
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw >= today ? raw : today;
  const filter = FILTERS.some(([k]) => k === one(sp.filter)) ? one(sp.filter)! : "overdue";
  const q = (one(sp.q) ?? "").trim().slice(0, 60);

  const page = useQuery({
    queryKey: ["page", "SSS/frontend/src/app/assign/page.tsx", search.toString()],
    queryFn: async () => {
      const supabase = await createClient();
      const [cand, list, people] = await Promise.all([
        supabase.rpc("assign_candidates", { p_day: day, p_q: q, p_filter: filter }),
        supabase.rpc("collection_list", { p_day: day, p_user: null }),
        supabase.rpc("staff_names"),
      ]);
      return { cand, list, people };
    },
  });
  if (page.isPending) return <Loading />;
  if (page.error) throw page.error;
  const { cand, list, people } = page.data;
  if (cand.error || list.error) {
    console.error("assign page failed:", cand.error ?? list.error);
    throw new Error("Could not load the accounts.");
  }
  const candidates = (cand.data ?? []) as Candidate[];
  const assigned = (list.data ?? []) as Assigned[];
  const staff = ((people.data ?? []) as { user_id: string; full_name: string; active: boolean }[]).filter((p) => p.active);
  const field = "h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm";

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <title>Assign collections · Shree Salasar Sarkar</title>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Assign collections</h1>
          <p className="text-sm text-slate-500">Choose a day, tick accounts and give them to a collection man. He sees them under “My list”.</p>
        </div>
        <Link href={`/my-collections?day=${day}`} className="flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-blue-700 ring-1 ring-slate-300">
          See everyone’s list →
        </Link>
      </div>

      <form method="get" className="grid gap-2 rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:grid-cols-[auto_auto_1fr_auto]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Day</span>
          <DateInput name="day" defaultValue={day} min={today} className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Show</span>
          <select name="filter" defaultValue={filter} className={field}>
            {FILTERS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Village / area / name / folio / mobile</span>
          <input name="q" defaultValue={q} placeholder="e.g. Kandel" className={`${field} w-full`} />
        </label>
        <button className="h-11 self-end rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white">Show</button>
      </form>

      <AssignPicker key={`${day}-${filter}-${q}`} day={day} candidates={candidates} staff={staff.map((p) => ({ id: p.user_id, name: p.full_name }))} />

      <section className="space-y-2">
        <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Already assigned for this day ({assigned.length}) · collected {inr(String(assigned.reduce((t, a) => t + Number(a.collected), 0)))}
        </h2>
        <AssignedList key={`a-${day}-${assigned.length}`} items={assigned} />
      </section>
    </div>
  );
}

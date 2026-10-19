import type { Metadata } from "next";
import { requirePerm } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { dmy } from "@/lib/format";
import { BookActions, NewBook } from "./book-forms";

export const metadata: Metadata = { title: "Receipt books · Shree Salasar Sarkar" };

type Book = {
  id: number; user_id: string; full_name: string; from_no: number; to_no: number; issued_on: string; note: string | null; closed: boolean;
  used: number; last_used: number | null; skipped: number[] | null; skipped_count: number; book: string;
};

export default async function ReceiptBooksPage() {
  await requirePerm("cash");
  const supabase = await createClient();
  const [{ data, error }, { data: people }, { data: series }] = await Promise.all([
    supabase.rpc("receipt_book_status"),
    supabase.rpc("staff_names"),
    supabase.from("receipt_series").select("id, code").is("closed_at", null).order("id"),
  ]);
  if (error) {
    console.error("receipt_book_status failed:", error);
    throw new Error("Could not load receipt books.");
  }
  const books = (data ?? []) as Book[];
  const staff = ((people ?? []) as { user_id: string; full_name: string; active: boolean }[]).filter((p) => p.active);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Receipt books</h1>
        <p className="text-sm text-slate-500">
          Give each person a range of receipt numbers. They can then only use numbers from their own book, and nobody else can use
          them. Skipped numbers (a receipt torn out but never entered) show up here.
        </p>
      </div>

      <NewBook
        staff={staff.map((p) => ({ id: p.user_id, name: p.full_name }))}
        series={((series ?? []) as { id: number; code: string }[]).map((s) => ({ id: s.id, code: s.code === "MAIN" ? "DHAMTARI (main book)" : s.code }))}
      />

      {books.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">No receipt books yet.</p>
      ) : (
        <ul className="space-y-3">
          {books.map((b) => {
            const size = b.to_no - b.from_no + 1;
            return (
              <li key={b.id} className={`rounded-xl bg-white p-4 ring-1 ring-slate-200 ${b.closed ? "opacity-70" : ""}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="num font-semibold">
                    {b.from_no} – {b.to_no}
                  </p>
                  <span className="text-sm text-slate-600">{b.full_name}</span>
                  {b.book !== "MAIN" && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800">{b.book}</span>}
                  {b.closed && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Closed</span>}
                  <span className="ml-auto text-xs text-slate-500">given {dmy(b.issued_on)}</span>
                </div>
                <p className="num mt-1 text-sm text-slate-600">
                  Used {b.used} of {size}
                  {b.last_used != null && ` · last used ${b.last_used}`}
                  {b.note && ` · ${b.note}`}
                </p>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-blue-600" style={{ width: `${Math.min(100, (b.used / size) * 100)}%` }} />
                </div>
                {b.skipped_count > 0 && (
                  <p className="num mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    ⚠ {b.skipped_count} number{b.skipped_count > 1 ? "s" : ""} skipped: {(b.skipped ?? []).join(", ")}
                    {b.skipped_count > (b.skipped?.length ?? 0) && " …"}
                  </p>
                )}
                <BookActions id={b.id} closed={b.closed} unused={b.used === 0} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

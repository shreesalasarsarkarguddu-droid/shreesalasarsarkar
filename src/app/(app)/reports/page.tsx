import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Reports · Shree Salasar Sarkar" };

const REPORTS = [
  { href: "/reports/day-book", title: "Day Book", text: "Every receipt and loan given, day by day, with debit, credit and totals." },
  { href: "/reports/due-installments", title: "Due Installments", text: "Pending borrowers with EMIs due or short-paid: next due date, arrears, due EMIs, mobile." },
];

export default function ReportsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-bold">Reports</h1>
      <ul className="space-y-3">
        {REPORTS.map((r) => (
          <li key={r.href}>
            <Link href={r.href} className="block rounded-xl bg-white p-4 ring-1 ring-slate-200 hover:bg-slate-50">
              <p className="font-semibold text-blue-700">{r.title}</p>
              <p className="mt-0.5 text-sm text-slate-500">{r.text}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

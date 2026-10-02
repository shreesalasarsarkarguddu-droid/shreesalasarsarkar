import Link from "next/link";

export default function AccountNotFound() {
  return (
    <div className="mt-6 rounded-xl bg-white p-6 text-center ring-1 ring-slate-200">
      <p className="font-semibold">Account not found</p>
      <Link href="/accounts" className="mt-3 inline-flex h-11 items-center text-sm font-medium text-blue-700">
        ← Back to all accounts
      </Link>
    </div>
  );
}

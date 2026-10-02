"use client";

export default function AccountsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mt-6 rounded-xl bg-white p-6 text-center ring-1 ring-slate-200">
      <p className="font-semibold">Something went wrong while loading.</p>
      <p className="mt-1 text-sm text-slate-500">Check your internet connection and try again.</p>
      <button
        onClick={reset}
        className="mt-4 h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800"
      >
        Try again
      </button>
    </div>
  );
}

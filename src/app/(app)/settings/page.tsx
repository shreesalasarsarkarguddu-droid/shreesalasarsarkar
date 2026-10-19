import type { Metadata } from "next";
import { dateTimeIST } from "@/lib/format";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStaff } from "@/lib/staff";
import { Section } from "@/components/section";
import { SettingsForm, type Settings } from "./settings-form";

export const metadata: Metadata = { title: "Settings · Shree Salasar Sarkar" };

type LogRow = { id: number; channel: string; event: string; recipient: string; message: string; status: string; detail: string | null; created_at: string };

export default async function SettingsPage() {
  const staff = await getStaff();
  if (staff?.role !== "admin") redirect("/profile");

  const supabase = await createClient();
  await supabase.rpc("refresh_notification_log");
  const [{ data: settings, error }, { data: log }] = await Promise.all([
    supabase.rpc("get_notification_settings"),
    supabase
      .from("notification_log")
      .select("id, channel, event, recipient, message, status, detail, created_at")
      .order("id", { ascending: false })
      .limit(30),
  ]);
  if (error || !settings) throw new Error("Could not load settings.");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm text-slate-500">Telegram alerts for staff and WhatsApp messages for customers. Only admins can see this page.</p>
      </div>

      <SettingsForm initial={settings as Settings} />

      <Section title="Recent messages" hint="The latest Telegram and WhatsApp messages and whether they were sent.">
        {(log as LogRow[] | null)?.length ? (
          <ul className="-mx-4 -my-4 divide-y divide-slate-100">
            {(log as LogRow[]).map((r) => (
              <li key={r.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.channel === "telegram" ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {r.channel === "telegram" ? "Telegram" : "WhatsApp"}
                  </span>
                  <span className="font-medium text-slate-700">{r.event.replace("_", " ")}</span>
                  <span className="text-slate-500">{r.recipient}</span>
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${
                      r.status === "sent" ? "bg-emerald-50 text-emerald-700" : r.status === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {r.status}
                  </span>
                  <span className="num text-xs text-slate-400">
                    {dateTimeIST(r.created_at)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-line text-slate-600">{r.message}</p>
                {r.status === "failed" && r.detail && <p className="mt-1 line-clamp-2 text-xs text-red-600">{r.detail}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No messages yet.</p>
        )}
      </Section>
    </div>
  );
}

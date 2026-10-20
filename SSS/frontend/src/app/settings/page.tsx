import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useStaff } from "@/lib/auth";
import Loading from "@/app/loading";
import { dateTimeIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { get } from "@/lib/api";
import { Section } from "@/components/section";
import { SettingsForm, type Settings } from "./settings-form";

type LogRow = { id: number; channel: string; event: string; recipient: string; message: string; status: string; detail: string | null; created_at: string };

export default function SettingsPage() {
  const staff = useStaff();
  void staff;
  const search = useSearchParams();
  const sp = Object.fromEntries(search) as Record<string, string | undefined>;
  void sp;

  const page = useQuery({
    queryKey: ["page", "SSS/frontend/src/app/settings/page.tsx", search.toString()],
    queryFn: async () => {
      const supabase = await createClient();
      await supabase.rpc("refresh_notification_log");
      const [{ data: settings, error }, { data: log }] = await Promise.all([
        supabase.rpc("get_notification_settings"),
        get<LogRow[]>("/notification-log").then((data) => ({ data })),
      ]);
      return { settings, error, log };
    },
  });
  if (page.isPending) return <Loading />;
  if (page.error) throw page.error;
  const { settings, error, log } = page.data;
  if (error || !settings) throw new Error("Could not load settings.");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <title>Settings · Shree Salasar Sarkar</title>
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

"use client";

import { useState, useTransition } from "react";
import { saveSettings, sendTest, type Result } from "./actions";

export type Settings = {
  business_name: string;
  telegram_enabled: boolean;
  telegram_bot_token: string;
  telegram_group_id: string | null;
  tg_on_payment: boolean;
  tg_on_new_loan: boolean;
  tg_on_seizure: boolean;
  tg_daily_summary: boolean;
  tg_summary_hour: number;
  whatsapp_enabled: boolean;
  whatsapp_host: string | null;
  whatsapp_api_key: string;
  wa_receipt: boolean;
  wa_receipt_template: string;
  wa_due_reminder: boolean;
  wa_reminder_days_before: number;
  wa_reminder_hour: number;
  wa_reminder_template: string;
  updated_at: string | null;
};

const input =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";
const card = "rounded-xl bg-white p-4 ring-1 ring-slate-200 space-y-4";
const head = "text-xs font-semibold uppercase tracking-wide text-slate-500";

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`,
}));

export function SettingsForm({ initial }: { initial: Settings }) {
  const [s, setS] = useState<Settings>({ ...initial, telegram_group_id: initial.telegram_group_id ?? "", whatsapp_host: initial.whatsapp_host ?? "" });
  const [saved, setSaved] = useState<Result | null>(null);
  const [saving, startSave] = useTransition();
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setS((o) => ({ ...o, [k]: v }));
    setSaved(null);
  };

  const save = () =>
    startSave(async () => {
      setSaved(await saveSettings(s)); // the database ignores keys it does not know (updated_at)
    });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {/* ---------------- Telegram */}
      <section className={card}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className={head}>Telegram · staff group</h2>
            <p className="text-sm text-slate-500">Every payment, new loan and seizure is posted to your staff group.</p>
          </div>
          <Switch checked={s.telegram_enabled} onChange={(v) => set("telegram_enabled", v)} label="Telegram on" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bot token" hint="From @BotFather. Saved securely; only the last 4 characters are shown.">
            <input
              className={input}
              value={s.telegram_bot_token}
              onChange={(e) => set("telegram_bot_token", e.target.value)}
              onFocus={(e) => s.telegram_bot_token.startsWith("••••") && e.target.select()}
              placeholder="123456789:AA..."
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Group chat id" hint="Starts with -100 for groups.">
            <input
              className={input + " num"}
              value={s.telegram_group_id ?? ""}
              onChange={(e) => set("telegram_group_id", e.target.value)}
              placeholder="-1001234567890"
              inputMode="numeric"
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Check checked={s.tg_on_payment} onChange={(v) => set("tg_on_payment", v)} label="Payment received" />
          <Check checked={s.tg_on_new_loan} onChange={(v) => set("tg_on_new_loan", v)} label="New loan created" />
          <Check checked={s.tg_on_seizure} onChange={(v) => set("tg_on_seizure", v)} label="Vehicle seized / released" />
          <div className="flex flex-wrap items-center gap-2">
            <Check checked={s.tg_daily_summary} onChange={(v) => set("tg_daily_summary", v)} label="Daily summary at" />
            <HourSelect value={s.tg_summary_hour} onChange={(v) => set("tg_summary_hour", v)} disabled={!s.tg_daily_summary} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <TestButton channel="telegram" label="Send test message" />
          <TestButton channel="summary" label="Send today's summary now" />
        </div>
      </section>

      {/* ---------------- WhatsApp */}
      <section className={card}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className={head}>WhatsApp · customers</h2>
            <p className="text-sm text-slate-500">Payment receipts and EMI due reminders to the borrower&apos;s mobile.</p>
          </div>
          <Switch checked={s.whatsapp_enabled} onChange={(v) => set("whatsapp_enabled", v)} label="WhatsApp on" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gateway host" hint="Sends to https://HOST/wapp/api/send/json">
            <input
              className={input}
              value={s.whatsapp_host ?? ""}
              onChange={(e) => set("whatsapp_host", e.target.value)}
              placeholder="api.example.com"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="API key" hint="Sent as X-API-KEY. Only the last 4 characters are shown.">
            <input
              className={input}
              value={s.whatsapp_api_key}
              onChange={(e) => set("whatsapp_api_key", e.target.value)}
              onFocus={(e) => s.whatsapp_api_key.startsWith("••••") && e.target.select()}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </div>

        <div className="space-y-2">
          <Check checked={s.wa_receipt} onChange={(v) => set("wa_receipt", v)} label="Send receipt when payment is collected" />
          <Template
            value={s.wa_receipt_template}
            onChange={(v) => set("wa_receipt_template", v)}
            tags="{name} {folio} {amount} {date} {receipt} {balance} {business}"
            disabled={!s.wa_receipt}
          />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Check checked={s.wa_due_reminder} onChange={(v) => set("wa_due_reminder", v)} label="Due reminder" />
            <select
              className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm disabled:opacity-50"
              value={s.wa_reminder_days_before}
              onChange={(e) => set("wa_reminder_days_before", Number(e.target.value))}
              disabled={!s.wa_due_reminder}
              aria-label="Days before due date"
            >
              <option value={0}>on the due date</option>
              {[1, 2, 3, 5, 7].map((d) => (
                <option key={d} value={d}>
                  {d} day{d > 1 ? "s" : ""} before
                </option>
              ))}
            </select>
            <span className="text-sm text-slate-600">at</span>
            <HourSelect value={s.wa_reminder_hour} onChange={(v) => set("wa_reminder_hour", v)} disabled={!s.wa_due_reminder} />
          </div>
          <Template
            value={s.wa_reminder_template}
            onChange={(v) => set("wa_reminder_template", v)}
            tags="{name} {folio} {emi} {due_date} {balance} {arrears} {business}"
            disabled={!s.wa_due_reminder}
          />
        </div>

        <WhatsAppTest />

        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Unofficial WhatsApp gateways can get the number blocked by WhatsApp. Use a separate business number, keep messages
          useful (receipts, reminders), and avoid sending too many in one go.
        </p>
      </section>

      {/* ---------------- General */}
      <section className={card}>
        <h2 className={head}>General</h2>
        <Field label="Business name in messages">
          <input className={input} value={s.business_name} onChange={(e) => set("business_name", e.target.value)} />
        </Field>
      </section>

      <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-3 rounded-xl bg-white/95 p-3 ring-1 ring-slate-200 backdrop-blur md:bottom-4">
        <button
          type="submit"
          disabled={saving}
          className="h-11 rounded-lg bg-blue-700 px-6 text-base font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {saved && <Message r={saved} />}
        {!saved && initial.updated_at && (
          <span className="text-xs text-slate-500">
            Last saved {new Date(initial.updated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}
          </span>
        )}
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-emerald-600" : "bg-slate-300"}`}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" className="h-5 w-5 accent-blue-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function HourSelect({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <select
      className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm disabled:opacity-50"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      disabled={disabled}
      aria-label="Time"
    >
      {HOURS.map((h) => (
        <option key={h.value} value={h.value}>
          {h.label}
        </option>
      ))}
    </select>
  );
}

function Template({ value, onChange, tags, disabled }: { value: string; onChange: (v: string) => void; tags: string; disabled?: boolean }) {
  return (
    <div className={disabled ? "opacity-50" : ""}>
      <textarea
        className="min-h-20 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
      />
      <p className="text-xs text-slate-500">Fills in: {tags}</p>
    </div>
  );
}

function Message({ r }: { r: Result }) {
  return (
    <span role="status" className={`rounded-lg px-3 py-1.5 text-sm ${r.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
      {r.message}
    </span>
  );
}

function TestButton({ channel, label }: { channel: "telegram" | "summary"; label: string }) {
  const [r, setR] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setR(await sendTest(channel)))}
        className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50 disabled:opacity-60"
      >
        {pending ? "Sending…" : label}
      </button>
      {r && <Message r={r} />}
    </div>
  );
}

function WhatsAppTest() {
  const [mobile, setMobile] = useState("");
  const [r, setR] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        className="num h-10 w-40 rounded-lg border border-slate-300 bg-white px-3 text-sm"
        value={mobile}
        onChange={(e) => setMobile(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
        placeholder="10-digit mobile"
        inputMode="numeric"
        aria-label="Test mobile number"
      />
      <button
        type="button"
        disabled={pending || mobile.length !== 10}
        onClick={() => start(async () => setR(await sendTest("whatsapp", mobile)))}
        className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send test WhatsApp"}
      </button>
      {r && <Message r={r} />}
    </div>
  );
}

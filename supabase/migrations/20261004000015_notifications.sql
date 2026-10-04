-- Notifications: Telegram (staff group) + WhatsApp (customers).
-- Everything runs inside the database:
--   * keys live in app_settings, readable only through admin functions (secrets masked)
--   * messages are sent with pg_net (async HTTP) from triggers / scheduled jobs, so they fire
--     no matter who saves a payment, and the keys never reach any browser
--   * a failed notification never blocks the payment / loan / seizure being saved
--   * every message is recorded in notification_log (with delivery status)

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------- admin check
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.role = 'admin');
$$;
revoke execute on function public.is_admin() from anon, public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------- settings (single row)
create table public.app_settings (
  id                      int primary key default 1 check (id = 1),
  business_name           text not null default 'Shree Salasar Sarkar',
  -- Telegram: one bot, one staff group
  telegram_enabled        boolean not null default false,
  telegram_bot_token      text,
  telegram_group_id       text,
  tg_on_payment           boolean not null default true,
  tg_on_new_loan          boolean not null default true,
  tg_on_seizure           boolean not null default true,
  tg_daily_summary        boolean not null default true,
  tg_summary_hour         int not null default 20 check (tg_summary_hour between 0 and 23),
  -- WhatsApp gateway (customers)
  whatsapp_enabled        boolean not null default false,
  whatsapp_host           text,
  whatsapp_api_key        text,
  wa_receipt              boolean not null default true,
  wa_receipt_template     text not null default
    'Dear {name}, we have received {amount} on {date} for Folio {folio} (Receipt {receipt}). Balance: {balance}. Thank you - {business}',
  wa_due_reminder         boolean not null default true,
  wa_reminder_days_before int not null default 1 check (wa_reminder_days_before between 0 and 10),
  wa_reminder_hour        int not null default 10 check (wa_reminder_hour between 0 and 23),
  wa_reminder_template    text not null default
    'Dear {name}, your EMI of {emi} for Folio {folio} is due on {due_date}. Please pay on time to avoid late charges. - {business}',
  updated_at              timestamptz,
  updated_by              uuid references public.staff (user_id)
);
insert into public.app_settings (id) values (1) on conflict do nothing;
alter table public.app_settings enable row level security;   -- no policies: only the functions below can touch it
revoke all on public.app_settings from anon, authenticated;

-- ---------------------------------------------------------------- notification log
create table public.notification_log (
  id          bigint generated always as identity primary key,
  channel     text not null check (channel in ('telegram', 'whatsapp')),
  event       text not null,
  recipient   text not null,
  message     text not null,
  request_id  bigint,
  status      text not null default 'queued',   -- queued / sent / failed
  detail      text,
  dedupe_key  text unique,
  created_at  timestamptz not null default now()
);
create index notification_log_created_idx on public.notification_log (created_at desc);
alter table public.notification_log enable row level security;
create policy "admin reads notification log" on public.notification_log for select to authenticated using ((select public.is_admin()));
revoke all on public.notification_log from anon;
revoke insert, update, delete, truncate on public.notification_log from authenticated;
grant select on public.notification_log to authenticated;

-- ---------------------------------------------------------------- helpers (private schema: not callable from the API)
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- ₹1,23,456 (2 decimals only when there are paise)
create or replace function app_private.inr(v numeric)
returns text language plpgsql immutable set search_path = '' as $$
declare
  neg boolean := v < 0;
  a numeric := abs(round(v, 2));
  r text := trunc(a)::bigint::text;
  p int := ((a - trunc(a)) * 100)::int;
  last3 text; rest text;
begin
  if length(r) > 3 then
    last3 := right(r, 3);
    rest := left(r, length(r) - 3);
    rest := regexp_replace(rest, '(\d)(?=(\d{2})+$)', '\1,', 'g');
    r := rest || ',' || last3;
  end if;
  return (case when neg then '-' else '' end) || '₹' || r || case when p > 0 then '.' || lpad(p::text, 2, '0') else '' end;
end;
$$;

-- 10-digit Indian mobile -> 91XXXXXXXXXX, else null
create or replace function app_private.wa_number(m text)
returns text language sql immutable set search_path = '' as $$
  select case
    when d ~ '^[6-9][0-9]{9}$' then '91' || d
    when d ~ '^0[6-9][0-9]{9}$' then '91' || substr(d, 2)
    when d ~ '^91[6-9][0-9]{9}$' then d
  end
  from (select regexp_replace(coalesce(split_part(m, ',', 1), ''), '[^0-9]', '', 'g') as d) x;
$$;

create or replace function app_private.fill(tpl text, vals jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare k text; out text := tpl;
begin
  for k in select jsonb_object_keys(vals) loop
    out := replace(out, '{' || k || '}', coalesce(vals ->> k, ''));
  end loop;
  return out;
end;
$$;

-- Queue a Telegram message to the staff group. Returns log id (null if off / not configured / duplicate).
create or replace function app_private.tg_send(p_text text, p_event text, p_dedupe text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare s public.app_settings; v_req bigint; v_id bigint;
begin
  select * into s from public.app_settings where id = 1;
  if not s.telegram_enabled or s.telegram_bot_token is null or s.telegram_group_id is null then return null; end if;
  if p_dedupe is not null and exists (select 1 from public.notification_log where dedupe_key = p_dedupe) then return null; end if;
  v_req := net.http_post(
    url := 'https://api.telegram.org/bot' || s.telegram_bot_token || '/sendMessage',
    body := jsonb_build_object('chat_id', s.telegram_group_id, 'text', left(p_text, 4000), 'disable_web_page_preview', true),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 15000);
  insert into public.notification_log (channel, event, recipient, message, request_id, dedupe_key)
  values ('telegram', p_event, 'staff group', p_text, v_req, p_dedupe) returning id into v_id;
  return v_id;
end;
$$;

-- Queue a WhatsApp message through the gateway (POST https://{host}/wapp/api/send/json).
create or replace function app_private.wa_send(p_mobile text, p_text text, p_event text, p_dedupe text default null, p_force boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare s public.app_settings; v_num text := app_private.wa_number(p_mobile); v_req bigint; v_id bigint;
begin
  select * into s from public.app_settings where id = 1;
  if (not s.whatsapp_enabled and not p_force) or s.whatsapp_host is null or s.whatsapp_api_key is null or v_num is null then return null; end if;
  if p_dedupe is not null and exists (select 1 from public.notification_log where dedupe_key = p_dedupe) then return null; end if;
  v_req := net.http_post(
    url := 'https://' || regexp_replace(s.whatsapp_host, '^https?://|/+$', '', 'g') || '/wapp/api/send/json',
    body := jsonb_build_object('mobile', v_num, 'msg', p_text),
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-API-KEY', s.whatsapp_api_key),
    timeout_milliseconds := 15000);
  insert into public.notification_log (channel, event, recipient, message, request_id, dedupe_key)
  values ('whatsapp', p_event, v_num, p_text, v_req, p_dedupe) returning id into v_id;
  return v_id;
end;
$$;

-- Copy delivery results from pg_net into the log (responses are kept by pg_net for ~6 hours).
create or replace function app_private.refresh_log()
returns void language sql security definer set search_path = '' as $$
  update public.notification_log l
     set status = case
                    when r.timed_out or r.error_msg is not null then 'failed'
                    when r.status_code between 200 and 299 and (
                         (l.channel = 'telegram' and coalesce(r.content::jsonb ->> 'ok', 'false') = 'true')
                      or (l.channel = 'whatsapp' and lower(coalesce(r.content::jsonb ->> 'status', '')) in ('success', 'ok'))) then 'sent'
                    else 'failed' end,
         detail = left(coalesce(r.error_msg, r.content), 300)
    from net._http_response r
   where r.id = l.request_id and l.status = 'queued';
$$;

-- who / what helpers for messages
create or replace function app_private.staff_name(p uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select full_name from public.staff where user_id = p), '—');
$$;

-- ---------------------------------------------------------------- automatic messages (triggers)
create or replace function app_private.on_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.app_settings; v_name text; v_folio text; v_mobile text; v_txt text;
begin
  begin
    select * into s from public.app_settings where id = 1;
    if new.legacy_account_id is not null then
      select borrower_name, fno::text, borrower_mobile into v_name, v_folio, v_mobile from public.legacy_accounts where id = new.legacy_account_id;
    else
      select b.full_name, l.folio_no, b.mobile into v_name, v_folio, v_mobile
        from public.loans l join public.borrowers b on b.id = l.borrower_id where l.id = new.loan_id;
    end if;

    if s.tg_on_payment then
      perform app_private.tg_send(
        '💰 Payment received' || chr(10) ||
        coalesce(v_name, '?') || ' · Folio ' || coalesce(v_folio, '?') || chr(10) ||
        app_private.inr(new.paid_amount) || ' · ' || new.payment_mode || coalesce(' ' || new.bank_name, '') ||
          coalesce(' · Rcpt ' || new.receipt_no, '') || case when new.installments_covered > 1 then ' · ' || new.installments_covered || ' EMIs' else '' end || chr(10) ||
        'Balance ' || app_private.inr(new.balance_after) || chr(10) ||
        'By ' || app_private.staff_name(new.created_by),
        'payment', 'tg-pay-' || new.id);
    end if;

    if s.wa_receipt then
      v_txt := app_private.fill(s.wa_receipt_template, jsonb_build_object(
        'name', v_name, 'folio', v_folio, 'amount', app_private.inr(new.paid_amount), 'date', to_char(new.paid_date, 'DD-MM-YYYY'),
        'receipt', new.receipt_no::text, 'balance', app_private.inr(new.balance_after), 'business', s.business_name));
      perform app_private.wa_send(v_mobile, v_txt, 'receipt', 'wa-pay-' || new.id);
    end if;
  exception when others then
    raise warning 'payment notification failed: %', sqlerrm;   -- never block the payment
  end;
  return null;
end;
$$;
create trigger payments_notify after insert on public.payments for each row execute function app_private.on_payment();

create or replace function app_private.on_new_loan()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.app_settings; v_name text; v_mobile text;
begin
  begin
    select * into s from public.app_settings where id = 1;
    if s.tg_on_new_loan then
      select full_name, mobile into v_name, v_mobile from public.borrowers where id = new.borrower_id;
      perform app_private.tg_send(
        '🆕 New loan' || chr(10) ||
        coalesce(v_name, '?') || ' · Folio ' || new.folio_no || coalesce(' · ' || v_mobile, '') || chr(10) ||
        'Finance ' || app_private.inr(new.finance_amount) || ' · Total ' || app_private.inr(new.total_amount) || chr(10) ||
        'EMI ' || app_private.inr(new.emi_amount) || ' × ' || new.installments || chr(10) ||
        coalesce(new.vehicle_model, '') || coalesce(' · ' || new.vehicle_no, '') || chr(10) ||
        'By ' || app_private.staff_name(new.created_by),
        'new_loan', 'tg-loan-' || new.id);
    end if;
  exception when others then
    raise warning 'loan notification failed: %', sqlerrm;
  end;
  return null;
end;
$$;
create trigger loans_notify after insert on public.loans for each row execute function app_private.on_new_loan();

create or replace function app_private.on_seizure()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.app_settings; v_name text; v_folio text;
begin
  begin
    select * into s from public.app_settings where id = 1;
    if s.tg_on_seizure then
      if new.legacy_account_id is not null then
        select borrower_name, fno::text into v_name, v_folio from public.legacy_accounts where id = new.legacy_account_id;
      else
        select b.full_name, l.folio_no into v_name, v_folio from public.loans l join public.borrowers b on b.id = l.borrower_id where l.id = new.loan_id;
      end if;
      perform app_private.tg_send(
        case when new.action = 'seize' then '🚨 Vehicle seized' else '✅ Vehicle released' end || chr(10) ||
        coalesce(v_name, '?') || ' · Folio ' || coalesce(v_folio, '?') || chr(10) ||
        'Date ' || to_char(new.action_date, 'DD-MM-YYYY') || coalesce(chr(10) || new.remarks, '') || chr(10) ||
        'By ' || app_private.staff_name(new.created_by),
        new.action, 'tg-seize-' || new.id);
    end if;
  exception when others then
    raise warning 'seizure notification failed: %', sqlerrm;
  end;
  return null;
end;
$$;
create trigger seizures_notify after insert on public.seizures for each row execute function app_private.on_seizure();

-- ---------------------------------------------------------------- scheduled: daily summary + due reminders
create or replace function app_private.daily_summary(p_day date, p_dedupe text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_cnt int; v_sum numeric; v_modes text; v_loans int; v_loan_sum numeric; v_seized int; v_released int;
        v_due_cnt int; v_due_sum numeric; v_arr numeric; v_name text;
begin
  select count(*), coalesce(sum(paid_amount), 0) into v_cnt, v_sum from public.payments where paid_date = p_day;
  select string_agg(payment_mode || ' ' || app_private.inr(t), ' · ' order by payment_mode) into v_modes
    from (select payment_mode, sum(paid_amount) t from public.payments where paid_date = p_day group by 1) x;
  select count(*), coalesce(sum(finance_amount), 0) into v_loans, v_loan_sum from public.loans where agreement_date = p_day;
  select count(*) filter (where action = 'seize'), count(*) filter (where action = 'release') into v_seized, v_released
    from public.seizures where action_date = p_day;
  select count(*), coalesce(sum(emi), 0), coalesce(sum(arrears), 0) into v_due_cnt, v_due_sum, v_arr
    from public.due_report(p_day) where next_due = p_day and not seized;
  select business_name into v_name from public.app_settings where id = 1;
  return app_private.tg_send(
    '📊 ' || v_name || ' — ' || to_char(p_day, 'DD Mon YYYY') || chr(10) || chr(10) ||
    '💰 Collected: ' || app_private.inr(v_sum) || ' (' || v_cnt || ' receipts)' ||
      coalesce(chr(10) || '    ' || v_modes, '') || chr(10) ||
    '🆕 New loans: ' || v_loans || coalesce(' · ' || app_private.inr(nullif(v_loan_sum, 0)), '') || chr(10) ||
    '🚨 Seized: ' || v_seized || ' · ✅ Released: ' || v_released || chr(10) ||
    '📅 EMIs due today: ' || v_due_cnt || ' · ' || app_private.inr(v_due_sum),
    'daily_summary', p_dedupe);
end;
$$;

create or replace function app_private.due_reminders(p_day date)
returns int language plpgsql security definer set search_path = '' as $$
declare s public.app_settings; r record; n int := 0; v_target date;
begin
  select * into s from public.app_settings where id = 1;
  v_target := p_day + s.wa_reminder_days_before;
  for r in
    select * from public.due_report(p_day)
     where next_due = v_target and not seized and app_private.wa_number(mobile) is not null
     limit 300
  loop
    if app_private.wa_send(r.mobile,
         app_private.fill(s.wa_reminder_template, jsonb_build_object(
           'name', r.borrower_name, 'folio', r.folio, 'emi', app_private.inr(r.emi), 'due_date', to_char(r.next_due, 'DD-MM-YYYY'),
           'balance', app_private.inr(r.balance), 'arrears', app_private.inr(r.arrears), 'business', s.business_name)),
         'due_reminder', 'wa-due-' || r.source || '-' || r.ref_id || '-' || r.next_due) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Runs every hour at IST :00 (cron is UTC: '30 * * * *' = IST hh:00)
create or replace function app_private.run_hourly()
returns void language plpgsql security definer set search_path = '' as $$
declare s public.app_settings; v_now timestamp := now() at time zone 'Asia/Kolkata'; v_day date := v_now::date; v_hour int := extract(hour from v_now);
begin
  perform app_private.refresh_log();
  select * into s from public.app_settings where id = 1;
  if s.telegram_enabled and s.tg_daily_summary and v_hour = s.tg_summary_hour then
    perform app_private.daily_summary(v_day, 'tg-summary-' || v_day);
  end if;
  if s.whatsapp_enabled and s.wa_due_reminder and v_hour = s.wa_reminder_hour then
    perform app_private.due_reminders(v_day);
  end if;
end;
$$;

select cron.schedule('notifications-hourly', '30 * * * *', $$select app_private.run_hourly()$$);
select cron.schedule('notifications-log-refresh', '*/5 * * * *', $$select app_private.refresh_log()$$);

-- ---------------------------------------------------------------- admin API (called from the Settings page)
create or replace function public.get_notification_settings()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.app_settings;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  select * into s from public.app_settings where id = 1;
  return to_jsonb(s) - 'telegram_bot_token' - 'whatsapp_api_key' || jsonb_build_object(
    'telegram_bot_token', case when s.telegram_bot_token is null then '' else '••••' || right(s.telegram_bot_token, 4) end,
    'whatsapp_api_key',   case when s.whatsapp_api_key   is null then '' else '••••' || right(s.whatsapp_api_key, 4) end);
end;
$$;

create or replace function public.save_notification_settings(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  update public.app_settings set
    business_name           = coalesce(nullif(btrim(p ->> 'business_name'), ''), business_name),
    telegram_enabled        = coalesce((p ->> 'telegram_enabled')::boolean, telegram_enabled),
    -- secrets: masked value coming back = keep; empty = clear; anything else = new value
    telegram_bot_token      = case when p ? 'telegram_bot_token' and (p ->> 'telegram_bot_token') not like '••••%'
                                   then nullif(btrim(p ->> 'telegram_bot_token'), '') else telegram_bot_token end,
    telegram_group_id       = case when p ? 'telegram_group_id' then nullif(btrim(p ->> 'telegram_group_id'), '') else telegram_group_id end,
    tg_on_payment           = coalesce((p ->> 'tg_on_payment')::boolean, tg_on_payment),
    tg_on_new_loan          = coalesce((p ->> 'tg_on_new_loan')::boolean, tg_on_new_loan),
    tg_on_seizure           = coalesce((p ->> 'tg_on_seizure')::boolean, tg_on_seizure),
    tg_daily_summary        = coalesce((p ->> 'tg_daily_summary')::boolean, tg_daily_summary),
    tg_summary_hour         = coalesce((p ->> 'tg_summary_hour')::int, tg_summary_hour),
    whatsapp_enabled        = coalesce((p ->> 'whatsapp_enabled')::boolean, whatsapp_enabled),
    whatsapp_host           = case when p ? 'whatsapp_host' then nullif(btrim(p ->> 'whatsapp_host'), '') else whatsapp_host end,
    whatsapp_api_key        = case when p ? 'whatsapp_api_key' and (p ->> 'whatsapp_api_key') not like '••••%'
                                   then nullif(btrim(p ->> 'whatsapp_api_key'), '') else whatsapp_api_key end,
    wa_receipt              = coalesce((p ->> 'wa_receipt')::boolean, wa_receipt),
    wa_receipt_template     = coalesce(nullif(btrim(p ->> 'wa_receipt_template'), ''), wa_receipt_template),
    wa_due_reminder         = coalesce((p ->> 'wa_due_reminder')::boolean, wa_due_reminder),
    wa_reminder_days_before = coalesce((p ->> 'wa_reminder_days_before')::int, wa_reminder_days_before),
    wa_reminder_hour        = coalesce((p ->> 'wa_reminder_hour')::int, wa_reminder_hour),
    wa_reminder_template    = coalesce(nullif(btrim(p ->> 'wa_reminder_template'), ''), wa_reminder_template),
    updated_at              = now(),
    updated_by              = (select auth.uid())
  where id = 1;
end;
$$;

-- Test messages (admin): return the log id; check the result with notification_result()
create or replace function public.send_test_notification(p_channel text, p_mobile text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare s public.app_settings; v_id bigint; v_txt text;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  select * into s from public.app_settings where id = 1;
  v_txt := '🧪 Test from ' || s.business_name || chr(10) || 'Notifications are working.' || chr(10) ||
           to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI');
  if p_channel = 'telegram' then
    if s.telegram_bot_token is null or s.telegram_group_id is null then raise exception 'save the bot token and group id first' using errcode = '22023'; end if;
    -- test works even while the switch is off
    v_id := app_private.tg_send_force(v_txt);
  elsif p_channel = 'whatsapp' then
    if s.whatsapp_host is null or s.whatsapp_api_key is null then raise exception 'save the WhatsApp host and API key first' using errcode = '22023'; end if;
    if app_private.wa_number(p_mobile) is null then raise exception 'enter a valid 10-digit mobile number' using errcode = '22023'; end if;
    v_id := app_private.wa_send(p_mobile, v_txt, 'test', null, true);
  elsif p_channel = 'summary' then
    if s.telegram_bot_token is null or s.telegram_group_id is null then raise exception 'save the bot token and group id first' using errcode = '22023'; end if;
    v_id := app_private.daily_summary((now() at time zone 'Asia/Kolkata')::date, null);
    if v_id is null then raise exception 'turn Telegram on first' using errcode = '22023'; end if;
  else
    raise exception 'bad channel' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

-- Telegram send that ignores the on/off switch (only used for the test button)
create or replace function app_private.tg_send_force(p_text text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare s public.app_settings; v_req bigint; v_id bigint;
begin
  select * into s from public.app_settings where id = 1;
  v_req := net.http_post(
    url := 'https://api.telegram.org/bot' || s.telegram_bot_token || '/sendMessage',
    body := jsonb_build_object('chat_id', s.telegram_group_id, 'text', p_text),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 15000);
  insert into public.notification_log (channel, event, recipient, message, request_id)
  values ('telegram', 'test', 'staff group', p_text, v_req) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.notification_result(p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.notification_log;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  perform app_private.refresh_log();
  select * into r from public.notification_log where id = p_id;
  return jsonb_build_object('status', r.status, 'detail', r.detail);
end;
$$;

create or replace function public.refresh_notification_log()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  perform app_private.refresh_log();
end;
$$;

revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on function public.get_notification_settings(), public.save_notification_settings(jsonb),
  public.send_test_notification(text, text), public.notification_result(bigint), public.refresh_notification_log() from anon, public;
grant execute on function public.get_notification_settings(), public.save_notification_settings(jsonb),
  public.send_test_notification(text, text), public.notification_result(bigint), public.refresh_notification_log() to authenticated;

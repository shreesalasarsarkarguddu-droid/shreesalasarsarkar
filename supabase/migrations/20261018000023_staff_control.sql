-- Phase 3: staff control.
--   * more permissions: backdate, fix_entries, money, cash, approve, backup, activity
--   * "sign out now": the admin ends a person's sessions; tokens issued before that stop working at once
--   * receipt books: number ranges given to each person; a receipt outside your book is refused
--   * daily cash closing: what each person collected that day (by mode) vs. the cash they handed in
--   * approvals: back-dated / big payments by people without the right are saved but wait for approval

-- ---------------------------------------------------------------- permissions
alter table public.staff drop constraint staff_permissions_check;
alter table public.staff add constraint staff_permissions_check check (permissions <@ array[
  'view_accounts','collect','new_loan','seize','reports','backdate','fix_entries','money','cash','approve','backup','activity']);

create or replace function app_private.clean_perms(p text[])
returns text[] language sql immutable set search_path = '' as $$
  select case when cardinality(x) = 0 then x else (select array_agg(distinct k order by k) from unnest(x || array['view_accounts']) k) end
  from (select coalesce(array(select k from unnest(p) k where k = any (array[
          'view_accounts','collect','new_loan','seize','reports','backdate','fix_entries','money','cash','approve','backup','activity'])), '{}') as x) q;
$$;

-- ---------------------------------------------------------------- sign out now
alter table public.staff add column if not exists force_logout_at timestamptz;

-- true unless the admin signed this person out after their current login token was issued
create or replace function app_private.session_ok(f timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select f is null or coalesce((auth.jwt() ->> 'iat')::bigint, 0) >= floor(extract(epoch from f))::bigint;
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.active and app_private.session_ok(s.force_logout_at));
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.active and s.role = 'admin'
                  and app_private.session_ok(s.force_logout_at));
$$;
create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s
                  where s.user_id = (select auth.uid()) and s.active and app_private.session_ok(s.force_logout_at)
                    and (s.role = 'admin' or p = any (s.permissions)));
$$;

create or replace function public.admin_sign_out_user(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'use Sign out to sign yourself out' using errcode = '22023'; end if;
  update public.staff set force_logout_at = now() where user_id = p_user;
  if not found then raise exception 'user not found' using errcode = '22023'; end if;
  delete from auth.refresh_tokens where user_id = p_user::text;
  delete from auth.sessions where user_id = p_user;
  perform app_private.log('signed_out', (select full_name from public.staff where user_id = p_user), null, '{}');
end;
$$;

-- a new password also ends their current logins at once
create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'password must be at least 8 characters' using errcode = '22023'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = p_user;
  if not found then raise exception 'user not found' using errcode = '22023'; end if;
  if p_user <> (select auth.uid()) then
    update public.staff set force_logout_at = now() where user_id = p_user;
    delete from auth.refresh_tokens where user_id = p_user::text;
    delete from auth.sessions where user_id = p_user;
  end if;
  perform app_private.log('password_reset', (select full_name from public.staff where user_id = p_user), null, '{}');
end;
$$;

-- ---------------------------------------------------------------- fixes / money: their own permissions instead of admin-only
do $$
declare r record; d text;
begin
  for r in select * from (values
      ('public.admin_edit_payment(bigint,jsonb,text)', 'fix_entries'),
      ('public.admin_cancel_payment(bigint,text)',     'fix_entries'),
      ('public.admin_edit_loan(bigint,jsonb,text)',    'fix_entries'),
      ('public.admin_delete_loan(bigint,text,text)',   'fix_entries'),
      ('public.admin_adjust(jsonb)',                   'money'),
      ('public.admin_cancel_adjustment(bigint,text)',  'money')) as v(fn, perm)
  loop
    d := pg_get_functiondef(r.fn::regprocedure);
    if position('if not public.is_admin() then raise exception ''only admin''' in d) = 0 then raise exception 'guard not found in %', r.fn; end if;
    execute replace(replace(d, 'if not public.is_admin() then raise exception ''only admin''',
                               format('if not public.has_perm(%L) then raise exception ''not allowed''', r.perm)),
                    'CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
  end loop;
end $$;

drop policy "admin reads data audit" on public.data_audit;
create policy "read activity" on public.data_audit for select to authenticated using ((select public.has_perm('activity')));

-- ---------------------------------------------------------------- settings for the controls
alter table public.app_settings
  add column if not exists review_backdate_days  int not null default 3 check (review_backdate_days between 0 and 365),
  add column if not exists review_above          numeric(14,2) not null default 0 check (review_above >= 0),
  add column if not exists require_receipt_books boolean not null default false;

create or replace function public.save_notification_settings(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  update public.app_settings set
    business_name           = coalesce(nullif(btrim(p ->> 'business_name'), ''), business_name),
    telegram_enabled        = coalesce((p ->> 'telegram_enabled')::boolean, telegram_enabled),
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
    review_backdate_days    = coalesce((p ->> 'review_backdate_days')::int, review_backdate_days),
    review_above            = coalesce((p ->> 'review_above')::numeric, review_above),
    require_receipt_books   = coalesce((p ->> 'require_receipt_books')::boolean, require_receipt_books),
    updated_at              = now(),
    updated_by              = (select auth.uid())
  where id = 1;
end;
$$;

-- ---------------------------------------------------------------- receipt books
create table public.receipt_books (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.staff (user_id),
  from_no     bigint not null check (from_no > 0),
  to_no       bigint not null,
  issued_on   date not null default ((now() at time zone 'Asia/Kolkata')::date),
  note        text check (length(note) <= 200),
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid not null default auth.uid() references auth.users (id),
  check (to_no >= from_no and to_no - from_no < 10000),
  exclude using gist (int8range(from_no, to_no, '[]') with &&)
);
alter table public.receipt_books enable row level security;
create policy "read receipt books" on public.receipt_books for select to authenticated
  using ((select public.has_perm('cash')) or user_id = (select auth.uid()));
revoke all on public.receipt_books from anon;
revoke insert, update, delete, truncate on public.receipt_books from authenticated;
grant select on public.receipt_books to authenticated;

create or replace function public.admin_receipt_book(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
-- p = { action: add | close | reopen | delete, id, user_id, from_no, to_no, note }
declare b public.receipt_books; v_id bigint; v_name text;
begin
  if not public.has_perm('cash') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p ->> 'action' = 'add' then
    if not exists (select 1 from public.staff where user_id = (p ->> 'user_id')::uuid) then raise exception 'choose the person' using errcode = '22023'; end if;
    if (p ->> 'from_no')::bigint is null or (p ->> 'to_no')::bigint is null or (p ->> 'to_no')::bigint < (p ->> 'from_no')::bigint then
      raise exception 'enter the first and last receipt number' using errcode = '22023';
    end if;
    if (p ->> 'to_no')::bigint - (p ->> 'from_no')::bigint >= 10000 then raise exception 'a book can have at most 10,000 receipts' using errcode = '22023'; end if;
    begin
      insert into public.receipt_books (user_id, from_no, to_no, note)
      values ((p ->> 'user_id')::uuid, (p ->> 'from_no')::bigint, (p ->> 'to_no')::bigint, nullif(btrim(p ->> 'note'), ''))
      returning * into b;
    exception when exclusion_violation then
      raise exception 'these numbers overlap another receipt book' using errcode = '22023';
    end;
    v_id := b.id;
  else
    select * into b from public.receipt_books where id = (p ->> 'id')::bigint for update;
    if not found then raise exception 'receipt book not found' using errcode = 'P0002'; end if;
    v_id := b.id;
    if p ->> 'action' = 'close' then update public.receipt_books set closed_at = now() where id = b.id;
    elsif p ->> 'action' = 'reopen' then update public.receipt_books set closed_at = null where id = b.id;
    elsif p ->> 'action' = 'delete' then
      if exists (select 1 from public.payments where receipt_no between b.from_no and b.to_no) then
        raise exception 'receipts from this book are already used; close it instead' using errcode = '22023';
      end if;
      delete from public.receipt_books where id = b.id;
    else raise exception 'bad action' using errcode = '22023';
    end if;
  end if;
  select full_name into v_name from public.staff where user_id = b.user_id;
  perform app_private.log('book_' || (p ->> 'action'), v_name, null,
    jsonb_build_object('from_no', b.from_no, 'to_no', b.to_no, 'note', b.note));
  return jsonb_build_object('id', v_id);
end;
$$;

-- every book with its use: how many receipts used, the last one, and numbers skipped below the last one
create or replace function public.receipt_book_status()
returns table (id bigint, user_id uuid, full_name text, from_no bigint, to_no bigint, issued_on date, note text, closed boolean,
               used int, last_used bigint, skipped bigint[], skipped_count int)
language sql stable security definer set search_path = '' as $$
  select b.id, b.user_id, s.full_name, b.from_no, b.to_no, b.issued_on, b.note, b.closed_at is not null,
         u.used, u.last_used,
         (select array_agg(n order by n) from (select n from generate_series(b.from_no, coalesce(u.last_used, b.from_no - 1)) n
                                               where not exists (select 1 from public.payments p where p.receipt_no = n) limit 50) z),
         (select count(*)::int from generate_series(b.from_no, coalesce(u.last_used, b.from_no - 1)) n
           where not exists (select 1 from public.payments p where p.receipt_no = n))
    from public.receipt_books b
    join public.staff s on s.user_id = b.user_id
    cross join lateral (select count(*)::int as used, max(p.receipt_no) as last_used
                          from public.payments p where p.receipt_no between b.from_no and b.to_no) u
   where public.has_perm('cash') or b.user_id = (select auth.uid())
   order by b.closed_at is not null, s.full_name, b.from_no;
$$;

-- ---------------------------------------------------------------- approvals: columns on payments
alter table public.payments
  add column if not exists review_reason text,
  add column if not exists reviewed_by   uuid references auth.users (id),
  add column if not exists reviewed_at   timestamptz;
create index if not exists payments_review_idx on public.payments (created_at) where review_reason is not null and reviewed_at is null;

-- record_payment: receipt book check + approval flag (rest as before)
create or replace function public.record_payment(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key      uuid    := (p->>'idempotency_key')::uuid;
  v_source   text    := p->>'source';
  v_ref      bigint  := (p->>'ref_id')::bigint;
  v_amount   numeric := (p->>'paid_amount')::numeric;
  v_date     date    := (p->>'paid_date')::date;
  v_im       int     := coalesce((p->>'installments_covered')::int, 1);
  v_rno      bigint  := (p->>'receipt_no')::bigint;
  v_today    date    := (now() at time zone 'Asia/Kolkata')::date;
  s          public.app_settings;
  v_book     public.receipt_books;
  v_review   text;
  v_acct     bigint;
  v_loan     bigint;
  v_total    numeric;
  v_emi      numeric;
  v_interval int;
  v_start    date;
  v_paid     numeric;
  v_next     int;
  v_used     int;
  v_last_due date;
  v_last_im  int;
  v_due      date;
  v_row      public.payments;
begin
  if not public.has_perm('collect') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_row from public.payments where idempotency_key = v_key;
  if found then
    return jsonb_build_object('id', v_row.id, 'receipt_no', v_row.receipt_no, 'installment_no', v_row.installment_no,
                              'balance_after', v_row.balance_after, 'review', v_row.review_reason, 'replayed', true);
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'amount must be more than 0' using errcode = '22023';
  end if;
  if v_date is null or v_date > v_today then
    raise exception 'paid date cannot be in the future' using errcode = '22023';
  end if;
  if v_im < 1 or v_im > 360 then
    raise exception 'EMIs covered must be 1 or more' using errcode = '22023';
  end if;

  -- receipt books
  select * into s from public.app_settings where id = 1;
  select * into v_book from public.receipt_books where closed_at is null and int8range(from_no, to_no, '[]') @> v_rno;
  if found and v_book.user_id <> auth.uid() then
    raise exception 'receipt no. % belongs to %''s receipt book', v_rno, app_private.staff_name(v_book.user_id) using errcode = '22023';
  elsif not found and exists (select 1 from public.receipt_books where user_id = auth.uid() and closed_at is null) then
    raise exception 'receipt no. % is not in your receipt book (%)', v_rno,
      (select string_agg(from_no || '–' || to_no, ', ' order by from_no) from public.receipt_books where user_id = auth.uid() and closed_at is null)
      using errcode = '22023';
  elsif not found and s.require_receipt_books and not public.is_admin() then
    raise exception 'you have no receipt book; ask the admin to give you one' using errcode = '22023';
  end if;

  -- needs approval?
  if v_date < v_today - s.review_backdate_days and not public.has_perm('backdate') then
    v_review := 'back-dated ' || (v_today - v_date) || ' days';
  end if;
  if s.review_above > 0 and v_amount > s.review_above and not public.has_perm('approve') then
    v_review := concat_ws(' · ', v_review, 'more than ' || app_private.inr(s.review_above));
  end if;

  perform pg_advisory_xact_lock(hashtext('payment:' || v_source || ':' || v_ref));

  if v_source = 'old' then
    select id, total_amount, emi_amount, greatest(coalesce(interval_months, 1), 1), agreement_date
      into v_acct, v_total, v_emi, v_interval, v_start
      from public.legacy_accounts where sno = v_ref and ledger = 'pending';
    if not found or public.legacy_settled(v_acct) then raise exception 'account not found or not pending' using errcode = 'P0002'; end if;

    create temp table _r on commit drop as
      select installment_no n, due_date d, paid_amount amt,
             case when v_emi > 0 then greatest(1, round(paid_amount / v_emi))::int else 1 end im
        from public.legacy_payments where account_id = v_acct and ledger = 'pending'
      union all
      select installment_no, due_date, paid_amount, installments_covered
        from public.payments where legacy_account_id = v_acct;
  elsif v_source = 'new' then
    select id, total_amount, emi_amount, interval_months, agreement_date
      into v_loan, v_total, v_emi, v_interval, v_start
      from public.loans where id = v_ref and status in ('active', 'seized');
    if not found then raise exception 'loan not found or closed' using errcode = 'P0002'; end if;

    create temp table _r on commit drop as
      select installment_no n, due_date d, paid_amount amt, installments_covered im
        from public.payments where loan_id = v_loan;
  else
    raise exception 'bad source' using errcode = '22023';
  end if;

  select coalesce(sum(amt), 0), coalesce(max(n), 0), coalesce(sum(im), 0) into v_paid, v_next, v_used from _r;
  select d, im into v_last_due, v_last_im from _r where d is not null order by n desc limit 1;
  drop table _r;

  v_next := v_next + 1;
  v_total := v_total + public.adj_total(v_acct, v_loan);
  v_due := app_private.next_due_date(v_acct, v_loan, v_interval, v_start, v_used, v_last_due, v_last_im,
                                     app_private.paid_since_reschedule(v_acct, v_loan));
  if (app_private.active_reschedule(v_acct, v_loan)).id is not null then v_emi := (app_private.active_reschedule(v_acct, v_loan)).new_emi; end if;

  insert into public.payments (legacy_account_id, loan_id, installment_no, due_date, due_amount, paid_amount, paid_date,
                               payment_mode, reference_no, bank_name, receipt_no, balance_after, delay_days,
                               installments_covered, idempotency_key, review_reason)
  values (v_acct, v_loan, v_next, v_due, v_emi, v_amount, v_date,
          p->>'payment_mode', nullif(btrim(p->>'reference_no'), ''), nullif(btrim(p->>'bank_name'), ''),
          v_rno, v_total - v_paid - v_amount, v_date - v_due, v_im, v_key, v_review)
  returning * into v_row;

  if v_review is not null then
    perform app_private.tg_quiet(s.tg_on_payment,
      '⚠️ Payment needs approval' || chr(10) || coalesce(app_private.acct_ref(v_acct, v_loan) ->> 'subject', '?') || chr(10) ||
      app_private.inr(v_amount) || ' · Rcpt ' || v_rno || ' · paid ' || to_char(v_date, 'DD-MM-YYYY') || chr(10) ||
      'Why: ' || v_review || chr(10) || 'By ' || app_private.staff_name(auth.uid()),
      'payment_review');
  end if;

  return jsonb_build_object('id', v_row.id, 'receipt_no', v_row.receipt_no, 'installment_no', v_row.installment_no,
                            'balance_after', v_row.balance_after, 'review', v_review, 'replayed', false);
exception
  when unique_violation then
    select * into v_row from public.payments where idempotency_key = v_key;
    if found then
      return jsonb_build_object('id', v_row.id, 'receipt_no', v_row.receipt_no, 'installment_no', v_row.installment_no,
                                'balance_after', v_row.balance_after, 'review', v_row.review_reason, 'replayed', true);
    end if;
    raise;
end;
$$;
revoke execute on function public.record_payment(jsonb) from anon, public;
grant execute on function public.record_payment(jsonb) to authenticated;

-- payments waiting for approval
create or replace function public.pending_approvals()
returns table (id bigint, subject text, source text, ref_id bigint, paid_amount numeric, paid_date date, receipt_no bigint,
               payment_mode text, reason text, by_name text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, r ->> 'subject', r ->> 'source', (r ->> 'ref_id')::bigint, p.paid_amount, p.paid_date, p.receipt_no,
         p.payment_mode, p.review_reason, app_private.staff_name(p.created_by), p.created_at
    from public.payments p
    cross join lateral (select app_private.acct_ref(p.legacy_account_id, p.loan_id) r) x
   where p.review_reason is not null and p.reviewed_at is null and public.has_perm('approve')
   order by p.created_at;
$$;

-- cancelling a payment, shared by "cancel payment" (fix_entries) and "reject" (approve)
create or replace function app_private.cancel_payment_core(p_id bigint, p_reason text, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.payments; r jsonb;
begin
  select * into o from public.payments where id = p_id;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  perform app_private.payment_lock(o);
  select * into o from public.payments where id = p_id for update;
  r := app_private.acct_ref(o.legacy_account_id, o.loan_id);
  delete from public.payments where id = p_id;
  perform app_private.reflow_payments(o.legacy_account_id, o.loan_id);
  perform app_private.log(p_action, r ->> 'subject', r - 'subject',
    jsonb_build_object('reason', p_reason, 'receipt_no', o.receipt_no, 'amount', o.paid_amount, 'paid_date', o.paid_date,
                       'payment', to_jsonb(o)));
  perform app_private.tg_quiet((select tg_on_payment from public.app_settings where id = 1),
    case when p_action = 'payment_rejected' then '⛔ Payment rejected' else '❌ Payment cancelled' end || chr(10) ||
    coalesce(r ->> 'subject', '?') || chr(10) ||
    'Rcpt ' || o.receipt_no || ' · ' || app_private.inr(o.paid_amount) || ' on ' || to_char(o.paid_date, 'DD-MM-YYYY') || chr(10) ||
    'Reason: ' || p_reason || chr(10) || 'By ' || app_private.staff_name((select auth.uid())),
    p_action);
end;
$$;

create or replace function public.admin_cancel_payment(p_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reason text := app_private.need_reason(p_reason);
begin
  if not public.has_perm('fix_entries') then raise exception 'not allowed' using errcode = '42501'; end if;
  perform app_private.cancel_payment_core(p_id, v_reason, 'payment_cancelled');
  return jsonb_build_object('cancelled', p_id);
end;
$$;

create or replace function public.review_payment(p_id bigint, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.payments; r jsonb;
begin
  if not public.has_perm('approve') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into o from public.payments where id = p_id for update;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if o.review_reason is null or o.reviewed_at is not null then raise exception 'this payment is not waiting for approval' using errcode = '22023'; end if;
  if p_approve then
    update public.payments set reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
    r := app_private.acct_ref(o.legacy_account_id, o.loan_id);
    perform app_private.log('payment_approved', r ->> 'subject', r - 'subject',
      jsonb_build_object('receipt_no', o.receipt_no, 'amount', o.paid_amount, 'why', o.review_reason, 'note', nullif(btrim(p_note), '')));
  else
    perform app_private.cancel_payment_core(p_id, app_private.need_reason(p_note), 'payment_rejected');
  end if;
  return jsonb_build_object('id', p_id, 'approved', p_approve);
end;
$$;

-- ---------------------------------------------------------------- daily cash closing
create table public.cash_closings (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references public.staff (user_id),
  day              date not null,
  receipts         int not null,
  expected_cash    numeric(14,2) not null,
  expected_other   numeric(14,2) not null,
  received_amount  numeric(14,2) not null check (received_amount >= 0),
  note             text check (length(note) <= 300),
  received_by      uuid not null default auth.uid() references auth.users (id),
  received_at      timestamptz not null default now(),
  unique (user_id, day)
);
alter table public.cash_closings enable row level security;
create policy "read cash closings" on public.cash_closings for select to authenticated
  using ((select public.has_perm('cash')) or user_id = (select auth.uid()));
revoke all on public.cash_closings from anon;
revoke insert, update, delete, truncate on public.cash_closings from authenticated;
grant select on public.cash_closings to authenticated;

-- What each person collected on a day (by the day they entered it), and what they handed in.
-- People with the cash permission see everyone; others only themselves.
create or replace function public.cash_day(p_day date)
returns table (user_id uuid, full_name text, receipts int, cash numeric, cheque numeric, sbi numeric, bank numeric, total numeric,
               closed boolean, received_amount numeric, expected_at_close numeric, note text, received_by text, received_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with pay as (
    select p.created_by as uid, count(*)::int as n,
           sum(p.paid_amount) filter (where p.payment_mode = 'CASH')   as cash,
           sum(p.paid_amount) filter (where p.payment_mode = 'CHEQUE') as cheque,
           sum(p.paid_amount) filter (where p.payment_mode = 'SBI')    as sbi,
           sum(p.paid_amount) filter (where p.payment_mode = 'BANK')   as bank,
           sum(p.paid_amount) as total
      from public.payments p
     where (p.created_at at time zone 'Asia/Kolkata')::date = p_day
     group by p.created_by
  ),
  people as (select uid from pay union select c.user_id from public.cash_closings c where c.day = p_day)
  select s.user_id, s.full_name, coalesce(pay.n, 0), coalesce(pay.cash, 0), coalesce(pay.cheque, 0), coalesce(pay.sbi, 0),
         coalesce(pay.bank, 0), coalesce(pay.total, 0),
         c.id is not null, c.received_amount, c.expected_cash, c.note, app_private.staff_name(c.received_by), c.received_at
    from people
    join public.staff s on s.user_id = people.uid
    left join pay on pay.uid = people.uid
    left join public.cash_closings c on c.user_id = people.uid and c.day = p_day
   where public.has_perm('cash') or (public.has_perm('collect') and s.user_id = (select auth.uid()))
   order by s.full_name;
$$;

create or replace function public.cash_receive(p_user uuid, p_day date, p_amount numeric, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n int; v_cash numeric; v_other numeric; v_name text; v_short numeric;
begin
  if not public.has_perm('cash') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'enter the cash received' using errcode = '22023'; end if;
  if p_day > (now() at time zone 'Asia/Kolkata')::date then raise exception 'the day cannot be in the future' using errcode = '22023'; end if;
  select count(*), coalesce(sum(paid_amount) filter (where payment_mode = 'CASH'), 0), coalesce(sum(paid_amount) filter (where payment_mode <> 'CASH'), 0)
    into v_n, v_cash, v_other
    from public.payments where created_by = p_user and (created_at at time zone 'Asia/Kolkata')::date = p_day;
  insert into public.cash_closings (user_id, day, receipts, expected_cash, expected_other, received_amount, note)
  values (p_user, p_day, v_n, v_cash, v_other, p_amount, nullif(btrim(p_note), ''))
  on conflict (user_id, day) do update
     set receipts = excluded.receipts, expected_cash = excluded.expected_cash, expected_other = excluded.expected_other,
         received_amount = excluded.received_amount, note = excluded.note, received_by = auth.uid(), received_at = now();
  v_name := app_private.staff_name(p_user);
  v_short := v_cash - p_amount;
  perform app_private.log('cash_received', v_name, null,
    jsonb_build_object('day', p_day, 'expected_cash', v_cash, 'received', p_amount, 'short', v_short, 'receipts', v_n, 'note', nullif(btrim(p_note), '')));
  perform app_private.tg_quiet((select tg_on_payment from public.app_settings where id = 1),
    '💵 Cash handed in · ' || v_name || ' · ' || to_char(p_day, 'DD-MM-YYYY') || chr(10) ||
    'Collected in cash ' || app_private.inr(v_cash) || ' (' || v_n || ' receipts)' || chr(10) ||
    'Received ' || app_private.inr(p_amount) ||
    case when v_short > 0 then ' · SHORT ' || app_private.inr(v_short) when v_short < 0 then ' · extra ' || app_private.inr(-v_short) else ' · matches' end || chr(10) ||
    'By ' || app_private.staff_name(auth.uid()),
    'cash_received');
  return jsonb_build_object('short', v_short);
end;
$$;

-- ---------------------------------------------------------------- restore points keep the new tables too
create or replace function app_private.data_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['import_batches','legacy_accounts','legacy_payments','borrowers','loans','payments','seizures','adjustments',
               'receipt_books','cash_closings'];
$$;

revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on function public.admin_sign_out_user(uuid), public.admin_receipt_book(jsonb), public.receipt_book_status(),
  public.pending_approvals(), public.review_payment(bigint, boolean, text), public.cash_day(date),
  public.cash_receive(uuid, date, numeric, text), public.admin_cancel_payment(bigint, text) from anon, public;
grant execute on function public.admin_sign_out_user(uuid), public.admin_receipt_book(jsonb), public.receipt_book_status(),
  public.pending_approvals(), public.review_payment(bigint, boolean, text), public.cash_day(date),
  public.cash_receive(uuid, date, numeric, text), public.admin_cancel_payment(bigint, text) to authenticated;

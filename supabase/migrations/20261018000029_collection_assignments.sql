-- Collection assignments: the admin (or anyone with "assign") gives accounts to a collection man for a day.
-- The collection man sees his list for the day with dues, address and phone, and collects from it.
-- Optional rule (Settings → Staff controls): people without "assign" may only take payments for accounts
-- assigned to them for today.

-- ---------------------------------------------------------------- permission
alter table public.staff drop constraint staff_permissions_check;
alter table public.staff add constraint staff_permissions_check check (permissions <@ array[
  'view_accounts','collect','new_loan','seize','reports','backdate','fix_entries','money','cash','approve','backup','activity','assign']);

create or replace function app_private.clean_perms(p text[])
returns text[] language sql immutable set search_path = '' as $$
  select case when cardinality(x) = 0 then x else (select array_agg(distinct k order by k) from unnest(x || array['view_accounts']) k) end
  from (select coalesce(array(select k from unnest(p) k where k = any (array[
          'view_accounts','collect','new_loan','seize','reports','backdate','fix_entries','money','cash','approve','backup','activity','assign'])), '{}') as x) q;
$$;

-- ---------------------------------------------------------------- table
create table public.collection_assignments (
  id          bigint generated always as identity primary key,
  day         date not null,
  user_id     uuid not null references public.staff (user_id),
  source      text not null check (source in ('old', 'new')),
  ref_id      bigint not null,                -- SNO for old accounts, loan id for new loans
  note        text check (length(note) <= 200),
  created_by  uuid not null default auth.uid() references auth.users (id),
  created_at  timestamptz not null default now(),
  unique (day, source, ref_id)                -- one collection man per account per day
);
create index collection_assignments_user_day_idx on public.collection_assignments (user_id, day);
alter table public.collection_assignments enable row level security;
create policy "read assignments" on public.collection_assignments for select to authenticated
  using ((select public.has_perm('assign')) or user_id = (select auth.uid()));
revoke all on public.collection_assignments from anon;
revoke insert, update, delete, truncate on public.collection_assignments from authenticated;
grant select on public.collection_assignments to authenticated;

alter table public.app_settings add column if not exists restrict_to_assigned boolean not null default false;

-- ---------------------------------------------------------------- assign / remove
-- p_items = [{source, ref_id}, ...]; an account already given to someone else that day moves to this person
create or replace function public.assign_collections(p_day date, p_user uuid, p_items jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n int; v_moved int; v_name text;
begin
  if not public.has_perm('assign') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_day is null or p_day < (now() at time zone 'Asia/Kolkata')::date - 1 then raise exception 'choose today or a later day' using errcode = '22023'; end if;
  if not exists (select 1 from public.staff where user_id = p_user and active and (role = 'admin' or 'collect' = any (permissions))) then
    raise exception 'this person cannot collect payments (give them "Collect payments" first)' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'choose at least one account' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'at most 500 accounts at once' using errcode = '22023'; end if;

  select count(*) into v_moved
    from public.collection_assignments c
    join jsonb_to_recordset(p_items) as i(source text, ref_id bigint) on i.source = c.source and i.ref_id = c.ref_id
   where c.day = p_day and c.user_id <> p_user;

  insert into public.collection_assignments (day, user_id, source, ref_id, note)
  select p_day, p_user, i.source, i.ref_id, nullif(btrim(p_note), '')
    from jsonb_to_recordset(p_items) as i(source text, ref_id bigint)
   where i.source in ('old', 'new') and i.ref_id is not null
  on conflict (day, source, ref_id) do update
     set user_id = excluded.user_id, note = coalesce(excluded.note, public.collection_assignments.note),
         created_by = auth.uid(), created_at = now();
  get diagnostics v_n = row_count;

  v_name := app_private.staff_name(p_user);
  perform app_private.log('assigned', v_name, null, jsonb_build_object('day', p_day, 'accounts', v_n, 'moved_from_others', v_moved));
  return jsonb_build_object('assigned', v_n, 'moved', v_moved);
end;
$$;

create or replace function public.unassign_collections(p_ids bigint[])
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if not public.has_perm('assign') then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.collection_assignments where id = any (p_ids);
  get diagnostics v_n = row_count;
  perform app_private.log('unassigned', null, null, jsonb_build_object('removed', v_n));
  return v_n;
end;
$$;

-- ---------------------------------------------------------------- the list for a day
-- p_user null = everyone (needs "assign"); otherwise one person (yourself, or anyone with "assign").
create or replace function public.collection_list(p_day date, p_user uuid default null)
returns table (id bigint, user_id uuid, collector text, source text, ref_id bigint, folio text, borrower_name text, mobile text,
               address text, vehicle text, emi numeric, balance numeric, arrears numeric, overdue_emis integer, next_due date,
               seized boolean, closed boolean, collected numeric, receipts int, note text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_perm('collect') and not public.has_perm('assign') then raise exception 'not allowed' using errcode = '42501'; end if;
  if (p_user is null or p_user <> auth.uid()) and not public.has_perm('assign') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  with a as (
    select c.* from public.collection_assignments c where c.day = p_day and (p_user is null or c.user_id = p_user)
  ),
  due as (select d.* from public.due_report(p_day) d where (d.source, d.ref_id) in (select a.source, a.ref_id from a)),
  paid as (  -- collected for these accounts on that day (by anyone)
    select case when p.loan_id is null then 'old' else 'new' end as src,
           coalesce((select la.sno::bigint from public.legacy_accounts la where la.id = p.legacy_account_id), p.loan_id) as ref,
           sum(p.paid_amount) as amt, count(*)::int as n
      from public.payments p
     where (p.created_at at time zone 'Asia/Kolkata')::date = p_day
     group by 1, 2
  )
  select a.id, a.user_id, app_private.staff_name(a.user_id), a.source, a.ref_id,
         coalesce(d.folio, la.fno::text, l.folio_no),
         coalesce(d.borrower_name, la.borrower_name, b.full_name),
         coalesce(d.mobile, nullif(concat_ws(', ', la.borrower_mobile, la.borrower_mobile2), ''), b.mobile),
         coalesce(la.borrower_address, b.address),
         coalesce(nullif(concat_ws(' · ', coalesce(la.vehicle_model, l.vehicle_model), coalesce(la.registration_no, l.vehicle_no)), ''), null),
         d.emi, d.balance, d.arrears, d.overdue_emis, d.next_due, coalesce(d.seized, false), d.source is null,
         coalesce(pd.amt, 0), coalesce(pd.n, 0), a.note
    from a
    left join due d on d.source = a.source and d.ref_id = a.ref_id
    left join public.legacy_accounts la on a.source = 'old' and la.sno = a.ref_id
    left join public.loans l on a.source = 'new' and l.id = a.ref_id
    left join public.borrowers b on b.id = l.borrower_id
    left join paid pd on pd.src = a.source and pd.ref = a.ref_id
   order by app_private.staff_name(a.user_id), coalesce(d.arrears, 0) desc, a.id;
end;
$$;
alter function public.collection_list(date, uuid) set statement_timeout = '30s';

-- accounts to choose from on the Assign page: everything pending, with who has it that day
create or replace function public.assign_candidates(p_day date, p_q text, p_filter text)
returns table (source text, ref_id bigint, folio text, borrower_name text, mobile text, address text, emi numeric, balance numeric,
               arrears numeric, overdue_emis integer, next_due date, seized boolean, assigned_to text)
language plpgsql security definer set search_path = '' as $$
declare v_q text := lower(btrim(coalesce(p_q, '')));
begin
  if not public.has_perm('assign') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select d.source, d.ref_id, d.folio, d.borrower_name, d.mobile, coalesce(la.borrower_address, b.address),
         d.emi, d.balance, d.arrears, d.overdue_emis, d.next_due, d.seized, app_private.staff_name(c.user_id)
    from public.due_report(p_day) d
    left join public.legacy_accounts la on d.source = 'old' and la.sno = d.ref_id
    left join public.loans l on d.source = 'new' and l.id = d.ref_id
    left join public.borrowers b on b.id = l.borrower_id
    left join public.collection_assignments c on c.day = p_day and c.source = d.source and c.ref_id = d.ref_id
   where d.balance > 0
     and (v_q = '' or d.search_text like '%' || v_q || '%' or lower(coalesce(la.borrower_address, b.address, '')) like '%' || v_q || '%')
     and case p_filter
           when 'due_day' then d.next_due = p_day
           when 'overdue' then d.arrears > 0
           when 'overdue3' then d.overdue_emis >= 3
           when 'week' then d.next_due between p_day and p_day + 6
           when 'unassigned' then c.id is null
           else true end
     and (p_filter = 'all' or not d.seized)
   order by d.arrears desc, d.next_due nulls last
   limit 300;
end;
$$;
alter function public.assign_candidates(date, text, text) set statement_timeout = '30s';

-- ---------------------------------------------------------------- settings: the "only assigned" rule
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
    restrict_to_assigned    = coalesce((p ->> 'restrict_to_assigned')::boolean, restrict_to_assigned),
    updated_at              = now(),
    updated_by              = (select auth.uid())
  where id = 1;
end;
$$;

-- record_payment: + the "only assigned accounts" rule (everything else as in staff_control)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.record_payment(jsonb)'::regprocedure);
  if position('-- needs approval?' in d) = 0 then raise exception 'record_payment marker not found'; end if;
  execute replace(d, '-- needs approval?',
    '-- only accounts assigned to you today?
  if s.restrict_to_assigned and not public.has_perm(''assign'')
     and not exists (select 1 from public.collection_assignments ca
                      where ca.day = v_today and ca.user_id = auth.uid() and ca.source = v_source and ca.ref_id = v_ref) then
    raise exception ''this account is not in your collection list for today; ask the admin to assign it'' using errcode = ''22023'';
  end if;

  -- needs approval?');
end $$;

-- ---------------------------------------------------------------- restore points / backups include it
create or replace function app_private.data_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['import_batches','legacy_accounts','legacy_payments','borrowers','loans','payments','seizures','adjustments',
               'receipt_books','cash_closings','collection_assignments'];
$$;

revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on function public.assign_collections(date, uuid, jsonb, text), public.unassign_collections(bigint[]),
  public.collection_list(date, uuid), public.assign_candidates(date, text, text) from anon, public;
grant execute on function public.assign_collections(date, uuid, jsonb, text), public.unassign_collections(bigint[]),
  public.collection_list(date, uuid), public.assign_candidates(date, text, text) to authenticated;

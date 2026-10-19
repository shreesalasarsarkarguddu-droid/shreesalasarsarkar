-- Dashboard: remember the numbers for 60 seconds (the full due calculation over every account takes ~0.3 s).
-- Runs as definer now (it needs the cache table); the permission check stays first: reports + view accounts.

create table if not exists app_private.dashboard_cache (
  day          date primary key,
  data         jsonb not null,
  computed_at  timestamptz not null
);

CREATE OR REPLACE FUNCTION public.dashboard(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
declare
  m0 date := date_trunc('month', p_day)::date;            -- first day of this month
  y0 date := (date_trunc('month', p_day) - interval '11 months')::date;
  pm_to date := (p_day - interval '1 month')::date;      -- same day last month
  v jsonb;
begin
  if not (public.has_perm('reports') and public.has_perm('view_accounts')) then raise exception 'not allowed' using errcode = '42501'; end if;

  -- the same numbers for everyone for up to a minute: the full calculation (all accounts' dues) runs at most once a minute
  select c.data into v from app_private.dashboard_cache c where c.day = p_day and c.computed_at > now() - interval '60 seconds';
  if found then return v; end if;

  create temp table _due on commit drop as select * from public.due_report(p_day);
  create temp table _rec on commit drop as
    select entry_date, debit, mode from public.day_book_entries where kind = 'receipt' and entry_date between y0 - 31 and p_day;
  create temp table _lent on commit drop as
    select entry_date, credit from public.day_book_entries where kind = 'loan' and entry_date between y0 and p_day;

  select jsonb_build_object(
    'day', p_day,
    'today', (select jsonb_build_object('amount', coalesce(sum(debit), 0), 'count', count(*)) from _rec where entry_date = p_day),
    'today_modes', (select coalesce(jsonb_object_agg(mode, s), '{}') from (select mode, sum(debit) s from _rec where entry_date = p_day group by mode) x),
    'yesterday', (select coalesce(sum(debit), 0) from _rec where entry_date = p_day - 1),
    'month', (select jsonb_build_object('amount', coalesce(sum(debit), 0), 'count', count(*)) from _rec where entry_date between m0 and p_day),
    'last_month_same_days', (select coalesce(sum(debit), 0) from _rec
                               where entry_date between (m0 - interval '1 month')::date and pm_to),
    'months', (select jsonb_agg(jsonb_build_object('month', to_char(mm, 'YYYY-MM'),
                         'collected', coalesce((select sum(debit) from _rec where date_trunc('month', entry_date) = mm), 0),
                         'lent', coalesce((select sum(credit) from _lent where date_trunc('month', entry_date) = mm), 0)) order by mm)
                 from generate_series(y0::timestamp, m0::timestamp, interval '1 month') mm),
    'new_loans_month', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(credit), 0)) from _lent where entry_date between m0 and p_day),
    'outstanding', (select jsonb_build_object(
                        'balance', coalesce(sum(greatest(balance, 0)), 0),
                        'accounts', count(*) filter (where balance > 0),
                        'arrears', coalesce(sum(arrears), 0),
                        'overdue_accounts', count(*) filter (where arrears > 0),
                        'overdue_3', count(*) filter (where overdue_emis >= 3)) from _due),
    'due_today', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(emi), 0)) from _due where next_due = p_day and not seized),
    'due_week', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(emi), 0)) from _due where next_due between p_day and p_day + 6 and not seized),
    'seized', (select jsonb_build_object('count', count(*), 'balance', coalesce(sum(balance), 0)) from public.seized_accounts),
    'top_overdue', (select coalesce(jsonb_agg(to_jsonb(t) order by t.arrears desc), '[]') from (
                      select source, ref_id, folio, borrower_name, mobile, arrears, overdue_emis, balance
                        from _due where arrears > 0 and not seized order by arrears desc limit 10) t),
    'pending_approvals', (select count(*) from public.pending_payments),
    'cash_open', (select count(distinct p.created_by) from public.payments p
                   where (p.created_at at time zone 'Asia/Kolkata')::date between p_day - 6 and p_day
                     and public.mode_part(p.payment_mode, p.paid_amount, p.parts, 'CASH') > 0
                     and not exists (select 1 from public.cash_closings c
                                      where c.user_id = p.created_by and c.day = (p.created_at at time zone 'Asia/Kolkata')::date))
  ) into v;
  insert into app_private.dashboard_cache (day, data, computed_at) values (p_day, v, now())
  on conflict (day) do update set data = excluded.data, computed_at = excluded.computed_at;
  delete from app_private.dashboard_cache where day < p_day - 7;
  return v;
end;
$function$;

revoke execute on function public.dashboard(date) from anon, public;
grant execute on function public.dashboard(date) to authenticated;

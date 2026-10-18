-- Phase 4: owner view.
--   dashboard(day)                 everything on one screen (needs the reports permission)
--   staff_performance(from, to)    per person: receipts, money collected, loans, seizures, cash short, fixes
--                                  (needs the cash permission; old-software receipts have no person, so only app work counts)

create or replace function public.dashboard(p_day date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  m0 date := date_trunc('month', p_day)::date;            -- first day of this month
  y0 date := (date_trunc('month', p_day) - interval '11 months')::date;
  pm_to date := (p_day - interval '1 month')::date;      -- same day last month
  v jsonb;
begin
  if not public.has_perm('reports') then raise exception 'not allowed' using errcode = '42501'; end if;

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
    'pending_approvals', (select count(*) from public.payments where review_reason is not null and reviewed_at is null),
    'cash_open', (select count(distinct p.created_by) from public.payments p
                   where (p.created_at at time zone 'Asia/Kolkata')::date between p_day - 6 and p_day
                     and p.payment_mode = 'CASH'
                     and not exists (select 1 from public.cash_closings c
                                      where c.user_id = p.created_by and c.day = (p.created_at at time zone 'Asia/Kolkata')::date))
  ) into v;
  return v;
end;
$$;
alter function public.dashboard(date) set statement_timeout = '30s';

create or replace function public.staff_performance(p_from date, p_to date)
returns table (user_id uuid, full_name text, active boolean, receipts int, collected numeric, cash numeric,
               loans int, lent numeric, seized int, released int, cash_expected numeric, cash_received numeric, cash_short numeric,
               days_open int, late_fees numeric, fixes int, last_receipt timestamptz)
language sql stable security definer set search_path = '' as $$
  with p as (
    select created_by uid, count(*)::int n, sum(paid_amount) amt, sum(paid_amount) filter (where payment_mode = 'CASH') cash, max(created_at) last
      from public.payments where (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by 1),
  l as (select created_by uid, count(*)::int n, sum(finance_amount) amt from public.loans
         where (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by 1),
  s as (select created_by uid, count(*) filter (where action = 'seize')::int sz, count(*) filter (where action = 'release')::int rl
          from public.seizures where (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by 1),
  c as (select user_id uid, sum(expected_cash) exp, sum(received_amount) rec from public.cash_closings where day between p_from and p_to group by 1),
  o as (  -- days with cash collected but not yet received
    select created_by uid, count(distinct (created_at at time zone 'Asia/Kolkata')::date)::int n
      from public.payments x
     where (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to and payment_mode = 'CASH'
       and not exists (select 1 from public.cash_closings cc where cc.user_id = x.created_by and cc.day = (x.created_at at time zone 'Asia/Kolkata')::date)
     group by 1),
  f as (select created_by uid, sum(amount) amt from public.adjustments
         where kind = 'penalty' and cancelled_at is null and (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by 1),
  x as (select by_user uid, count(*)::int n from public.data_audit
         where action in ('payment_edited', 'payment_cancelled', 'loan_edited', 'loan_deleted', 'payment_rejected')
           and (at at time zone 'Asia/Kolkata')::date between p_from and p_to group by 1)
  select st.user_id, st.full_name, st.active,
         coalesce(p.n, 0), coalesce(p.amt, 0), coalesce(p.cash, 0),
         coalesce(l.n, 0), coalesce(l.amt, 0), coalesce(s.sz, 0), coalesce(s.rl, 0),
         coalesce(c.exp, 0), coalesce(c.rec, 0), coalesce(c.exp, 0) - coalesce(c.rec, 0),
         coalesce(o.n, 0), coalesce(f.amt, 0), coalesce(x.n, 0), p.last
    from public.staff st
    left join p on p.uid = st.user_id left join l on l.uid = st.user_id left join s on s.uid = st.user_id
    left join c on c.uid = st.user_id left join o on o.uid = st.user_id left join f on f.uid = st.user_id
    left join x on x.uid = st.user_id
   where public.has_perm('cash')
     and (st.active or p.n is not null or l.n is not null)
   order by coalesce(p.amt, 0) desc, st.full_name;
$$;
alter function public.staff_performance(date, date) set statement_timeout = '30s';

revoke execute on function public.dashboard(date), public.staff_performance(date, date) from anon, public;
grant execute on function public.dashboard(date), public.staff_performance(date, date) to authenticated;

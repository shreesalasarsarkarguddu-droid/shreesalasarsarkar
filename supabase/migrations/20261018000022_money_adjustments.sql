-- Phase 2: money changes on an account (admin only, reason required, each can be cancelled):
--   penalty    late fee / charge          -> adds to what the customer owes
--   discount   discount / waiver          -> reduces it
--   settle     close the account; any balance left is written off (stored as a minus amount)
--   reschedule new EMI + next due date for what is left; arrears count from the new schedule only
--
-- Owed (balance) everywhere = total payable + charges - discounts - paid.
-- A settled old-software account counts as closed even if the old software's file still says pending.

-- ---------------------------------------------------------------- table
create table public.adjustments (
  id                 bigint generated always as identity primary key,
  legacy_account_id  bigint references public.legacy_accounts (id),
  loan_id            bigint references public.loans (id),
  kind               text not null check (kind in ('penalty', 'discount', 'settle', 'reschedule')),
  amount             numeric(14,2) not null default 0,     -- signed: + charge, - discount / write-off; 0 for reschedule
  entry_date         date not null default ((now() at time zone 'Asia/Kolkata')::date),
  reason             text not null check (length(btrim(reason)) between 3 and 300),
  new_emi            numeric(14,2) check (new_emi > 0),    -- reschedule only
  next_due           date,                                 -- reschedule only
  cancelled_at       timestamptz,
  cancelled_by       uuid references auth.users (id),
  cancel_reason      text,
  created_at         timestamptz not null default now(),
  created_by         uuid not null default auth.uid() references auth.users (id),
  check ((legacy_account_id is null) <> (loan_id is null)),
  check (kind <> 'penalty' or amount > 0),
  check (kind <> 'discount' or amount < 0),
  check (kind <> 'settle' or amount <= 0),
  check (kind <> 'reschedule' or (amount = 0 and new_emi is not null and next_due is not null))
);
create index adjustments_legacy_idx on public.adjustments (legacy_account_id) where legacy_account_id is not null;
create index adjustments_loan_idx   on public.adjustments (loan_id) where loan_id is not null;

alter table public.adjustments enable row level security;
create policy "read adjustments" on public.adjustments for select to authenticated using ((select public.has_perm('view_accounts')));
revoke all on public.adjustments from anon;
revoke insert, update, delete, truncate on public.adjustments from authenticated;   -- only via the admin functions
grant select on public.adjustments to authenticated;

-- charges - discounts - write-offs that are not cancelled
create or replace function public.adj_total(p_acct bigint, p_loan bigint)
returns numeric language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(amount), 0) from public.adjustments
   where cancelled_at is null and (legacy_account_id = p_acct or loan_id = p_loan);
$$;
-- an old account closed in this app
create or replace function public.legacy_settled(p_acct bigint)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.adjustments where legacy_account_id = p_acct and kind = 'settle' and cancelled_at is null);
$$;
grant execute on function public.adj_total(bigint, bigint), public.legacy_settled(bigint) to authenticated;

-- the reschedule in force (latest, not cancelled)
create or replace function app_private.active_reschedule(p_acct bigint, p_loan bigint)
returns public.adjustments language sql stable security definer set search_path = '' as $$
  select * from public.adjustments
   where kind = 'reschedule' and cancelled_at is null and (legacy_account_id = p_acct or loan_id = p_loan)
   order by created_at desc, id desc limit 1;
$$;

-- ---------------------------------------------------------------- restore points include the new table
create or replace function app_private.data_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['import_batches','legacy_accounts','legacy_payments','borrowers','loans','payments','seizures','adjustments'];
$$;

-- Restore now also works for restore points taken before a table or column was added:
-- tables missing from the restore point come back empty, columns missing get their default.
create or replace function public.admin_restore(p_point bigint, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rp app_private.restore_points; v_new bigint; t text; tables text[] := app_private.data_tables(); seq text; cols text; missing text;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p_confirm is distinct from 'RESTORE' then raise exception 'type RESTORE to confirm' using errcode = '22023'; end if;
  select * into rp from app_private.restore_points where id = p_point;
  if not found then raise exception 'restore point not found' using errcode = '22023'; end if;
  foreach t in array tables loop
    if to_regclass('app_private.' || quote_ident('rp' || p_point || '_' || t)) is null then continue; end if;
    select string_agg(c.column_name, ', ') into missing
      from information_schema.columns c
     where c.table_schema = 'app_private' and c.table_name = 'rp' || p_point || '_' || t
       and not exists (select 1 from information_schema.columns x
                        where x.table_schema = 'public' and x.table_name = t and x.column_name = c.column_name);
    if missing is not null then
      raise exception 'table % no longer has column(s) %; this restore point cannot be restored automatically', t, missing using errcode = '22023';
    end if;
  end loop;

  v_new := app_private.make_restore_point('Before restoring #' || p_point);
  perform set_config('app.restoring', 'on', true);

  execute 'truncate ' || (select string_agg(format('public.%I', x), ', ') from unnest(tables) x);
  foreach t in array tables loop
    if to_regclass('app_private.' || quote_ident('rp' || p_point || '_' || t)) is null then continue; end if;
    -- columns in both (generated ones such as search_text are recalculated)
    select string_agg(quote_ident(x.column_name), ', ' order by x.ordinal_position) into cols
      from information_schema.columns x
     where x.table_schema = 'public' and x.table_name = t and x.is_generated = 'NEVER'
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'app_private' and c.table_name = 'rp' || p_point || '_' || t and c.column_name = x.column_name);
    execute format('insert into public.%I (%s) overriding system value select %s from app_private.%I', t, cols, cols, 'rp' || p_point || '_' || t);
    seq := pg_get_serial_sequence('public.' || t, 'id');
    if seq is not null then
      execute format('select setval(%L, greatest((select coalesce(max(id), 0) from public.%I), 1))', seq, t);
    end if;
  end loop;

  perform set_config('app.restoring', 'off', true);
  perform app_private.audit('restore', jsonb_build_object('restored', p_point, 'saved_before_restore', v_new, 'counts', app_private.data_counts()));
  return jsonb_build_object('restored', p_point, 'saved_before_restore', v_new, 'counts', app_private.data_counts());
end;
$$;
alter function public.admin_restore(bigint, text) set statement_timeout = '120s';

create or replace function public.admin_delete_data(p_scope text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rp bigint; before jsonb; after jsonb;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p_scope not in ('old', 'new', 'all') then raise exception 'bad scope' using errcode = '22023'; end if;
  if p_confirm is distinct from 'DELETE' then raise exception 'type DELETE to confirm' using errcode = '22023'; end if;

  v_rp := app_private.make_restore_point('Before delete (' || p_scope || ')');
  before := app_private.data_counts();

  if p_scope in ('new', 'all') then
    delete from public.adjustments where loan_id is not null;
    delete from public.seizures where loan_id is not null;
    delete from public.payments where loan_id is not null;
    delete from public.loans where true;
    delete from public.borrowers where true;
  end if;
  if p_scope in ('old', 'all') then
    delete from public.adjustments where legacy_account_id is not null;
    delete from public.seizures where legacy_account_id is not null;
    delete from public.payments where legacy_account_id is not null;
    delete from public.legacy_payments where true;
    delete from public.legacy_accounts where true;
    delete from public.import_batches where true;
  end if;

  after := app_private.data_counts();
  perform app_private.audit('delete', jsonb_build_object('scope', p_scope, 'restore_point', v_rp, 'before', before, 'after', after));
  return jsonb_build_object('restore_point', v_rp, 'before', before, 'after', after);
end;
$$;
alter function public.admin_delete_data(text, text) set statement_timeout = '120s';

-- ---------------------------------------------------------------- views: owed = total + adjustments - paid
create or replace view public.legacy_account_summary
with (security_invoker = true)
as
select
  a.id, a.ledger, a.sno, a.fno, a.borrower_name, a.borrower_father, a.borrower_mobile,
  a.registration_no, a.vehicle_model, a.agreement_date, a.tenure_months,
  a.finance_amount, a.interest_amount, a.total_amount, a.emi_amount,
  public.legacy_is_seized(a.id, a.seized) as seized,
  a.data_flags, a.search_text,
  a.legacy_payments_count + coalesce(n.payments_count, 0)                                          as payments_count,
  (a.legacy_paid + coalesce(n.total_paid, 0))::numeric(14,2)                                       as total_paid,
  (a.total_amount + coalesce(j.adj, 0) - a.legacy_paid - coalesce(n.total_paid, 0))::numeric(14,2) as balance,
  greatest(a.legacy_last_paid, n.last_paid_date)                                                   as last_paid_date,
  coalesce(j.adj, 0)::numeric(14,2)                                                                as adjustments,
  coalesce(j.settled, false)                                                                       as settled
from public.legacy_accounts a
left join lateral (
  select count(*) as payments_count, sum(np.paid_amount) as total_paid, max(np.paid_date) as last_paid_date
  from public.payments np
  where np.legacy_account_id = a.id
) n on true
left join lateral (
  select sum(x.amount) as adj, bool_or(x.kind = 'settle') as settled
  from public.adjustments x
  where x.legacy_account_id = a.id and x.cancelled_at is null
) j on true;

create or replace view public.all_accounts
with (security_invoker = true)
as
select
  'old'::text as source, s.sno::bigint as ref_id, s.fno::text as folio,
  case when s.settled then 'closed' else s.ledger end as ledger,
  s.borrower_name, s.borrower_father, s.borrower_mobile,
  s.registration_no, s.vehicle_model, s.tenure_months,
  s.payments_count, s.seized,
  s.total_amount, s.emi_amount, s.total_paid, s.balance,
  s.search_text, s.sno::bigint as sort_key
from public.legacy_account_summary s
union all
select
  'new'::text, l.id, l.folio_no,
  case when l.status = 'closed' then 'closed' else 'pending' end,
  b.full_name, b.father_name, b.mobile,
  l.vehicle_no, l.vehicle_model, l.installments,
  coalesce(np.cnt, 0), l.status = 'seized',
  l.total_amount, l.emi_amount, coalesce(np.paid, 0)::numeric(14,2),
  (l.total_amount + public.adj_total(null, l.id) - coalesce(np.paid, 0))::numeric(14,2),
  lower(l.folio_no || ' ' || b.full_name || ' ' || coalesce(b.mobile, '') || ' ' ||
        coalesce(l.vehicle_no, '') || ' ' || coalesce(b.father_name, '')),
  1000000000 + l.id
from public.loans l
join public.borrowers b on b.id = l.borrower_id
left join lateral (select count(*) as cnt, sum(paid_amount) as paid from public.payments p where p.loan_id = l.id) np on true;

create or replace view public.pending_borrowers
with (security_invoker = true)
as
select 'old'::text as source, a.sno::bigint as ref_id, a.fno::text as folio, a.borrower_name, a.borrower_mobile,
       a.search_text, a.sno::bigint as sort_key
from public.legacy_accounts a
where a.ledger = 'pending' and not public.legacy_settled(a.id)
union all
select 'new', l.id, l.folio_no, b.full_name, b.mobile,
       lower(l.folio_no || ' ' || b.full_name || ' ' || coalesce(b.mobile, '') || ' ' || coalesce(l.vehicle_no, '')),
       1000000000 + l.id
from public.loans l
join public.borrowers b on b.id = l.borrower_id
where l.status in ('active', 'seized');

create or replace view public.seized_accounts
with (security_invoker = true)
as
select 'old'::text as source, a.sno::bigint as ref_id,
       case when nullif(a.fcode, '') is not null then a.fcode || '-' || a.fno else a.fno::text end as folio,
       case when s.settled then 'closed' else a.ledger end as ledger,
       a.borrower_name, nullif(concat_ws(', ', a.borrower_mobile, a.borrower_mobile2), '') as mobile,
       a.vehicle_model, a.registration_no as vehicle_no,
       s.total_amount, s.total_paid, s.balance,
       ev.action_date as seized_on, ev.remarks, ev.id is null as from_old_software,
       lower(concat_ws(' ', a.search_text, a.chassis_no, a.engine_no)) as search_text
from public.legacy_accounts a
join public.legacy_account_summary s on s.id = a.id
left join lateral (
  select e.id, e.action_date, e.remarks from public.seizures e
   where e.legacy_account_id = a.id and e.action = 'seize' order by e.created_at desc, e.id desc limit 1
) ev on true
where s.seized
union all
select 'new', l.id, l.folio_no, 'pending', b.full_name, b.mobile, l.vehicle_model, l.vehicle_no,
       l.total_amount, coalesce(pp.paid, 0)::numeric(14,2),
       (l.total_amount + public.adj_total(null, l.id) - coalesce(pp.paid, 0))::numeric(14,2),
       ev.action_date, ev.remarks, false,
       lower(concat_ws(' ', l.folio_no, b.full_name, b.father_name, b.mobile, l.vehicle_no, l.chassis_no, l.engine_no))
from public.loans l
join public.borrowers b on b.id = l.borrower_id
left join lateral (select sum(p.paid_amount) as paid from public.payments p where p.loan_id = l.id) pp on true
left join lateral (
  select e.action_date, e.remarks from public.seizures e
   where e.loan_id = l.id and e.action = 'seize' order by e.created_at desc, e.id desc limit 1
) ev on true
where l.status = 'seized';

-- ---------------------------------------------------------------- due report: adjustments + reschedule
-- With a reschedule in force: receipts taken after it pay the new EMIs (new EMI amount, from the new next due date,
-- as many as the balance at that time needs); arrears before it are forgiven.
drop function if exists public.due_report(date);
create or replace function public.due_report(p_asof date)
returns table (
  source text, ref_id bigint, folio text, borrower_name text, vehicle_model text, mobile text, vehicle_no text,
  seized boolean, search_text text, emi numeric, balance numeric, arrears numeric, overdue_emis integer,
  due_emis numeric, next_due date,
  agreement_date date, tenure integer, finance_amount numeric, interest_amount numeric, other_charges numeric,
  total_amount numeric, total_paid numeric, last_paid date, late_days integer
)
language sql
stable
security invoker
set search_path = ''
as $$
with acct0 as (
  select 'old'::text as src, a.sno::bigint as ref, a.id as acct_id, null::bigint as loan_id,
         case when nullif(a.fcode, '') is not null then a.fcode || '-' || a.fno else a.fno::text end as folio,
         a.borrower_name as nm, a.vehicle_model as model,
         nullif(concat_ws(', ', a.borrower_mobile, a.borrower_mobile2), '') as mob,
         a.registration_no as vno, public.legacy_is_seized(a.id, a.seized) as sz,
         lower(concat_ws(' ', a.search_text, a.chassis_no, a.engine_no,
               case when nullif(a.fcode, '') is not null then a.fcode || '-' || a.fno end)) as st,
         a.emi_amount as emi, a.total_amount as total, a.tenure_months as tenure,
         greatest(coalesce(a.interval_months, 1), 1) as iv, a.agreement_date as start,
         a.finance_amount as fin, a.interest_amount as intr, a.agreement_amount + a.hp_amount as other
    from public.legacy_accounts a
   where a.ledger = 'pending' and not public.legacy_settled(a.id)
  union all
  select 'new', l.id, null, l.id, l.folio_no, b.full_name, l.vehicle_model, b.mobile, l.vehicle_no, l.status = 'seized',
         lower(concat_ws(' ', l.folio_no, b.full_name, b.father_name, b.mobile, l.vehicle_no, l.chassis_no, l.engine_no)),
         l.emi_amount, l.total_amount, l.installments, greatest(l.interval_months, 1), l.agreement_date,
         l.finance_amount, l.interest_amount, l.agreement_amount + l.hp_amount
    from public.loans l
    join public.borrowers b on b.id = l.borrower_id
   where l.status in ('active', 'seized')
),
acct as (
  select a.*, public.adj_total(a.acct_id, a.loan_id) as adj,
         rs.created_at as r_at, rs.entry_date as r_date, rs.new_emi as r_emi, rs.next_due as r_due
    from acct0 a
    left join lateral (
      select x.created_at, x.entry_date, x.new_emi, x.next_due from public.adjustments x
       where x.kind = 'reschedule' and x.cancelled_at is null and (x.legacy_account_id = a.acct_id or x.loan_id = a.loan_id)
       order by x.created_at desc, x.id desc limit 1
    ) rs on true
),
rcpt0 as (
  select a.src, a.ref, a.iv, a.emi, lp.installment_no as n, lp.paid_date as pd, lp.due_date as d, lp.paid_amount as amt,
         null::int as stored_im, lp.delay_days as dd, null::timestamptz as ca
    from acct a
    join public.legacy_payments lp on lp.account_id = a.acct_id and lp.ledger = 'pending'
  union all
  select a.src, a.ref, a.iv, a.emi, p.installment_no, p.paid_date, p.due_date, p.paid_amount, p.installments_covered, p.delay_days, p.created_at
    from acct a
    join public.payments p on p.legacy_account_id = a.acct_id
  union all
  select a.src, a.ref, a.iv, a.emi, p.installment_no, p.paid_date, p.due_date, p.paid_amount, p.installments_covered, p.delay_days, p.created_at
    from acct a
    join public.payments p on p.loan_id = a.loan_id
),
rcpt_gap as (
  select r.*,
         ((extract(year from lead(r.d) over w) - extract(year from r.d)) * 12
          + (extract(month from lead(r.d) over w) - extract(month from r.d)))::int as gap
    from rcpt0 r
  window w as (partition by r.src, r.ref order by r.n, r.pd nulls first)
),
rcpt as (
  select g.src, g.ref, g.n, g.pd, g.d, g.amt, g.dd, g.ca,
         case when g.stored_im is not null and g.stored_im > 0 then g.stored_im
              when g.gap is not null and g.gap > 0 and g.gap % g.iv = 0 and g.gap / g.iv between 1 and 60 then g.gap / g.iv
              when g.emi > 0 then greatest(1, round(g.amt / g.emi))::int
              else 1 end as im
    from rcpt_gap g
),
agg as (
  select src, ref, sum(amt) as paid, sum(im)::int as used, max(pd) as last_paid, coalesce(sum(dd), 0)::int as late
    from rcpt group by src, ref
),
lastr as (
  select distinct on (src, ref) src, ref, d as last_due, im as last_im
    from rcpt
   where d is not null
   order by src, ref, n desc, pd desc nulls last
),
rslots as (  -- EMI slots covered by receipts that fall on or before the as-of date
  select r.src, r.ref, count(*)::int as c
    from rcpt r
    join acct a on a.src = r.src and a.ref = r.ref
    cross join lateral generate_series(0, r.im - 1) j
   where r.d is not null and (r.d + make_interval(months => j * a.iv))::date <= p_asof
   group by r.src, r.ref
),
calc as (
  select a.*, coalesce(g.paid, 0) as paid, coalesce(g.used, 0) as used, g.last_paid, coalesce(g.late, 0) as late, l.last_due, l.last_im, coalesce(rs.c, 0) as rdue,
         a.total + a.adj - coalesce(g.paid, 0) as bal
    from acct a
    left join agg g on g.src = a.src and g.ref = a.ref
    left join lastr l on l.src = a.src and l.ref = a.ref
    left join rslots rs on rs.src = a.src and rs.ref = a.ref
),
calc2 as (
  select c.*,
         case when c.bal <= 0 then 0 else greatest(0, greatest(coalesce(c.tenure, 0), c.used) - c.used) end as remaining
    from calc c
),
slots as (  -- remaining (uncovered) EMI slots with their due dates
  select c.src, c.ref, k,
         case when c.last_due is not null then (c.last_due + make_interval(months => (c.last_im + k - 1) * c.iv))::date
              when c.start is not null then (c.start + make_interval(months => (c.used + k) * c.iv))::date end as due
    from calc2 c
    cross join lateral generate_series(1, c.remaining) k
   where c.r_at is null
),
slot_stats as (
  select src, ref,
         min(due) filter (where k = 1) as next_due,
         count(*) filter (where due <= p_asof)::int as due_le,
         count(*) filter (where due < p_asof)::int as overdue
    from slots
   group by src, ref
),
-- rescheduled accounts
rs1 as (
  select c.src, c.ref, c.r_emi, c.r_due, c.iv, c.bal,
         coalesce((select sum(r.amt) from rcpt r
                    where r.src = c.src and r.ref = c.ref
                      and ((r.ca is not null and r.ca < c.r_at) or (r.ca is null and (r.pd is null or r.pd < c.r_date)))), 0) as p_before,
         c.paid, c.total + c.adj as owed
    from calc2 c
   where c.r_at is not null
),
rs2 as (
  select x.*, x.paid - x.p_before as p_after, greatest(0, ceil((x.owed - x.p_before) / x.r_emi))::int as n from rs1 x
),
rs3 as (
  select y.*, least(y.n, greatest(0, floor(y.p_after / y.r_emi)))::int as cov,
         (select count(*) from generate_series(1, y.n) k where (y.r_due + make_interval(months => (k - 1) * y.iv))::date <= p_asof)::int as dle,
         (select count(*) from generate_series(1, y.n) k where (y.r_due + make_interval(months => (k - 1) * y.iv))::date < p_asof)::int as dlt
    from rs2 y
),
fin as (
  select c.*,
         coalesce(r.r_emi, c.emi) as emi_now,
         case when r.src is not null then
                case when c.bal > 0 and r.cov < r.n then (r.r_due + make_interval(months => r.cov * r.iv))::date end
              else s.next_due end as nd,
         case when r.src is not null then greatest(0, r.dlt - r.cov) else coalesce(s.overdue, 0) end as overdue,
         case when c.bal <= 0 then 0
              when r.src is not null then greatest(0, least(c.bal, r.r_emi * r.dle - r.p_after))
              else greatest(0, least(c.bal, c.emi * (c.rdue + coalesce(s.due_le, 0)) - c.paid)) end as arr
    from calc2 c
    left join slot_stats s on s.src = c.src and s.ref = c.ref
    left join rs3 r on r.src = c.src and r.ref = c.ref
)
select f.src, f.ref, f.folio, f.nm, f.model, f.mob, f.vno, f.sz, f.st, f.emi_now, f.bal, f.arr, f.overdue,
       case when f.emi_now > 0 then floor((f.arr * 100 * 10 + floor(f.emi_now * 100 / 2)) / (f.emi_now * 100)) / 10 else 0 end,
       f.nd,
       f.start, f.tenure, f.fin, f.intr, f.other + f.adj, f.total + f.adj, f.paid, f.last_paid, f.late
  from fin f;
$$;
revoke execute on function public.due_report(date) from anon, public;
grant execute on function public.due_report(date) to authenticated;

-- ---------------------------------------------------------------- receipts: balance + due date know about adjustments / reschedule
-- Due date of the next receipt: with a reschedule in force, the first new EMI not yet paid
-- (new next due + covered x interval, covered = paid since the reschedule / new EMI); otherwise as before.
create or replace function app_private.next_due_date(
  p_acct bigint, p_loan bigint, p_iv int, p_start date, p_used int, p_last_due date, p_last_im int, p_paid_after numeric)
returns date language plpgsql stable security definer set search_path = '' as $$
declare rs public.adjustments := app_private.active_reschedule(p_acct, p_loan);
begin
  if rs.id is not null then
    return (rs.next_due + make_interval(months => greatest(0, floor(p_paid_after / rs.new_emi))::int * p_iv))::date;
  elsif p_last_due is not null then
    return (p_last_due + make_interval(months => p_last_im * p_iv))::date;
  elsif p_start is not null then
    return (p_start + make_interval(months => (p_used + 1) * p_iv))::date;
  end if;
  return null;
end;
$$;

-- paid since the reschedule in force (0 when none)
create or replace function app_private.paid_since_reschedule(p_acct bigint, p_loan bigint)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare rs public.adjustments := app_private.active_reschedule(p_acct, p_loan); v numeric := 0;
begin
  if rs.id is null then return 0; end if;
  if p_acct is not null then
    select coalesce(sum(lp.paid_amount), 0) into v from public.legacy_payments lp
      join public.legacy_accounts a on a.id = lp.account_id and a.ledger = lp.ledger
     where lp.account_id = p_acct and lp.paid_date >= rs.entry_date;
  end if;
  return v + coalesce((select sum(paid_amount) from public.payments
                        where (legacy_account_id = p_acct or loan_id = p_loan) and created_at > rs.created_at), 0);
end;
$$;

-- security definer now: it uses the private helpers above (the collect permission is still checked first)
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
  v_today    date    := (now() at time zone 'Asia/Kolkata')::date;
  v_acct     bigint;
  v_loan     bigint;
  v_total    numeric;
  v_emi      numeric;
  v_interval int;
  v_start    date;
  v_paid     numeric;
  v_next     int;
  v_used     int;      -- EMI slots already covered by earlier receipts
  v_last_due date;     -- due date of the latest receipt
  v_last_im  int;      -- EMIs that latest receipt covered
  v_due      date;
  v_row      public.payments;
begin
  if not public.has_perm('collect') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_row from public.payments where idempotency_key = v_key;
  if found then
    return jsonb_build_object('id', v_row.id, 'receipt_no', v_row.receipt_no, 'installment_no', v_row.installment_no,
                              'balance_after', v_row.balance_after, 'replayed', true);
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

  perform pg_advisory_xact_lock(hashtext('payment:' || v_source || ':' || v_ref));

  -- receipts so far as (installment_no, due_date, paid, im), from the right tables
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
                               installments_covered, idempotency_key)
  values (v_acct, v_loan, v_next, v_due, v_emi, v_amount, v_date,
          p->>'payment_mode', nullif(btrim(p->>'reference_no'), ''), nullif(btrim(p->>'bank_name'), ''),
          (p->>'receipt_no')::bigint, v_total - v_paid - v_amount, v_date - v_due, v_im, v_key)
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'receipt_no', v_row.receipt_no, 'installment_no', v_row.installment_no,
                            'balance_after', v_row.balance_after, 'replayed', false);
exception
  when unique_violation then
    select * into v_row from public.payments where idempotency_key = v_key;
    if found then
      return jsonb_build_object('id', v_row.id, 'receipt_no', v_row.receipt_no, 'installment_no', v_row.installment_no,
                                'balance_after', v_row.balance_after, 'replayed', true);
    end if;
    raise;
end;
$$;
revoke execute on function public.record_payment(jsonb) from anon, public;
grant execute on function public.record_payment(jsonb) to authenticated;

create or replace function app_private.reflow_payments(p_acct bigint, p_loan bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_total numeric; v_emi numeric; v_iv int; v_start date; v_ledger text;
  v_paid numeric := 0; v_used int := 0; v_n int := 0; v_last_due date; v_last_im int; v_due date; r record;
  rs public.adjustments := app_private.active_reschedule(p_acct, p_loan); v_after numeric := 0;
begin
  if p_acct is not null then
    select total_amount, emi_amount, greatest(coalesce(interval_months, 1), 1), agreement_date, ledger
      into v_total, v_emi, v_iv, v_start, v_ledger from public.legacy_accounts where id = p_acct;
    select coalesce(sum(paid_amount), 0), coalesce(max(installment_no), 0),
           coalesce(sum(case when v_emi > 0 then greatest(1, round(paid_amount / v_emi))::int else 1 end), 0)
      into v_paid, v_n, v_used
      from public.legacy_payments where account_id = p_acct and ledger = v_ledger;
    select due_date, case when v_emi > 0 then greatest(1, round(paid_amount / v_emi))::int else 1 end
      into v_last_due, v_last_im
      from public.legacy_payments where account_id = p_acct and ledger = v_ledger and due_date is not null
     order by installment_no desc limit 1;
    if rs.id is not null then
      select coalesce(sum(paid_amount), 0) into v_after from public.legacy_payments
       where account_id = p_acct and ledger = v_ledger and paid_date >= rs.entry_date;
    end if;
  else
    select total_amount, emi_amount, greatest(interval_months, 1), agreement_date
      into v_total, v_emi, v_iv, v_start from public.loans where id = p_loan;
  end if;
  v_total := v_total + public.adj_total(p_acct, p_loan);

  update public.payments set installment_no = installment_no + 100000
   where legacy_account_id = p_acct or loan_id = p_loan;
  for r in select id, paid_amount, paid_date, installments_covered as im, created_at from public.payments
            where legacy_account_id = p_acct or loan_id = p_loan order by installment_no, id loop
    v_n := v_n + 1;
    if rs.id is not null and r.created_at > rs.created_at then
      v_due := (rs.next_due + make_interval(months => greatest(0, floor(v_after / rs.new_emi))::int * v_iv))::date;
      v_after := v_after + r.paid_amount;
    elsif v_last_due is not null then v_due := (v_last_due + make_interval(months => v_last_im * v_iv))::date;
    elsif v_start is not null then v_due := (v_start + make_interval(months => (v_used + 1) * v_iv))::date;
    else v_due := null;
    end if;
    v_paid := v_paid + r.paid_amount;
    update public.payments
       set installment_no = v_n, due_date = v_due,
           due_amount = case when rs.id is not null and r.created_at > rs.created_at then rs.new_emi else v_emi end,
           balance_after = v_total - v_paid, delay_days = r.paid_date - v_due
     where id = r.id;
    v_used := v_used + r.im;
    if v_due is not null then v_last_due := v_due; v_last_im := r.im; end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- admin actions
-- current owed amount (total + adjustments - paid) for an old account (legacy_accounts.id) or a new loan
create or replace function app_private.owed(p_acct bigint, p_loan bigint)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when p_acct is not null then
           (select a.total_amount + public.adj_total(a.id, null) - a.legacy_paid
                   - coalesce((select sum(paid_amount) from public.payments where legacy_account_id = a.id), 0)
              from public.legacy_accounts a where a.id = p_acct)
         else
           (select l.total_amount + public.adj_total(null, l.id)
                   - coalesce((select sum(paid_amount) from public.payments where loan_id = l.id), 0)
              from public.loans l where l.id = p_loan)
         end;
$$;

-- p = { source: 'old'|'new', ref_id (SNO / loan id), kind, amount, reason, new_emi, next_due }
create or replace function public.admin_adjust(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_kind text := p ->> 'kind';
  v_reason text := app_private.need_reason(p ->> 'reason');
  v_amount numeric := (p ->> 'amount')::numeric;
  v_acct bigint; v_loan bigint; v_status text; v_owed numeric; v_id bigint; r jsonb; v_msg text;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p ->> 'source' = 'old' then
    select id into v_acct from public.legacy_accounts where sno = (p ->> 'ref_id')::int;
    if not found then raise exception 'account not found' using errcode = 'P0002'; end if;
    perform pg_advisory_xact_lock(hashtext('payment:old:' || (p ->> 'ref_id')));
    if (select ledger from public.legacy_accounts where id = v_acct) = 'closed' then
      raise exception 'this account is already fully paid in the old software' using errcode = '22023';
    end if;
    if public.legacy_settled(v_acct) then raise exception 'this account is closed; reopen it first' using errcode = '22023'; end if;
  elsif p ->> 'source' = 'new' then
    v_loan := (p ->> 'ref_id')::bigint;
    perform pg_advisory_xact_lock(hashtext('payment:new:' || v_loan));
    select status into v_status from public.loans where id = v_loan for update;
    if not found then raise exception 'loan not found' using errcode = 'P0002'; end if;
    if v_status = 'closed' then raise exception 'this loan is closed; reopen it first' using errcode = '22023'; end if;
  else
    raise exception 'bad source' using errcode = '22023';
  end if;
  v_owed := app_private.owed(v_acct, v_loan);
  r := app_private.acct_ref(v_acct, v_loan);

  if v_kind = 'penalty' then
    if v_amount is null or v_amount <= 0 then raise exception 'enter the charge amount' using errcode = '22023'; end if;
    insert into public.adjustments (legacy_account_id, loan_id, kind, amount, reason) values (v_acct, v_loan, 'penalty', v_amount, v_reason) returning id into v_id;
    v_msg := '➕ Late fee / charge ' || app_private.inr(v_amount);
  elsif v_kind = 'discount' then
    if v_amount is null or v_amount <= 0 then raise exception 'enter the discount amount' using errcode = '22023'; end if;
    if v_amount > v_owed then raise exception 'discount is more than the balance (%)', app_private.inr(v_owed) using errcode = '22023'; end if;
    insert into public.adjustments (legacy_account_id, loan_id, kind, amount, reason) values (v_acct, v_loan, 'discount', -v_amount, v_reason) returning id into v_id;
    v_msg := '➖ Discount ' || app_private.inr(v_amount);
  elsif v_kind = 'settle' then
    -- whatever is still owed is written off; the account closes
    insert into public.adjustments (legacy_account_id, loan_id, kind, amount, reason)
    values (v_acct, v_loan, 'settle', -greatest(v_owed, 0), v_reason) returning id into v_id;
    if v_loan is not null then update public.loans set status = 'closed' where id = v_loan; end if;
    v_msg := '✅ Account closed' || case when v_owed > 0 then ' · written off ' || app_private.inr(v_owed) else '' end;
  elsif v_kind = 'reschedule' then
    if (p ->> 'new_emi')::numeric is null or (p ->> 'new_emi')::numeric <= 0 then raise exception 'enter the new EMI amount' using errcode = '22023'; end if;
    if (p ->> 'next_due')::date is null then raise exception 'enter the next due date' using errcode = '22023'; end if;
    if v_owed <= 0 then raise exception 'nothing is left to pay' using errcode = '22023'; end if;
    insert into public.adjustments (legacy_account_id, loan_id, kind, amount, reason, new_emi, next_due)
    values (v_acct, v_loan, 'reschedule', 0, v_reason, (p ->> 'new_emi')::numeric, (p ->> 'next_due')::date) returning id into v_id;
    v_msg := '📅 Rescheduled: EMI ' || app_private.inr((p ->> 'new_emi')::numeric) || ' from ' || to_char((p ->> 'next_due')::date, 'DD-MM-YYYY')
             || ' · ' || ceil(v_owed / (p ->> 'new_emi')::numeric) || ' EMIs';
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;

  perform app_private.reflow_payments(v_acct, v_loan);
  perform app_private.log('adjust_' || v_kind, r ->> 'subject', r - 'subject',
    jsonb_build_object('reason', v_reason, 'amount', (select amount from public.adjustments where id = v_id),
                       'new_emi', p ->> 'new_emi', 'next_due', p ->> 'next_due', 'owed_before', v_owed, 'owed_after', app_private.owed(v_acct, v_loan)));
  perform app_private.tg_quiet((select tg_on_payment from public.app_settings where id = 1),
    v_msg || chr(10) || coalesce(r ->> 'subject', '?') || chr(10) ||
    'Balance now ' || app_private.inr(app_private.owed(v_acct, v_loan)) || chr(10) ||
    'Reason: ' || v_reason || chr(10) || 'By ' || app_private.staff_name((select auth.uid())),
    'adjust_' || v_kind);
  return jsonb_build_object('id', v_id, 'owed', app_private.owed(v_acct, v_loan));
end;
$$;

-- cancel one adjustment (a settle = reopen the account)
create or replace function public.admin_cancel_adjustment(p_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reason text := app_private.need_reason(p_reason); x public.adjustments; r jsonb; v_last text;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  select * into x from public.adjustments where id = p_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if x.legacy_account_id is not null then
    perform pg_advisory_xact_lock(hashtext('payment:old:' || (select sno from public.legacy_accounts where id = x.legacy_account_id)));
  else
    perform pg_advisory_xact_lock(hashtext('payment:new:' || x.loan_id));
  end if;
  select * into x from public.adjustments where id = p_id for update;
  if x.cancelled_at is not null then raise exception 'already cancelled' using errcode = '22023'; end if;
  if x.kind <> 'settle' and exists (select 1 from public.adjustments where kind = 'settle' and cancelled_at is null
                                      and (legacy_account_id = x.legacy_account_id or loan_id = x.loan_id)) then
    raise exception 'the account is closed; reopen it first' using errcode = '22023';
  end if;

  update public.adjustments set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason where id = p_id;
  if x.kind = 'settle' and x.loan_id is not null then
    select action into v_last from public.seizures where loan_id = x.loan_id order by created_at desc, id desc limit 1;
    update public.loans set status = case when v_last = 'seize' then 'seized' else 'active' end where id = x.loan_id;
  end if;
  perform app_private.reflow_payments(x.legacy_account_id, x.loan_id);

  r := app_private.acct_ref(x.legacy_account_id, x.loan_id);
  perform app_private.log(case when x.kind = 'settle' then 'reopened' else 'adjust_cancelled' end, r ->> 'subject', r - 'subject',
    jsonb_build_object('reason', v_reason, 'kind', x.kind, 'amount', x.amount, 'original_reason', x.reason,
                       'owed_after', app_private.owed(x.legacy_account_id, x.loan_id)));
  perform app_private.tg_quiet((select tg_on_payment from public.app_settings where id = 1),
    case when x.kind = 'settle' then '↩️ Account reopened' else '↩️ Cancelled ' || x.kind end || chr(10) ||
    coalesce(r ->> 'subject', '?') || chr(10) ||
    'Balance now ' || app_private.inr(app_private.owed(x.legacy_account_id, x.loan_id)) || chr(10) ||
    'Reason: ' || v_reason || chr(10) || 'By ' || app_private.staff_name((select auth.uid())),
    'adjust_cancelled');
  return jsonb_build_object('cancelled', p_id);
end;
$$;

-- deleting a wrong loan also removes its adjustments (kept in the log copy)
create or replace function public.admin_delete_loan(p_loan bigint, p_reason text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reason text := app_private.need_reason(p_reason); l public.loans; b public.borrowers; r jsonb; s jsonb; j jsonb;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p_confirm is distinct from 'DELETE' then raise exception 'type DELETE to confirm' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('payment:new:' || p_loan));
  select * into l from public.loans where id = p_loan for update;
  if not found then raise exception 'loan not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.payments where loan_id = p_loan) then
    raise exception 'this loan has payments; cancel them first' using errcode = '22023';
  end if;
  select * into b from public.borrowers where id = l.borrower_id;
  r := app_private.acct_ref(null, p_loan);
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into s from public.seizures x where x.loan_id = p_loan;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into j from public.adjustments x where x.loan_id = p_loan;

  delete from public.adjustments where loan_id = p_loan;
  delete from public.seizures where loan_id = p_loan;
  delete from public.loans where id = p_loan;
  if not exists (select 1 from public.loans where borrower_id = b.id) then delete from public.borrowers where id = b.id; end if;

  perform app_private.log('loan_deleted', r ->> 'subject', null,
    jsonb_build_object('reason', v_reason, 'loan', to_jsonb(l), 'borrower', to_jsonb(b), 'seizures', s, 'adjustments', j));
  perform app_private.tg_quiet((select tg_on_new_loan from public.app_settings where id = 1),
    '🗑 Loan deleted' || chr(10) || coalesce(r ->> 'subject', '?') || chr(10) ||
    'Total ' || app_private.inr(l.total_amount) || chr(10) ||
    'Reason: ' || v_reason || chr(10) || 'By ' || app_private.staff_name((select auth.uid())),
    'loan_deleted');
  return jsonb_build_object('deleted', p_loan);
end;
$$;

revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on function public.admin_adjust(jsonb), public.admin_cancel_adjustment(bigint, text) from anon, public;
grant execute on function public.admin_adjust(jsonb), public.admin_cancel_adjustment(bigint, text) to authenticated;

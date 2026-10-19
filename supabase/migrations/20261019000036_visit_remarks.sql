-- Visit remarks: the collection man went, the customer did not pay, and said when he will ("2 days", "next month").
-- Shown on the unpaid EMI row until it is paid; all of them on the Remarks page (date / person / name / mobile filters).

create table public.visit_remarks (
  id              bigint generated always as identity primary key,
  source          text not null check (source in ('old', 'new')),
  ref_id          bigint not null,
  installment_no  int,
  remark          text not null check (length(btrim(remark)) between 2 and 300),
  promise_date    date,
  created_by      uuid not null default auth.uid() references auth.users (id),
  created_at      timestamptz not null default now()
);
create index visit_remarks_account_idx on public.visit_remarks (source, ref_id);
create index visit_remarks_created_idx on public.visit_remarks (created_at desc);
create index visit_remarks_promise_idx on public.visit_remarks (promise_date) where promise_date is not null;

alter table public.visit_remarks enable row level security;
create policy "staff read remarks" on public.visit_remarks for select to authenticated
  using ((select public.has_perm('view_accounts')) or (select public.has_perm('collect')));
revoke all on public.visit_remarks from anon;
revoke insert, update, delete, truncate on public.visit_remarks from authenticated;
grant select on public.visit_remarks to authenticated;

-- sees everyone's remarks on the Remarks page (others see their own)
create or replace function app_private.sees_all_remarks()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or public.has_perm('assign') or public.has_perm('approve');
$$;

create or replace function public.add_remark(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
-- p = { source, ref_id, installment_no, remark, promise_date }
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v_promise date := nullif(p ->> 'promise_date', '')::date; r public.visit_remarks;
begin
  if not public.has_perm('collect') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p ->> 'source' = 'old' then
    if not exists (select 1 from public.legacy_accounts where sno = (p ->> 'ref_id')::bigint) then raise exception 'account not found' using errcode = 'P0002'; end if;
  elsif p ->> 'source' = 'new' then
    if not exists (select 1 from public.loans where id = (p ->> 'ref_id')::bigint) then raise exception 'loan not found' using errcode = 'P0002'; end if;
  else
    raise exception 'bad source' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p ->> 'remark', ''))) < 2 then raise exception 'write what the customer said' using errcode = '22023'; end if;
  if length(btrim(p ->> 'remark')) > 300 then raise exception 'the remark is too long (300 letters at most)' using errcode = '22023'; end if;
  if v_promise is not null and (v_promise < v_today or v_promise > v_today + 400) then
    raise exception 'the pay-on date must be today or later' using errcode = '22023';
  end if;
  insert into public.visit_remarks (source, ref_id, installment_no, remark, promise_date)
  values (p ->> 'source', (p ->> 'ref_id')::bigint, nullif(p ->> 'installment_no', '')::int, btrim(p ->> 'remark'), v_promise)
  returning * into r;
  return jsonb_build_object('id', r.id);
end;
$$;

-- the writer may delete it the same day; admin / "fix mistakes" any time
create or replace function public.delete_remark(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.visit_remarks;
begin
  select * into r from public.visit_remarks where id = p_id for update;
  if not found then raise exception 'remark not found' using errcode = 'P0002'; end if;
  if not (public.has_perm('fix_entries')
          or (r.created_by = auth.uid() and (r.created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date)) then
    raise exception 'only admin can delete an older remark' using errcode = '42501';
  end if;
  delete from public.visit_remarks where id = p_id;
  perform app_private.log('remark_deleted', (select x ->> 'subject' from (select app_private.acct_ref(
            (select id from public.legacy_accounts where r.source = 'old' and sno = r.ref_id),
            case when r.source = 'new' then r.ref_id end) x) y),
          jsonb_build_object('source', r.source, 'ref_id', r.ref_id),
          jsonb_build_object('remark', r.remark, 'promise_date', r.promise_date, 'written_by', app_private.staff_name(r.created_by),
                             'written_on', (r.created_at at time zone 'Asia/Kolkata')::date));
end;
$$;

-- any payment (counted or waiting) entered after this moment
create or replace function app_private.paid_after(p_source text, p_ref bigint, p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.payments p
                  where p.created_at > p_at
                    and (case when p_source = 'old' then p.legacy_account_id = (select id from public.legacy_accounts where sno = p_ref)
                              else p.loan_id = p_ref end))
      or exists (select 1 from public.pending_payments w where w.source = p_source and w.ref_id = p_ref and w.created_at > p_at);
$$;

-- one account's remarks (newest first), with who wrote them and whether money came after
create or replace function public.account_remarks(p_source text, p_ref bigint)
returns table (id bigint, installment_no int, remark text, promise_date date, created_at timestamptz, by_name text, mine boolean, paid_after boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.installment_no, r.remark, r.promise_date, r.created_at, app_private.staff_name(r.created_by), r.created_by = auth.uid(),
         app_private.paid_after(r.source, r.ref_id, r.created_at)
    from public.visit_remarks r
   where r.source = p_source and r.ref_id = p_ref
     and (public.has_perm('view_accounts') or public.has_perm('collect'))
   order by r.created_at desc;
$$;

-- the Remarks page
-- p_status: null = all, 'open' = no payment since, 'paid' = paid since, 'broken' = pay-on date passed and no payment
create or replace function public.remarks_list(p_from date, p_to date, p_user uuid, p_q text, p_status text, p_promise date,
                                               p_limit int default 100, p_offset int default 0)
returns table (id bigint, source text, ref_id bigint, subject text, folio text, mobile text, installment_no int, remark text,
               promise_date date, created_at timestamptz, by_user uuid, by_name text, paid_after boolean, total bigint)
language sql stable security definer set search_path = '' as $$
  with base as (
    select r.*,
           case when r.source = 'old' then a.borrower_name else b.full_name end as name,
           case when r.source = 'old' then a.fno::text else l.folio_no end as folio,
           case when r.source = 'old' then a.borrower_mobile else b.mobile end as mobile,
           app_private.paid_after(r.source, r.ref_id, r.created_at) as paid
      from public.visit_remarks r
      left join public.legacy_accounts a on r.source = 'old' and a.sno = r.ref_id
      left join public.loans l on r.source = 'new' and l.id = r.ref_id
      left join public.borrowers b on b.id = l.borrower_id
     where (public.has_perm('view_accounts') or public.has_perm('collect'))
       and (app_private.sees_all_remarks() or r.created_by = auth.uid())
       and (p_from is null or (r.created_at at time zone 'Asia/Kolkata')::date >= p_from)
       and (p_to is null or (r.created_at at time zone 'Asia/Kolkata')::date <= p_to)
       and (p_user is null or r.created_by = p_user)
       and (p_promise is null or r.promise_date = p_promise)
  ),
  f as (
    select * from base
     where (nullif(btrim(p_q), '') is null
            or name ilike '%' || btrim(p_q) || '%' or mobile ilike '%' || btrim(p_q) || '%'
            or folio ilike btrim(p_q) || '%' or remark ilike '%' || btrim(p_q) || '%')
       and (p_status is null
            or (p_status = 'open' and not paid)
            or (p_status = 'paid' and paid)
            or (p_status = 'broken' and not paid and promise_date < (now() at time zone 'Asia/Kolkata')::date))
  )
  select f.id, f.source, f.ref_id, f.name, f.folio, f.mobile, f.installment_no, f.remark, f.promise_date, f.created_at,
         f.created_by, app_private.staff_name(f.created_by), f.paid, count(*) over ()
    from f
   order by f.created_at desc
   limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0);
$$;

-- remarks go into backups / restore points
create or replace function app_private.data_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['zones','receipt_series','import_batches','legacy_accounts','legacy_payments','borrowers','loans','payments','seizures',
               'adjustments','receipt_books','cash_closings','collection_assignments','pending_payments','visit_remarks'];
$$;

revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on function public.add_remark(jsonb), public.delete_remark(bigint), public.account_remarks(text, bigint),
  public.remarks_list(date, date, uuid, text, text, date, int, int) from anon, public;
grant execute on function public.add_remark(jsonb), public.delete_remark(bigint), public.account_remarks(text, bigint),
  public.remarks_list(date, date, uuid, text, text, date, int, int) to authenticated;

-- New loans entered in the new system (separate from the read-only legacy tables).

create table public.borrowers (
  id             bigint generated always as identity primary key,
  full_name      text not null check (length(btrim(full_name)) between 1 and 120),
  father_name    text,
  mobile         text check (mobile ~ '^[6-9][0-9]{9}$'),
  date_of_birth  date,
  address        text,
  created_at     timestamptz not null default now(),
  created_by     uuid not null default auth.uid() references auth.users (id)
);

create table public.loans (
  id                 bigint generated always as identity primary key,
  folio_no           text not null check (length(btrim(folio_no)) between 1 and 30),
  zone               text,
  dealer             text,
  loan_type          text not null check (loan_type in ('CASH', 'BANK')),

  borrower_id        bigint not null references public.borrowers (id),
  guarantor_name     text,
  guarantor_father   text,
  guarantor_mobile   text check (guarantor_mobile ~ '^[6-9][0-9]{9}$'),
  guarantor_address  text,

  vehicle_condition  text not null check (vehicle_condition in ('NEW', 'USED')),
  sold_by            text,
  vehicle_model      text not null,
  vehicle_color      text,
  chassis_no         text,
  engine_no          text,
  make_year          integer check (make_year between 1980 and 2100),
  vehicle_no         text,
  insurance_expiry   date,

  agreement_date     date not null,
  installments       integer not null check (installments between 1 and 360),
  interval_months    integer not null check (interval_months between 1 and 12),
  finance_amount     numeric(14,2) not null check (finance_amount > 0),
  interest_rate      numeric(6,2)  not null check (interest_rate between 0 and 100),   -- % per year, flat
  agreement_amount   numeric(14,2) not null default 0 check (agreement_amount >= 0),
  hp_amount          numeric(14,2) not null default 0 check (hp_amount >= 0),
  interest_amount    numeric(14,2) not null,   -- computed by create_loan()
  total_amount       numeric(14,2) not null,   -- computed by create_loan()
  emi_amount         numeric(14,2) not null,   -- computed by create_loan()

  status             text not null default 'active' check (status in ('active', 'closed', 'seized')),
  idempotency_key    uuid not null unique,     -- one submit = one loan, even on double-click / retry
  created_at         timestamptz not null default now(),
  created_by         uuid not null default auth.uid() references auth.users (id)
);

create unique index loans_folio_no_key on public.loans (upper(btrim(folio_no)));
create index loans_borrower_idx on public.loans (borrower_id);
create index loans_created_idx  on public.loans (created_at desc);

-- ---------------------------------------------------------------------------
-- The ONE place loan money is calculated (the form shows the same formula as a preview).
--   interest = principal x rate% x (installments x interval) / 12   rounded to paise
--   total    = principal + interest + agreement + hp
--   emi      = total / installments, rounded UP to the next rupee
-- ---------------------------------------------------------------------------
create or replace function public.loan_amounts(
  p_principal numeric, p_rate numeric, p_installments integer, p_interval integer,
  p_agreement numeric, p_hp numeric,
  out interest numeric, out total numeric, out emi numeric)
language sql
immutable
set search_path = ''
as $$
  select i, t, ceil(t / p_installments)
  from (select round(p_principal * p_rate * (p_installments * p_interval) / 1200, 2) as i) a,
       lateral (select p_principal + a.i + p_agreement + p_hp as t) b;
$$;

-- Creates borrower + loan atomically. Calling it twice with the same idempotency key
-- returns the first loan instead of creating a second one.
create or replace function public.create_loan(p jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key  uuid := (p->>'idempotency_key')::uuid;
  v_id   bigint;
  v_bid  bigint;
  v_amt  record;
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select id into v_id from public.loans where idempotency_key = v_key;
  if found then
    return v_id;
  end if;

  select * into v_amt from public.loan_amounts(
    (p->>'finance_amount')::numeric, (p->>'interest_rate')::numeric,
    (p->>'installments')::int, (p->>'interval_months')::int,
    coalesce((p->>'agreement_amount')::numeric, 0), coalesce((p->>'hp_amount')::numeric, 0));

  insert into public.borrowers (full_name, father_name, mobile, date_of_birth, address)
  values (p->>'borrower_name', p->>'borrower_father', p->>'borrower_mobile',
          (p->>'borrower_dob')::date, p->>'borrower_address')
  returning id into v_bid;

  insert into public.loans (
    folio_no, zone, dealer, loan_type, borrower_id,
    guarantor_name, guarantor_father, guarantor_mobile, guarantor_address,
    vehicle_condition, sold_by, vehicle_model, vehicle_color, chassis_no, engine_no,
    make_year, vehicle_no, insurance_expiry,
    agreement_date, installments, interval_months, finance_amount, interest_rate,
    agreement_amount, hp_amount, interest_amount, total_amount, emi_amount, idempotency_key)
  values (
    btrim(p->>'folio_no'), p->>'zone', p->>'dealer', p->>'loan_type', v_bid,
    p->>'guarantor_name', p->>'guarantor_father', p->>'guarantor_mobile', p->>'guarantor_address',
    p->>'vehicle_condition', p->>'sold_by', p->>'vehicle_model', p->>'vehicle_color', p->>'chassis_no', p->>'engine_no',
    (p->>'make_year')::int, p->>'vehicle_no', (p->>'insurance_expiry')::date,
    (p->>'agreement_date')::date, (p->>'installments')::int, (p->>'interval_months')::int,
    (p->>'finance_amount')::numeric, (p->>'interest_rate')::numeric,
    coalesce((p->>'agreement_amount')::numeric, 0), coalesce((p->>'hp_amount')::numeric, 0),
    v_amt.interest, v_amt.total, v_amt.emi, v_key)
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    -- A concurrent retry with the same key won the race: return its loan.
    select id into v_id from public.loans where idempotency_key = v_key;
    if found then
      return v_id;
    end if;
    raise;  -- otherwise it is a duplicate folio number
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: staff can read and create; nobody can update/delete through the API yet.
-- ---------------------------------------------------------------------------
alter table public.borrowers enable row level security;
alter table public.loans     enable row level security;

create policy "staff read borrowers"   on public.borrowers for select to authenticated using ((select public.is_staff()));
create policy "staff create borrowers" on public.borrowers for insert to authenticated with check ((select public.is_staff()) and created_by = (select auth.uid()));
create policy "staff read loans"       on public.loans     for select to authenticated using ((select public.is_staff()));
create policy "staff create loans"     on public.loans     for insert to authenticated with check ((select public.is_staff()) and created_by = (select auth.uid()));

revoke all on public.borrowers, public.loans from anon;
revoke update, delete, truncate on public.borrowers, public.loans from authenticated;
grant select, insert on public.borrowers, public.loans to authenticated;

revoke execute on function public.create_loan(jsonb) from anon, public;
grant execute on function public.create_loan(jsonb) to authenticated;
revoke execute on function public.loan_amounts(numeric, numeric, integer, integer, numeric, numeric) from anon, public;
grant execute on function public.loan_amounts(numeric, numeric, integer, integer, numeric, numeric) to authenticated;

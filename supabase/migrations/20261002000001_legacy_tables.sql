-- Legacy data from the old FoxPro software (F_ACC / P_ACCOUNT / F_INSMENT / P_INSMENT).
-- These tables are read-only for the app: rows are written only by the import script
-- (server-side, secret key / DB password) and are never edited in place.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Staff allow-list: only users listed here can read data (RLS below).
-- ---------------------------------------------------------------------------
create table public.staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null,
  role       text not null default 'staff' check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- Import history
-- ---------------------------------------------------------------------------
create table public.import_batches (
  id               bigint generated always as identity primary key,
  source_file      text not null,
  imported_at      timestamptz not null default now(),
  imported_by      text not null,
  total_records    integer not null,
  imported_records integer not null,
  skipped_records  integer not null,
  flagged_records  integer not null,
  status           text not null check (status in ('completed', 'failed')),
  notes            jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Accounts (one row per legacy finance account)
-- ledger: 'pending' = P_ACCOUNT (balance pending), 'closed' = F_ACC (paid in full)
-- ---------------------------------------------------------------------------
create table public.legacy_accounts (
  id                   bigint generated always as identity primary key,
  ledger               text not null check (ledger in ('pending', 'closed')),
  sno                  integer not null unique,          -- old internal serial (join key)
  fno                  integer not null,                 -- finance number (NOT unique in old data)
  fcode                text,                             -- meaning unknown, kept as-is

  borrower_name        text not null,
  borrower_father      text,
  borrower_address     text,
  borrower_mobile      text,
  borrower_mobile2     text,

  guarantor_name       text,
  guarantor_father     text,
  guarantor_address    text,
  guarantor_mobile     text,
  guarantor_mobile2    text,

  finance_mode         text,                             -- BCODE: CASH / BOB / SSS
  zone                 text,

  vehicle_condition    text,                             -- NU: New / Used
  vehicle_model        text,
  vehicle_variant      text,                             -- COLOR column (mostly variant/colour)
  chassis_no           text,
  engine_no            text,
  model_year           integer,
  registration_no      text,

  agreement_date       date,
  tenure_months        integer,
  interval_months      integer,                          -- PIVAL
  finance_amount       numeric(14,2) not null,           -- FAMT
  interest_amount      numeric(14,2) not null,           -- IAMT
  agreement_amount     numeric(14,2) not null,           -- AAMT
  hp_amount            numeric(14,2) not null,           -- HPAMT
  total_amount         numeric(14,2) not null,           -- TAMT
  emi_amount           numeric(14,2) not null,           -- IRATE (holds EMI, not a rate)
  seized               boolean,                          -- SEZIED T/F, null = blank

  data_flags           text[] not null default '{}',     -- data-quality warnings shown in the UI
  recovery             text not null,                    -- how the record was rebuilt from the dump
  raw                  jsonb not null,                   -- every original field, untouched
  import_batch_id      bigint not null references public.import_batches (id),

  search_text          text generated always as (
                         lower(coalesce(borrower_name, '') || ' ' || fno::text || ' ' || sno::text || ' ' ||
                               coalesce(borrower_mobile, '') || ' ' || coalesce(borrower_mobile2, '') || ' ' ||
                               coalesce(registration_no, '') || ' ' || coalesce(borrower_father, ''))
                       ) stored
);

create index legacy_accounts_fno_idx      on public.legacy_accounts (fno);
create index legacy_accounts_ledger_idx   on public.legacy_accounts (ledger, sno desc);
create index legacy_accounts_search_trgm  on public.legacy_accounts using gin (search_text extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Payments (one row per legacy receipt, matched to installment number INO)
-- ---------------------------------------------------------------------------
create table public.legacy_payments (
  id               bigint generated always as identity primary key,
  ledger           text not null check (ledger in ('pending', 'closed')),  -- which file it came from
  sno              integer not null,
  account_id       bigint references public.legacy_accounts (id),          -- null = orphan (no account found)
  installment_no   integer not null,
  due_amount       numeric(14,2),
  due_date         date,
  paid_amount      numeric(14,2) not null,
  paid_date        date,
  balance_after    numeric(14,2),
  delay_days       integer,
  payment_mode     text,                                                   -- BCODE: CASH / BOB / SBI / SSS
  cheque_no        text,
  receipt_no       integer,                                                -- RNO, null when not recoverable
  data_flags       text[] not null default '{}',
  raw              jsonb not null,
  import_batch_id  bigint not null references public.import_batches (id),
  unique (ledger, sno, installment_no)
);

create index legacy_payments_account_idx on public.legacy_payments (account_id, installment_no);
create index legacy_payments_sno_idx     on public.legacy_payments (sno);

-- ---------------------------------------------------------------------------
-- Per-account totals (computed in the database, never in the browser)
-- Only payments from the same ledger as the account are counted.
-- ---------------------------------------------------------------------------
create view public.legacy_account_summary
with (security_invoker = true)
as
select
  a.id, a.ledger, a.sno, a.fno, a.borrower_name, a.borrower_father, a.borrower_mobile,
  a.registration_no, a.vehicle_model, a.agreement_date, a.tenure_months,
  a.finance_amount, a.interest_amount, a.total_amount, a.emi_amount, a.seized,
  a.data_flags, a.search_text,
  coalesce(p.payments_count, 0)              as payments_count,
  coalesce(p.total_paid, 0)::numeric(14,2)   as total_paid,
  (a.total_amount - coalesce(p.total_paid, 0))::numeric(14,2) as balance,
  p.last_paid_date
from public.legacy_accounts a
left join lateral (
  select count(*) as payments_count, sum(lp.paid_amount) as total_paid, max(lp.paid_date) as last_paid_date
  from public.legacy_payments lp
  where lp.account_id = a.id and lp.ledger = a.ledger
) p on true;

-- ---------------------------------------------------------------------------
-- Row Level Security: staff can read; nobody can write through the API.
-- (The import script connects with the database password and bypasses RLS.)
-- ---------------------------------------------------------------------------
alter table public.staff            enable row level security;
alter table public.import_batches   enable row level security;
alter table public.legacy_accounts  enable row level security;
alter table public.legacy_payments  enable row level security;

create policy "staff read own row"      on public.staff           for select to authenticated using (user_id = (select auth.uid()));
create policy "staff read imports"      on public.import_batches  for select to authenticated using ((select public.is_staff()));
create policy "staff read accounts"     on public.legacy_accounts for select to authenticated using ((select public.is_staff()));
create policy "staff read payments"     on public.legacy_payments for select to authenticated using ((select public.is_staff()));

revoke all on public.staff, public.import_batches, public.legacy_accounts, public.legacy_payments, public.legacy_account_summary from anon;
revoke insert, update, delete, truncate on public.staff, public.import_batches, public.legacy_accounts, public.legacy_payments from authenticated;
grant select on public.staff, public.import_batches, public.legacy_accounts, public.legacy_payments, public.legacy_account_summary to authenticated;
revoke execute on function public.is_staff() from anon, public;
grant execute on function public.is_staff() to authenticated;

-- Payment window v3:
--  * modes CASH / CHEQUE / SBI / BANK (BOB removed); BANK needs the bank name, CHEQUE the cheque no.
--  * installments_covered (the old software's "IM"): how many EMIs one receipt covers.
--    The EMI amount never changes; the next receipt's due date moves forward by IM x interval.
--    For legacy receipts (IM not recoverable) IM = max(1, round(paid / EMI)).

alter table public.payments add column installments_covered integer not null default 1 check (installments_covered between 1 and 360);
alter table public.payments add column bank_name text check (length(bank_name) <= 60);

alter table public.payments drop constraint payments_payment_mode_check;
alter table public.payments add constraint payments_payment_mode_check check (payment_mode in ('CASH', 'CHEQUE', 'SBI', 'BANK'));
alter table public.payments add constraint payments_bank_needs_name check (payment_mode <> 'BANK' or nullif(btrim(bank_name), '') is not null);

create or replace function public.record_payment(p jsonb)
returns jsonb
language plpgsql
security invoker
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
  if not public.is_staff() then
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
    if not found then raise exception 'account not found or not pending' using errcode = 'P0002'; end if;

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
      from public.loans where id = v_ref and status = 'active';
    if not found then raise exception 'loan not found or not active' using errcode = 'P0002'; end if;

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
  -- This receipt starts at the first EMI slot not yet covered.
  if v_last_due is not null then
    v_due := (v_last_due + make_interval(months => v_last_im * v_interval))::date;
  elsif v_start is not null then
    v_due := (v_start + make_interval(months => (v_used + 1) * v_interval))::date;
  end if;

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

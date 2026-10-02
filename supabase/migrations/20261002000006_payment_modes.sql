-- Payment modes: CASH, CHEQUE, BOB, SBI, BANK (other bank). SSS removed for new payments.
-- A cheque payment must carry its cheque number.
alter table public.payments drop constraint payments_payment_mode_check;
alter table public.payments add constraint payments_payment_mode_check
  check (payment_mode in ('CASH', 'CHEQUE', 'BOB', 'SBI', 'BANK'));
alter table public.payments add constraint payments_cheque_needs_number
  check (payment_mode <> 'CHEQUE' or nullif(btrim(reference_no), '') is not null);

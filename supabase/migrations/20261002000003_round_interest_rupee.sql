-- Interest is rounded to the nearest whole rupee, matching the old software
-- (e.g. legacy SNO 312: 79070 @ 18% x 36 months = 42697.80 -> stored 42698, EMI 3383).
create or replace function public.loan_amounts(
  p_principal numeric, p_rate numeric, p_installments integer, p_interval integer,
  p_agreement numeric, p_hp numeric,
  out interest numeric, out total numeric, out emi numeric)
language sql
immutable
set search_path = ''
as $$
  select i, t, ceil(t / p_installments)
  from (select round(p_principal * p_rate * (p_installments * p_interval) / 1200, 0) as i) a,
       lateral (select p_principal + a.i + p_agreement + p_hp as t) b;
$$;

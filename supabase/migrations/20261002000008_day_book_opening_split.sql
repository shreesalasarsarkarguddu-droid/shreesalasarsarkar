-- Opening balance split into received (debit) and loans given (credit) before p_from.
-- The old software's "Opening Balance" equals the debit part (total received before the date).
drop function if exists public.day_book_opening(date);

create function public.day_book_opening(p_from date)
returns table (debit numeric, credit numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(e.debit), 0), coalesce(sum(e.credit), 0)
  from public.day_book_entries e
  where e.entry_date < p_from;
$$;

revoke execute on function public.day_book_opening(date) from anon, public;
grant execute on function public.day_book_opening(date) to authenticated;

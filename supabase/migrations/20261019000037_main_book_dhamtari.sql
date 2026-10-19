-- DHAMTARI = the main receipt book (accounts with no zone). Shown on the Zones page; it can open a new book too.
--   * "next" for the first main book counts only receipts written in this app (the old software has wrong numbers like 446496).
--   * A new main book is DHAMTARI-2, -3, …; its receipts show "DHAMTARI-2/188" like a zone book. Book 1 ("MAIN") stays plain.

create or replace function app_private.series_code(p_series bigint)
returns text language sql stable security definer set search_path = '' as $$
  select case when zone_id is null and book_no = 1 then null else code end from public.receipt_series where id = p_series;
$$;

-- the main book card on the Zones page
create or replace function public.main_book_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  with s as (select * from public.receipt_series where zone_id is null and closed_at is null),
  last_app as (
    select max(n) as n from (
      select max(receipt_no) n from public.payments where series_id = (select id from s)
      union all
      select max(receipt_no) from public.pending_payments where series_id = (select id from s)) x
  )
  select jsonb_build_object(
    'book_no', s.book_no,
    'book_code', case when s.book_no = 1 then 'MAIN' else s.code end,
    'book_start', s.start_no,
    'book_opened', s.opened_at,
    'last_used', (select n from last_app),
    'next_no', case when s.book_no = 1 then (select n + 1 from last_app) else coalesce((select n + 1 from last_app), s.start_no) end,
    'receipts', (select count(*) from public.payments where series_id = s.id) + (select count(*) from public.pending_payments where series_id = s.id),
    'accounts', (select count(*) from public.legacy_accounts a
                  where not exists (select 1 from public.zones z where z.name = upper(btrim(a.zone))))
              + (select count(*) from public.loans l
                  where not exists (select 1 from public.zones z where z.name = upper(btrim(l.zone)))),
    'books', coalesce((select jsonb_agg(jsonb_build_object('code', case when o.book_no = 1 then 'MAIN' else o.code end, 'book_no', o.book_no,
                                                            'start', o.start_no, 'opened', o.opened_at, 'closed', o.closed_at,
                                                            'last', (select max(receipt_no) from public.payments where series_id = o.id),
                                                            'receipts', (select count(*) from public.payments where series_id = o.id)
                                                                        + (select count(*) from public.legacy_payments where series_id = o.id))
                                         order by o.book_no desc)
                         from public.receipt_series o where o.zone_id is null and o.closed_at is not null), '[]'))
  from s
  where public.is_staff();
$$;

-- open a new main (DHAMTARI) book: the current one closes, its receipts stay
create or replace function public.admin_main_book(p_start bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur public.receipt_series; v_book int; v_code text;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p_start is null or p_start <= 0 then raise exception 'enter the first receipt number of the book' using errcode = '22023'; end if;
  select * into cur from public.receipt_series where zone_id is null and closed_at is null for update;
  select coalesce(max(book_no), 0) + 1 into v_book from public.receipt_series where zone_id is null;
  v_code := 'DHAMTARI-' || v_book;
  if exists (select 1 from public.receipt_series where code = v_code) then raise exception 'a book named % already exists', v_code using errcode = '22023'; end if;
  update public.receipt_series set closed_at = now() where id = cur.id;
  update public.receipt_books set closed_at = now() where series_id = cur.id and closed_at is null;
  insert into public.receipt_series (zone_id, book_no, code, start_no) values (null, v_book, v_code, p_start);
  perform app_private.log('zone_book', 'DHAMTARI', null,
    jsonb_build_object('book', v_code, 'start_no', p_start, 'closed', case when cur.book_no = 1 then 'MAIN' else cur.code end));
  return jsonb_build_object('book', v_code);
end;
$$;

-- Collect window: a new main book shows like a zone book (name DHAMTARI)
create or replace function public.receipt_hint(p_source text default null, p_ref bigint default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with s as (select * from public.receipt_series where id = app_private.open_series(app_private.ref_zone(p_source, p_ref)))
  select jsonb_build_object(
    'last_app', (select max(n) from (select max(receipt_no) n from public.payments where series_id = s.id
                                     union all select max(receipt_no) from public.pending_payments where series_id = s.id) x),
    'last_mine', (select max(n) from (select max(receipt_no) n from public.payments where series_id = s.id and created_by = auth.uid()
                                      union all select max(receipt_no) from public.pending_payments where series_id = s.id and created_by = auth.uid()) x),
    'last_old', (select max(receipt_no) from public.legacy_payments where series_id = s.id),
    'books', coalesce((select jsonb_agg(jsonb_build_object('from', b.from_no, 'to', b.to_no,
                 'next', (select min(n) from generate_series(b.from_no, b.to_no) n
                           where not exists (select 1 from public.payments where series_id = s.id and receipt_no = n)
                             and not exists (select 1 from public.pending_payments where series_id = s.id and receipt_no = n))) order by b.from_no)
               from public.receipt_books b where b.user_id = auth.uid() and b.closed_at is null and b.series_id = s.id), '[]'),
    'series', case when s.zone_id is not null or s.book_no > 1 then jsonb_build_object(
                'code', s.code, 'zone', coalesce((select name from public.zones where id = s.zone_id), 'DHAMTARI'), 'book_no', s.book_no,
                'start', s.start_no, 'last', app_private.series_last(s.id), 'next', coalesce(app_private.series_last(s.id) + 1, s.start_no)) end
  )
  from s
  where public.has_perm('collect');
$$;

revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on function public.main_book_status(), public.admin_main_book(bigint) from anon, public;
grant execute on function public.main_book_status(), public.admin_main_book(bigint) to authenticated;

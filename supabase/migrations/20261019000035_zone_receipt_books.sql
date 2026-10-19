-- Zone receipt books. Each zone has its own printed receipt books; a receipt number only has to be unique inside its book.
--   * MAIN book: every account with no zone (or a zone not in the list) — all receipts so far live here.
--   * A zone gets Book 1 when added; "Open new receipt book" closes the current one and starts Book N+1 at a number you give.
--   * Every receipt (old software, app, waiting) carries its book: series_id + receipt_book (code like "NARHARPUR-2"; null = MAIN).
--   * NARHARPUR: its receipts so far become NARHARPUR-1; NARHARPUR-2 starts at 188.

create table public.receipt_series (
  id         bigint generated always as identity primary key,
  zone_id    bigint references public.zones (id),
  book_no    int not null check (book_no >= 1),
  code       text not null unique,
  start_no   bigint not null check (start_no > 0),
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz,
  opened_by  uuid default auth.uid() references auth.users (id),
  unique nulls not distinct (zone_id, book_no)
);
create unique index receipt_series_one_open on public.receipt_series (coalesce(zone_id, 0)) where closed_at is null;
alter table public.receipt_series enable row level security;
create policy "staff read receipt series" on public.receipt_series for select to authenticated using ((select public.is_staff()));
revoke all on public.receipt_series from anon;
revoke insert, update, delete, truncate on public.receipt_series from authenticated;
grant select on public.receipt_series to authenticated;

insert into public.receipt_series (zone_id, book_no, code, start_no, opened_by) values (null, 1, 'MAIN', 1, null);

-- zones: the start number now belongs to each book; no longer unique across zones
drop index if exists public.zones_receipt_start_key;

-- ---------------------------------------------------------------- which book a receipt goes to
create or replace function app_private.ref_zone(p_source text, p_ref bigint)
returns text language sql stable security definer set search_path = '' as $$
  select case p_source when 'old' then (select zone from public.legacy_accounts where sno = p_ref)
                       when 'new' then (select zone from public.loans where id = p_ref) end;
$$;

create or replace function app_private.acct_zone(p_acct bigint, p_loan bigint)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select zone from public.legacy_accounts where id = p_acct), (select zone from public.loans where id = p_loan));
$$;

-- the open book for a zone name (MAIN's open book when the zone is blank or not in the list)
create or replace function app_private.open_series(p_zone text)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.id from public.receipt_series s join public.zones z on z.id = s.zone_id
      where upper(z.name) = upper(btrim(p_zone)) and s.closed_at is null),
    (select id from public.receipt_series where zone_id is null and closed_at is null));
$$;

-- old-software receipts belong to the zone's first book (MAIN's first book when no zone)
create or replace function app_private.history_series(p_zone text)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.id from public.receipt_series s join public.zones z on z.id = s.zone_id
      where upper(z.name) = upper(btrim(p_zone)) order by s.book_no limit 1),
    (select id from public.receipt_series where zone_id is null order by book_no limit 1));
$$;

create or replace function app_private.series_code(p_series bigint)
returns text language sql stable security definer set search_path = '' as $$
  select case when zone_id is null then null else code end from public.receipt_series where id = p_series;
$$;

-- MAIN must always exist (an old backup file restored without the book table gets it back here)
create or replace function app_private.ensure_main() returns bigint
language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  select id into v from public.receipt_series where zone_id is null and closed_at is null;
  if v is null then
    insert into public.receipt_series (zone_id, book_no, code, start_no, opened_by)
    values (null, coalesce((select max(book_no) from public.receipt_series where zone_id is null), 0) + 1, 'MAIN', 1, null)
    on conflict do nothing returning id into v;
    if v is null then select id into v from public.receipt_series where code = 'MAIN'; end if;
  end if;
  return v;
end;
$$;

alter table public.payments         add column series_id bigint references public.receipt_series (id), add column receipt_book text;
alter table public.pending_payments add column series_id bigint references public.receipt_series (id), add column receipt_book text;
alter table public.legacy_payments  add column series_id bigint references public.receipt_series (id), add column receipt_book text;
alter table public.receipt_books    add column series_id bigint references public.receipt_series (id);

create or replace function app_private.payments_series() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.series_id is null then
    new.series_id := coalesce(app_private.open_series(app_private.acct_zone(new.legacy_account_id, new.loan_id)), app_private.ensure_main());
  end if;
  new.receipt_book := app_private.series_code(new.series_id);
  return new;
end;
$$;
create or replace function app_private.pending_series() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.series_id is null then
    new.series_id := coalesce(app_private.open_series(app_private.ref_zone(new.source, new.ref_id)), app_private.ensure_main());
  end if;
  new.receipt_book := app_private.series_code(new.series_id);
  return new;
end;
$$;
create or replace function app_private.legacy_series() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.series_id is null then
    new.series_id := coalesce(app_private.history_series((select zone from public.legacy_accounts where id = new.account_id)), app_private.ensure_main());
  end if;
  new.receipt_book := app_private.series_code(new.series_id);
  return new;
end;
$$;
create or replace function app_private.books_series() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.series_id is null then new.series_id := coalesce(app_private.open_series(null), app_private.ensure_main()); end if;
  return new;
end;
$$;
create trigger payments_series before insert on public.payments for each row execute function app_private.payments_series();
create trigger pending_series before insert on public.pending_payments for each row execute function app_private.pending_series();
create trigger legacy_series before insert on public.legacy_payments for each row execute function app_private.legacy_series();
create trigger books_series before insert on public.receipt_books for each row execute function app_private.books_series();

-- everything so far is in MAIN
update public.payments         set series_id = (select id from public.receipt_series where code = 'MAIN');
update public.pending_payments set series_id = (select id from public.receipt_series where code = 'MAIN');
update public.legacy_payments  set series_id = (select id from public.receipt_series where code = 'MAIN');
update public.receipt_books    set series_id = (select id from public.receipt_series where code = 'MAIN');

-- ---------------------------------------------------------------- NARHARPUR: Book 1 = its receipts so far, Book 2 from 188
do $$
declare v_zone bigint; b1 bigint; b2 bigint; v_start bigint;
begin
  select id into v_zone from public.zones where name = 'NARHARPUR';
  if v_zone is null then
    insert into public.zones (name, receipt_start, created_by) values ('NARHARPUR', 188, null) returning id into v_zone;
  end if;
  select coalesce(min(n), 1) into v_start from (
    select min(p.receipt_no) n from public.legacy_payments p join public.legacy_accounts a on a.id = p.account_id where upper(btrim(a.zone)) = 'NARHARPUR'
    union all
    select min(p.receipt_no) from public.payments p left join public.legacy_accounts a on a.id = p.legacy_account_id left join public.loans l on l.id = p.loan_id
     where upper(btrim(coalesce(a.zone, l.zone))) = 'NARHARPUR') x;
  insert into public.receipt_series (zone_id, book_no, code, start_no, closed_at, opened_by)
  values (v_zone, 1, 'NARHARPUR-1', greatest(v_start, 1), now(), null) returning id into b1;
  insert into public.receipt_series (zone_id, book_no, code, start_no, opened_by)
  values (v_zone, 2, 'NARHARPUR-2', 188, null) returning id into b2;

  update public.legacy_payments p set series_id = b1, receipt_book = 'NARHARPUR-1'
    from public.legacy_accounts a where a.id = p.account_id and upper(btrim(a.zone)) = 'NARHARPUR';
  update public.payments p set series_id = b1, receipt_book = 'NARHARPUR-1'
   where upper(btrim(app_private.acct_zone(p.legacy_account_id, p.loan_id))) = 'NARHARPUR';
  update public.pending_payments p set series_id = b1, receipt_book = 'NARHARPUR-1'
   where upper(btrim(app_private.ref_zone(p.source, p.ref_id))) = 'NARHARPUR';
  perform app_private.log('zone_book', 'NARHARPUR', null, jsonb_build_object('book', 'NARHARPUR-2', 'start_no', 188, 'closed', 'NARHARPUR-1'));
end $$;

alter table public.payments         alter column series_id set not null;
alter table public.pending_payments alter column series_id set not null;
alter table public.legacy_payments  alter column series_id set not null;
alter table public.receipt_books    alter column series_id set not null;

-- receipt numbers: unique inside a book
alter table public.payments drop constraint payments_receipt_no_key;
alter table public.payments add constraint payments_series_receipt_no_key unique (series_id, receipt_no);
alter table public.pending_payments drop constraint pending_payments_receipt_no_key;
alter table public.pending_payments add constraint pending_payments_series_receipt_no_key unique (series_id, receipt_no);
drop index if exists public.legacy_payments_receipt_no_idx;
create index legacy_payments_series_receipt_idx on public.legacy_payments (series_id, receipt_no);
-- people's receipt books may overlap across zone books; the function below checks overlap inside one book
alter table public.receipt_books drop constraint if exists receipt_books_int8range_excl;

-- ---------------------------------------------------------------- record / approve / edit: check inside the book
do $$
declare d text;
begin
  d := pg_get_functiondef('public.record_payment(jsonb)'::regprocedure);
  if position('v_pend   public.pending_payments;' in d) = 0 or position('perform pg_advisory_xact_lock(hashtext(''receipt:'' || v_rno));' in d) = 0
     or position('where closed_at is null and int8range(from_no, to_no, ''[]'') @> v_rno' in d) = 0 then
    raise exception 'record_payment: marker not found';
  end if;
  d := replace(d, 'v_pend   public.pending_payments;', 'v_pend   public.pending_payments;' || chr(10) || '  v_series bigint;');
  d := replace(d, $old$  perform pg_advisory_xact_lock(hashtext('receipt:' || v_rno));
  if exists (select 1 from public.payments where receipt_no = v_rno)
     or exists (select 1 from public.pending_payments where receipt_no = v_rno)
     or exists (select 1 from public.legacy_payments where receipt_no = v_rno) then
    raise exception 'receipt no. % is already used', v_rno using errcode = '23505';
  end if;$old$, $new$  -- the account's zone book
  v_series := app_private.open_series(app_private.ref_zone(v_source, v_ref));
  p := p || jsonb_build_object('series_id', v_series);
  perform pg_advisory_xact_lock(hashtext('receipt:' || v_series || ':' || v_rno));
  if exists (select 1 from public.payments where series_id = v_series and receipt_no = v_rno)
     or exists (select 1 from public.pending_payments where series_id = v_series and receipt_no = v_rno)
     or exists (select 1 from public.legacy_payments where series_id = v_series and receipt_no = v_rno) then
    raise exception 'receipt no. % is already used in book %', v_rno, (select code from public.receipt_series where id = v_series) using errcode = '23505';
  end if;$new$);
  if position('v_series := app_private.open_series' in d) = 0 then raise exception 'record_payment: receipt check not replaced'; end if;
  d := replace(d, 'where closed_at is null and int8range(from_no, to_no, ''[]'') @> v_rno',
                  'where closed_at is null and series_id = v_series and int8range(from_no, to_no, ''[]'') @> v_rno');
  d := replace(d, 'where user_id = auth.uid() and closed_at is null', 'where user_id = auth.uid() and closed_at is null and series_id = v_series');
  d := replace(d, 'installments_covered, idempotency_key, note, parts)', 'installments_covered, idempotency_key, note, parts, series_id)');
  d := replace(d, 'v_rno, v_im, v_key, v_note, case when p->>''payment_mode'' = ''SPLIT'' then p->''parts'' end)',
                  'v_rno, v_im, v_key, v_note, case when p->>''payment_mode'' = ''SPLIT'' then p->''parts'' end, v_series)');
  if position('parts, series_id)' in d) = 0 or position('end, v_series)' in d) = 0 then raise exception 'record_payment: pending insert not patched'; end if;
  execute d;

  d := pg_get_functiondef('app_private.post_payment(jsonb, uuid, timestamptz)'::regprocedure);
  if position('installments_covered, idempotency_key, created_by, created_at, parts)' in d) = 0 then raise exception 'post_payment: marker not found'; end if;
  d := replace(d, 'installments_covered, idempotency_key, created_by, created_at, parts)', 'installments_covered, idempotency_key, created_by, created_at, parts, series_id)');
  d := replace(d, 'p_by, p_at, case when p ->> ''payment_mode'' = ''SPLIT'' then p -> ''parts'' end)',
                  'p_by, p_at, case when p ->> ''payment_mode'' = ''SPLIT'' then p -> ''parts'' end, (p ->> ''series_id'')::bigint)');
  if position('(p ->> ''series_id'')::bigint)' in d) = 0 then raise exception 'post_payment: values not patched'; end if;
  execute d;

  d := pg_get_functiondef('public.review_pending(bigint[], boolean, text)'::regprocedure);
  if position('''parts'', r.parts)' in d) = 0 then raise exception 'review_pending: marker not found'; end if;
  execute replace(d, '''parts'', r.parts)', '''parts'', r.parts, ''series_id'', r.series_id)');

  d := pg_get_functiondef('public.admin_edit_payment(bigint, jsonb, text)'::regprocedure);
  if (length(d) - length(replace(d, 'where receipt_no = v_rno)', ''))) / length('where receipt_no = v_rno)') <> 2 then
    raise exception 'admin_edit_payment: marker not found';
  end if;
  execute replace(d, 'where receipt_no = v_rno)', 'where series_id = o.series_id and receipt_no = v_rno)');

  -- Telegram text: show the book with the receipt no.
  d := pg_get_functiondef('app_private.on_payment()'::regprocedure);
  if position('coalesce('' · Rcpt '' || new.receipt_no, '''')' in d) = 0 then raise exception 'on_payment: marker not found'; end if;
  d := replace(d, 'coalesce('' · Rcpt '' || new.receipt_no, '''')', 'coalesce('' · Rcpt '' || coalesce(new.receipt_book || ''/'', '''') || new.receipt_no, '''')');
  d := replace(d, '''receipt'', new.receipt_no::text', '''receipt'', coalesce(new.receipt_book || ''/'', '''') || new.receipt_no::text');
  execute d;
end $$;

-- ---------------------------------------------------------------- people's receipt books: inside a zone book
drop function if exists public.receipt_book_status();
create or replace function public.receipt_book_status()
returns table (id bigint, user_id uuid, full_name text, from_no bigint, to_no bigint, issued_on date, note text, closed boolean,
               used int, last_used bigint, skipped bigint[], skipped_count int, book text)
language sql stable security definer set search_path = '' as $$
  select b.id, b.user_id, s.full_name, b.from_no, b.to_no, b.issued_on, b.note, b.closed_at is not null,
         u.used, u.last_used,
         (select array_agg(n order by n) from (select n from generate_series(b.from_no, coalesce(u.last_used, b.from_no - 1)) n
                                               where not exists (select 1 from public.payments p where p.series_id = b.series_id and p.receipt_no = n) limit 50) z),
         (select count(*)::int from generate_series(b.from_no, coalesce(u.last_used, b.from_no - 1)) n
           where not exists (select 1 from public.payments p where p.series_id = b.series_id and p.receipt_no = n)),
         rs.code
    from public.receipt_books b
    join public.staff s on s.user_id = b.user_id
    join public.receipt_series rs on rs.id = b.series_id
    cross join lateral (select count(*)::int as used, max(p.receipt_no) as last_used
                          from public.payments p where p.series_id = b.series_id and p.receipt_no between b.from_no and b.to_no) u
   where public.has_perm('cash') or b.user_id = (select auth.uid())
   order by b.closed_at is not null, s.full_name, b.from_no;
$$;

create or replace function public.admin_receipt_book(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
-- p = { action: add | close | reopen | delete, id, user_id, from_no, to_no, note, series_id }
declare b public.receipt_books; v_id bigint; v_name text; v_series bigint;
begin
  if not public.has_perm('cash') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p ->> 'action' = 'add' then
    if not exists (select 1 from public.staff where user_id = (p ->> 'user_id')::uuid) then raise exception 'choose the person' using errcode = '22023'; end if;
    if (p ->> 'from_no')::bigint is null or (p ->> 'to_no')::bigint is null or (p ->> 'to_no')::bigint < (p ->> 'from_no')::bigint then
      raise exception 'enter the first and last receipt number' using errcode = '22023';
    end if;
    if (p ->> 'to_no')::bigint - (p ->> 'from_no')::bigint >= 10000 then raise exception 'a book can have at most 10,000 receipts' using errcode = '22023'; end if;
    v_series := coalesce((p ->> 'series_id')::bigint, app_private.open_series(null));
    if not exists (select 1 from public.receipt_series where id = v_series and closed_at is null) then
      raise exception 'choose an open zone book' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtext('receipt_books:' || v_series));
    if exists (select 1 from public.receipt_books where series_id = v_series
                  and int8range(from_no, to_no, '[]') && int8range((p ->> 'from_no')::bigint, (p ->> 'to_no')::bigint, '[]')) then
      raise exception 'these numbers overlap another receipt book' using errcode = '22023';
    end if;
    insert into public.receipt_books (user_id, from_no, to_no, note, series_id)
    values ((p ->> 'user_id')::uuid, (p ->> 'from_no')::bigint, (p ->> 'to_no')::bigint, nullif(btrim(p ->> 'note'), ''), v_series)
    returning * into b;
    v_id := b.id;
  else
    select * into b from public.receipt_books where id = (p ->> 'id')::bigint for update;
    if not found then raise exception 'receipt book not found' using errcode = 'P0002'; end if;
    v_id := b.id;
    if p ->> 'action' = 'close' then update public.receipt_books set closed_at = now() where id = b.id;
    elsif p ->> 'action' = 'reopen' then update public.receipt_books set closed_at = null where id = b.id;
    elsif p ->> 'action' = 'delete' then
      if exists (select 1 from public.payments where series_id = b.series_id and receipt_no between b.from_no and b.to_no) then
        raise exception 'receipts from this book are already used; close it instead' using errcode = '22023';
      end if;
      delete from public.receipt_books where id = b.id;
    else raise exception 'bad action' using errcode = '22023';
    end if;
  end if;
  select full_name into v_name from public.staff where user_id = b.user_id;
  perform app_private.log('book_' || (p ->> 'action'), v_name, null,
    jsonb_build_object('from_no', b.from_no, 'to_no', b.to_no, 'note', b.note, 'book', (select code from public.receipt_series where id = b.series_id)));
  return jsonb_build_object('id', v_id);
end;
$$;

-- ---------------------------------------------------------------- zones with their books
-- last receipt used in a book (from its start up), and the next one
create or replace function app_private.series_last(p_series bigint)
returns bigint language sql stable security definer set search_path = '' as $$
  select max(n) from (
    select max(receipt_no) n from public.payments where series_id = p_series and receipt_no >= (select start_no from public.receipt_series where id = p_series)
    union all
    select max(receipt_no) from public.pending_payments where series_id = p_series and receipt_no >= (select start_no from public.receipt_series where id = p_series)
    union all
    select max(receipt_no) from public.legacy_payments where series_id = p_series and receipt_no >= (select start_no from public.receipt_series where id = p_series)) x;
$$;

drop function if exists public.zone_status();
create or replace function public.zone_status()
returns table (id bigint, name text, active boolean, accounts int, book_id bigint, book_no int, book_code text, book_start bigint,
               book_opened timestamptz, last_used bigint, next_no bigint, receipts int, books jsonb)
language sql stable security definer set search_path = '' as $$
  select z.id, z.name, z.active,
         ((select count(*) from public.loans l where upper(btrim(l.zone)) = z.name)
          + (select count(*) from public.legacy_accounts a where upper(btrim(a.zone)) = z.name))::int,
         s.id, s.book_no, s.code, s.start_no, s.opened_at,
         app_private.series_last(s.id),
         coalesce(app_private.series_last(s.id) + 1, s.start_no),
         ((select count(*) from public.payments where series_id = s.id) + (select count(*) from public.pending_payments where series_id = s.id))::int,
         coalesce((select jsonb_agg(jsonb_build_object('code', o.code, 'book_no', o.book_no, 'start', o.start_no, 'opened', o.opened_at,
                                                       'closed', o.closed_at, 'last', app_private.series_last(o.id),
                                                       'receipts', (select count(*) from public.payments where series_id = o.id)
                                                                   + (select count(*) from public.legacy_payments where series_id = o.id))
                                     order by o.book_no desc)
                     from public.receipt_series o where o.zone_id = z.id and o.closed_at is not null), '[]')
    from public.zones z
    left join public.receipt_series s on s.zone_id = z.id and s.closed_at is null
   where public.is_staff()
   order by z.name;
$$;

create or replace function public.admin_zone(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
-- p = { action: add | rename | new_book | hide | show | delete, id, name, receipt_start }
declare z public.zones; v_start bigint; v_name text := upper(btrim(p ->> 'name')); cur public.receipt_series; v_book int;
begin
  if not public.is_admin() then raise exception 'only admin' using errcode = '42501'; end if;
  if p ->> 'action' in ('add', 'rename') and nullif(v_name, '') is null then raise exception 'enter the zone name' using errcode = '22023'; end if;
  if p ->> 'action' in ('add', 'new_book') then
    v_start := (p ->> 'receipt_start')::bigint;
    if v_start is null or v_start <= 0 then raise exception 'enter the first receipt number of the book' using errcode = '22023'; end if;
  end if;

  if p ->> 'action' = 'add' then
    if exists (select 1 from public.zones where name = v_name) then raise exception 'a zone with this name already exists' using errcode = '22023'; end if;
    if exists (select 1 from public.receipt_series where code = v_name || '-1') then raise exception 'a book named %-1 already exists', v_name using errcode = '22023'; end if;
    insert into public.zones (name, receipt_start) values (v_name, v_start) returning * into z;
    insert into public.receipt_series (zone_id, book_no, code, start_no) values (z.id, 1, v_name || '-1', v_start);
    perform app_private.log('zone_add', z.name, null, jsonb_build_object('book', v_name || '-1', 'start_no', v_start));
    return jsonb_build_object('id', z.id);
  end if;

  select * into z from public.zones where id = (p ->> 'id')::bigint for update;
  if not found then raise exception 'zone not found' using errcode = 'P0002'; end if;

  if p ->> 'action' = 'new_book' then
    select * into cur from public.receipt_series where zone_id = z.id and closed_at is null for update;
    select coalesce(max(book_no), 0) + 1 into v_book from public.receipt_series where zone_id = z.id;
    update public.receipt_series set closed_at = now() where id = cur.id;
    -- people's receipt books in the closed book close with it
    update public.receipt_books set closed_at = now() where series_id = cur.id and closed_at is null;
    insert into public.receipt_series (zone_id, book_no, code, start_no) values (z.id, v_book, z.name || '-' || v_book, v_start);
    update public.zones set receipt_start = v_start where id = z.id;
    perform app_private.log('zone_book', z.name, null, jsonb_build_object('book', z.name || '-' || v_book, 'start_no', v_start, 'closed', cur.code));
  elsif p ->> 'action' = 'rename' then
    if v_name <> z.name and exists (select 1 from public.zones where name = v_name) then raise exception 'a zone with this name already exists' using errcode = '22023'; end if;
    update public.zones set name = v_name where id = z.id;
    update public.loans set zone = v_name where upper(btrim(zone)) = z.name;
    update public.legacy_accounts set zone = v_name where upper(btrim(zone)) = z.name;
    perform app_private.log('zone_edit', v_name, null, jsonb_build_object('changes', jsonb_build_object('name', jsonb_build_object('from', z.name, 'to', v_name))));
  elsif p ->> 'action' in ('hide', 'show') then
    update public.zones set active = (p ->> 'action' = 'show') where id = z.id;
    perform app_private.log('zone_' || (p ->> 'action'), z.name, null, '{}'::jsonb);
  elsif p ->> 'action' = 'delete' then
    if exists (select 1 from public.loans where upper(btrim(zone)) = z.name)
       or exists (select 1 from public.legacy_accounts where upper(btrim(zone)) = z.name) then
      raise exception 'accounts are in this zone; hide it instead' using errcode = '22023';
    end if;
    if exists (select 1 from public.receipt_series s where s.zone_id = z.id and (
                 exists (select 1 from public.payments where series_id = s.id) or exists (select 1 from public.pending_payments where series_id = s.id)
                 or exists (select 1 from public.legacy_payments where series_id = s.id) or exists (select 1 from public.receipt_books where series_id = s.id))) then
      raise exception 'receipts were written in this zone''s books; hide it instead' using errcode = '22023';
    end if;
    delete from public.receipt_series where zone_id = z.id;
    delete from public.zones where id = z.id;
    perform app_private.log('zone_delete', z.name, null, '{}'::jsonb);
  else
    raise exception 'bad action' using errcode = '22023';
  end if;
  return jsonb_build_object('id', z.id);
end;
$$;

-- ---------------------------------------------------------------- Collect window hint: inside the account's book
drop function if exists public.receipt_hint(text, bigint);
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
    'series', case when s.zone_id is not null then jsonb_build_object(
                'code', s.code, 'zone', (select name from public.zones where id = s.zone_id), 'book_no', s.book_no, 'start', s.start_no,
                'last', app_private.series_last(s.id), 'next', coalesce(app_private.series_last(s.id) + 1, s.start_no)) end
  )
  from s
  where public.has_perm('collect');
$$;

-- ---------------------------------------------------------------- lists that show receipt numbers also show the book
drop function if exists public.pending_approvals();
create or replace function public.pending_approvals()
returns table (id bigint, user_id uuid, subject text, source text, ref_id bigint, paid_amount numeric, paid_date date, receipt_no bigint,
               payment_mode text, reason text, by_name text, created_at timestamptz, cash_part numeric, receipt_book text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.created_by,
         case when p.source = 'old' then (select 'SNO ' || a.sno || ' · ' || a.borrower_name from public.legacy_accounts a where a.sno = p.ref_id)
              else (select 'Folio ' || l.folio_no || ' · ' || b.full_name from public.loans l join public.borrowers b on b.id = l.borrower_id where l.id = p.ref_id) end,
         p.source, p.ref_id, p.paid_amount, p.paid_date, p.receipt_no,
         public.payment_mode_text(p.payment_mode, p.bank_name, p.parts), p.note, app_private.staff_name(p.created_by), p.created_at,
         public.mode_part(p.payment_mode, p.paid_amount, p.parts, 'CASH'), p.receipt_book
    from public.pending_payments p
   where public.has_perm('approve')
   order by p.created_by, p.created_at;
$$;

create or replace view public.day_book_entries
with (security_invoker = true)
as
select lp.paid_date                                  as entry_date,
       1                                             as kind_order,
       'receipt'::text                               as kind,
       coalesce(a.borrower_name, 'UNKNOWN ACCOUNT')
         || coalesce(' ' || a.registration_no, '')   as particulars,
       a.fno::text                                   as folio,
       lp.due_amount, lp.due_date, lp.delay_days,
       case when a.emi_amount > 0 then greatest(1, round(lp.paid_amount / a.emi_amount))::int end as im,
       coalesce(lp.payment_mode, 'CASH')             as mode,
       lp.receipt_no::bigint                         as receipt_no,
       lp.paid_amount                                as debit,
       0::numeric(14,2)                              as credit,
       'old'::text                                   as source,
       lp.sno::bigint                                as ref_id,
       lp.receipt_book                               as receipt_book
from public.legacy_payments lp
left join public.legacy_accounts a on a.id = lp.account_id
where lp.paid_date is not null and (a.id is null or lp.ledger = a.ledger)
union all
select p.paid_date, 1, 'receipt',
       coalesce(a.borrower_name, b.full_name) || coalesce(' ' || coalesce(a.registration_no, l.vehicle_no), ''),
       coalesce(a.fno::text, l.folio_no),
       p.due_amount, p.due_date, p.delay_days,
       case when coalesce(a.emi_amount, l.emi_amount) > 0 then greatest(1, round(p.paid_amount / coalesce(a.emi_amount, l.emi_amount)))::int end,
       case when p.payment_mode = 'SPLIT' then (select string_agg(x ->> 'mode', '+' order by o) from jsonb_array_elements(p.parts) with ordinality t(x, o))
            else p.payment_mode end,
       p.receipt_no, p.paid_amount, 0,
       case when p.loan_id is null then 'old' else 'new' end,
       coalesce(a.sno::bigint, l.id),
       p.receipt_book
from public.payments p
left join public.legacy_accounts a on a.id = p.legacy_account_id
left join public.loans l on l.id = p.loan_id
left join public.borrowers b on b.id = l.borrower_id
union all
select a.agreement_date, 2, 'loan',
       a.borrower_name || coalesce(' ' || a.registration_no, ''),
       a.fno::text, null, null, null, null,
       coalesce(a.finance_mode, 'CASH'), null, 0, a.finance_amount, 'old', a.sno::bigint, null
from public.legacy_accounts a
where a.agreement_date is not null and a.finance_amount > 0
union all
select l.agreement_date, 2, 'loan',
       b.full_name || coalesce(' ' || l.vehicle_no, ''),
       l.folio_no, null, null, null, null,
       l.loan_type, null, 0, l.finance_amount, 'new', l.id, null
from public.loans l
join public.borrowers b on b.id = l.borrower_id;

-- receipt books go into backups / restore points
create or replace function app_private.data_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['zones','receipt_series','import_batches','legacy_accounts','legacy_payments','borrowers','loans','payments','seizures',
               'adjustments','receipt_books','cash_closings','collection_assignments','pending_payments'];
$$;

revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke execute on function public.zone_status(), public.admin_zone(jsonb), public.receipt_hint(text, bigint), public.pending_approvals(),
  public.receipt_book_status(), public.admin_receipt_book(jsonb) from anon, public;
grant execute on function public.zone_status(), public.admin_zone(jsonb), public.receipt_hint(text, bigint), public.pending_approvals(),
  public.receipt_book_status(), public.admin_receipt_book(jsonb) to authenticated;

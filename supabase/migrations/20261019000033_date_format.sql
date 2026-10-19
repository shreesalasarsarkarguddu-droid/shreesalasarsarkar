-- One date format everywhere: DD/MM/YYYY (21/12/1993), never month names.
-- Telegram / SMS texts built in the database used 'DD-MM-YYYY' and 'DD Mon YYYY'; patch every function that does.

do $$
declare
  f record;
  def text;
  n int := 0;
begin
  for f in
    select p.oid, n.nspname, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private') and p.prokind = 'f'
      and (pg_get_functiondef(p.oid) like '%''DD-MM-YYYY''%' or pg_get_functiondef(p.oid) like '%''DD Mon YYYY%')
  loop
    def := pg_get_functiondef(f.oid);
    def := replace(def, '''DD Mon YYYY HH24:MI''', '''DD/MM/YYYY HH12:MI AM''');
    def := replace(def, '''DD Mon YYYY''', '''DD/MM/YYYY''');
    def := replace(def, '''DD-MM-YYYY''', '''DD/MM/YYYY''');
    if def like '%''DD Mon%' or def like '%''DD-MM-YYYY''%' then
      raise exception 'date format left in %.%', f.nspname, f.proname;
    end if;
    execute def;
    n := n + 1;
  end loop;
  if n < 9 then
    raise exception 'expected 9 functions with old date formats, patched %', n;
  end if;
end $$;

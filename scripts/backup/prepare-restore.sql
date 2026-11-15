-- Runs before a restore, in replica mode (no triggers). Refuses a database with any account: a
-- restore only goes into a fresh one. Then removes the default rows the migrations insert
-- (settings, message templates), which the backup brings back with their real values.
do $$
declare
  t record;
begin
  if exists (select 1 from public.staff) or exists (select 1 from auth.users) then
    raise exception 'target database has accounts: restore only into a fresh database';
  end if;
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    execute format('delete from public.%I', t.table_name);
  end loop;
end
$$;

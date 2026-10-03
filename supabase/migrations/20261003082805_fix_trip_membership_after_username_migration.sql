-- Username-only membership no longer has invited/active status.
-- Preserve the existing save function and its privileges; remove only the obsolete predicate.
begin;
do $$
declare v_definition text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'space_members' and column_name = 'status'
  ) then
    v_definition := pg_get_functiondef(
      'public.save_trip_plan(uuid,uuid,uuid,integer,text,text,text,jsonb,text)'::regprocedure
    );
    if position('and status = ''active''' in v_definition) > 0 then
      execute replace(v_definition, 'and status = ''active''', '');
    end if;
  end if;
end $$;
commit;

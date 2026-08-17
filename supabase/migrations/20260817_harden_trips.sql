revoke all on function public.save_trip_plan(uuid,uuid,uuid,integer,text,text,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.save_trip_plan(uuid,uuid,uuid,integer,text,text,text,jsonb,text)
  to service_role;

create index if not exists trips_created_by_idx on public.trips(created_by);
create index if not exists trips_updated_by_idx on public.trips(updated_by);
create index if not exists trip_items_day_trip_idx on public.trip_items(day_id, trip_id);

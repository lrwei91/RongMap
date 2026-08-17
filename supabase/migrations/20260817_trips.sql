create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 240),
  start_date date,
  status text not null default 'draft' check (status in ('draft','ready')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.trip_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_index integer not null check (day_index between 1 and 30),
  visit_date date,
  title text not null default '' check (char_length(title) <= 80),
  unique(trip_id, day_index)
);

create table if not exists public.trip_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_id uuid not null,
  location_id uuid references public.locations(id) on delete set null,
  sort_order integer not null check (sort_order between 0 and 199),
  start_time time,
  end_time time,
  note text not null default '' check (char_length(note) <= 240),
  location_name text not null check (char_length(location_name) between 1 and 120),
  location_address text not null default '' check (char_length(location_address) <= 240),
  category text not null default 'food' check (category in ('food','spot','cafe_bar')),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  unique(day_id, sort_order)
);

alter table public.share_links add column if not exists scope text not null default 'space';
alter table public.share_links add column if not exists trip_id uuid references public.trips(id) on delete cascade;
alter table public.share_links drop constraint if exists share_links_scope_check;
alter table public.share_links add constraint share_links_scope_check check (scope in ('space','trip'));
alter table public.share_links drop constraint if exists share_links_scope_target_check;
alter table public.share_links add constraint share_links_scope_target_check check (
  (scope = 'space' and trip_id is null) or (scope = 'trip' and trip_id is not null)
);

create index if not exists trips_space_updated_idx on public.trips(space_id, updated_at desc) where deleted_at is null;
create index if not exists trip_days_trip_idx on public.trip_days(trip_id, day_index);
create unique index if not exists trip_days_id_trip_idx on public.trip_days(id, trip_id);
create index if not exists trip_items_trip_idx on public.trip_items(trip_id, sort_order);
create index if not exists trip_items_day_idx on public.trip_items(day_id, sort_order);
create index if not exists trip_items_location_idx on public.trip_items(location_id);
create index if not exists share_links_trip_idx on public.share_links(trip_id) where trip_id is not null;

alter table public.trip_items drop constraint if exists trip_items_day_trip_fkey;
alter table public.trip_items add constraint trip_items_day_trip_fkey
  foreign key(day_id, trip_id) references public.trip_days(id, trip_id) on delete cascade;

alter table public.trips enable row level security;
alter table public.trip_days enable row level security;
alter table public.trip_items enable row level security;

grant select on table public.trips, public.trip_days, public.trip_items to authenticated;

drop policy if exists trips_member_select on public.trips;
create policy trips_member_select on public.trips for select to authenticated
using (private.is_space_member(space_id));
drop policy if exists trips_member_insert on public.trips;
create policy trips_member_insert on public.trips for insert to authenticated
with check (private.is_space_member(space_id) and created_by = (select auth.uid()));
drop policy if exists trips_member_update on public.trips;
create policy trips_member_update on public.trips for update to authenticated
using (private.is_space_member(space_id)) with check (private.is_space_member(space_id));
drop policy if exists trips_member_delete on public.trips;
create policy trips_member_delete on public.trips for delete to authenticated
using (private.is_space_member(space_id));

drop policy if exists trip_days_member_all on public.trip_days;
create policy trip_days_member_all on public.trip_days for all to authenticated
using (exists(select 1 from public.trips where id = trip_id and private.is_space_member(space_id)))
with check (exists(select 1 from public.trips where id = trip_id and private.is_space_member(space_id)));

drop policy if exists trip_items_member_all on public.trip_items;
create policy trip_items_member_all on public.trip_items for all to authenticated
using (exists(
  select 1 from public.trips t
  join public.trip_days d on d.id = trip_items.day_id and d.trip_id = t.id
  where t.id = trip_items.trip_id and private.is_space_member(t.space_id)
))
with check (exists(
  select 1 from public.trips t
  join public.trip_days d on d.id = trip_items.day_id and d.trip_id = t.id
  where t.id = trip_items.trip_id and private.is_space_member(t.space_id)
));

create or replace function public.save_trip_plan(
  p_trip_id uuid,
  p_space_id uuid,
  p_actor_id uuid,
  p_expected_version integer,
  p_name text,
  p_description text,
  p_start_date text,
  p_days jsonb,
  p_activity_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip_id uuid;
  v_version integer;
  v_day jsonb;
  v_item jsonb;
  v_day_id uuid;
  v_location public.locations%rowtype;
  v_day_count integer;
  v_item_count integer := 0;
  v_index integer;
begin
  if not exists (
    select 1 from public.space_members
    where space_id = p_space_id and user_id = p_actor_id and status = 'active'
  ) then raise exception '不是当前空间成员' using errcode = '42501'; end if;

  if char_length(trim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception '行程名称长度必须为 1 到 80 个字符' using errcode = '22023';
  end if;
  if char_length(coalesce(p_description, '')) > 240 then
    raise exception '行程说明不能超过 240 个字符' using errcode = '22023';
  end if;
  v_day_count := jsonb_array_length(coalesce(p_days, '[]'::jsonb));
  if v_day_count not between 1 and 30 then
    raise exception '行程天数必须为 1 到 30 天' using errcode = '22023';
  end if;

  if p_trip_id is null then
    insert into public.trips(space_id,name,description,start_date,created_by,updated_by)
    values (p_space_id,trim(p_name),coalesce(p_description,''),nullif(p_start_date,'')::date,p_actor_id,p_actor_id)
    returning id,version into v_trip_id,v_version;
  else
    select id,version into v_trip_id,v_version from public.trips
    where id = p_trip_id and space_id = p_space_id and deleted_at is null for update;
    if v_trip_id is null then raise exception '未找到该行程' using errcode = 'P0002'; end if;
    if p_expected_version is null or p_expected_version <> v_version then
      return jsonb_build_object('conflict',true,'tripId',v_trip_id,'latestVersion',v_version);
    end if;
    v_version := v_version + 1;
    update public.trips set name=trim(p_name),description=coalesce(p_description,''),
      start_date=nullif(p_start_date,'')::date,version=v_version,updated_by=p_actor_id,updated_at=now()
    where id=v_trip_id;
    delete from public.trip_days where trip_id=v_trip_id;
  end if;

  for v_day in select value from jsonb_array_elements(p_days) loop
    insert into public.trip_days(trip_id,day_index,visit_date,title)
    values (
      v_trip_id,
      greatest(1,least(30,coalesce((v_day->>'dayIndex')::integer,1))),
      nullif(v_day->>'date','')::date,
      left(coalesce(v_day->>'title',''),80)
    ) returning id into v_day_id;

    v_index := 0;
    for v_item in select value from jsonb_array_elements(coalesce(v_day->'items','[]'::jsonb)) loop
      v_item_count := v_item_count + 1;
      if v_item_count > 200 then raise exception '单个行程最多包含 200 个地点' using errcode = '22023'; end if;
      v_location := null;
      if nullif(v_item->>'locationId','') is not null then
        select * into v_location from public.locations
        where id=(v_item->>'locationId')::uuid and space_id=p_space_id;
        if v_location.id is null then raise exception '行程包含其他空间的地点' using errcode = '42501'; end if;
      end if;
      insert into public.trip_items(
        trip_id,day_id,location_id,sort_order,start_time,end_time,note,
        location_name,location_address,category,latitude,longitude
      ) values (
        v_trip_id,v_day_id,v_location.id,v_index,
        nullif(v_item->>'startTime','')::time,nullif(v_item->>'endTime','')::time,
        left(coalesce(v_item->>'note',''),240),
        left(coalesce(v_location.name,v_item->>'name','地点'),120),
        left(coalesce(v_location.address,v_item->>'address',''),240),
        case when coalesce(v_location.category,v_item->>'category','food') in ('food','spot','cafe_bar')
          then coalesce(v_location.category,v_item->>'category','food') else 'food' end,
        coalesce(v_location.latitude,nullif(v_item->>'latitude','')::double precision),
        coalesce(v_location.longitude,nullif(v_item->>'longitude','')::double precision)
      );
      v_index := v_index + 1;
    end loop;
  end loop;

  insert into public.activity_logs(space_id,actor_id,actor_name,action,target_name,metadata)
  select p_space_id,p_actor_id,coalesce(name,email,'空间成员'),
    case when p_activity_action in ('trip_created','trip_updated','trip_optimized') then p_activity_action else 'trip_updated' end,
    trim(p_name),jsonb_build_object('tripId',v_trip_id)
  from public.profiles where id=p_actor_id;

  return jsonb_build_object('conflict',false,'tripId',v_trip_id,'version',v_version);
end
$$;

revoke all on function public.save_trip_plan(uuid,uuid,uuid,integer,text,text,text,jsonb,text) from public, anon;
grant execute on function public.save_trip_plan(uuid,uuid,uuid,integer,text,text,text,jsonb,text) to service_role;

do $$ begin
  alter publication supabase_realtime add table public.trips;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.trip_days;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.trip_items;
exception when duplicate_object then null;
end $$;

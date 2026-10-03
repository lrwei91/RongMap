begin;
alter table public.trips add column if not exists roadbook jsonb not null default '{}'::jsonb
  check (jsonb_typeof(roadbook) = 'object' and octet_length(roadbook::text) <= 131072);

-- Both saves run in one transaction under the original version lock and membership check.
create or replace function public.save_roadbook_trip_plan(
  p_trip_id uuid, p_space_id uuid, p_actor_id uuid, p_expected_version integer,
  p_name text, p_description text, p_start_date text, p_days jsonb,
  p_activity_action text, p_roadbook jsonb
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  if p_roadbook is null or jsonb_typeof(p_roadbook) <> 'object' or octet_length(p_roadbook::text) > 131072 then
    raise exception '路书格式不正确或超过大小限制' using errcode = '22023';
  end if;
  v_result := public.save_trip_plan(p_trip_id,p_space_id,p_actor_id,p_expected_version,
    p_name,p_description,p_start_date,p_days,p_activity_action);
  if coalesce((v_result->>'conflict')::boolean,false) then return v_result; end if;
  update public.trips set roadbook = p_roadbook
    where id = (v_result->>'tripId')::uuid and space_id = p_space_id;
  return v_result;
end $$;
revoke all on function public.save_roadbook_trip_plan(uuid,uuid,uuid,integer,text,text,text,jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_roadbook_trip_plan(uuid,uuid,uuid,integer,text,text,text,jsonb,text,jsonb) to service_role;
commit;

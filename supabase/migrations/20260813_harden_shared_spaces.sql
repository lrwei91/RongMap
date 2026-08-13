create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_space_member(target_space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.space_members
    where space_id = target_space
      and user_id = (select auth.uid())
      and status = 'active'
  )
$$;

create or replace function private.is_space_admin(target_space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.space_members
    where space_id = target_space
      and user_id = (select auth.uid())
      and role = 'admin'
      and status = 'active'
  )
$$;

revoke all on function private.is_space_member(uuid) from public, anon;
revoke all on function private.is_space_admin(uuid) from public, anon;
grant execute on function private.is_space_member(uuid) to authenticated;
grant execute on function private.is_space_admin(uuid) to authenticated;

drop policy if exists profiles_self_or_space on public.profiles;
create policy profiles_self_or_space on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or exists(
    select 1
    from public.space_members mine
    join public.space_members theirs on mine.space_id = theirs.space_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = profiles.id
  )
);

drop policy if exists spaces_member_select on public.spaces;
create policy spaces_member_select on public.spaces for select to authenticated using (private.is_space_member(id));
drop policy if exists members_member_select on public.space_members;
create policy members_member_select on public.space_members for select to authenticated using (private.is_space_member(space_id));
drop policy if exists locations_member_select on public.locations;
create policy locations_member_select on public.locations for select to authenticated using (private.is_space_member(space_id));
drop policy if exists locations_member_insert on public.locations;
create policy locations_member_insert on public.locations for insert to authenticated with check (
  private.is_space_member(space_id) and created_by = (select auth.uid())
);
drop policy if exists locations_member_update on public.locations;
create policy locations_member_update on public.locations for update to authenticated
using (private.is_space_member(space_id)) with check (private.is_space_member(space_id));
drop policy if exists tags_member_all on public.tags;
create policy tags_member_all on public.tags for all to authenticated
using (private.is_space_member(space_id)) with check (private.is_space_member(space_id));
drop policy if exists location_tags_member_all on public.location_tags;
create policy location_tags_member_all on public.location_tags for all to authenticated
using (exists(select 1 from public.locations where id = location_id and private.is_space_member(space_id)))
with check (exists(select 1 from public.locations where id = location_id and private.is_space_member(space_id)));
drop policy if exists activity_member_select on public.activity_logs;
create policy activity_member_select on public.activity_logs for select to authenticated using (private.is_space_member(space_id));
drop policy if exists share_admin_all on public.share_links;
create policy share_admin_all on public.share_links for all to authenticated
using (private.is_space_admin(space_id)) with check (private.is_space_admin(space_id));
drop policy if exists imports_member_all on public.import_sessions;
create policy imports_member_all on public.import_sessions for all to authenticated
using (private.is_space_member(space_id)) with check (private.is_space_member(space_id));

drop function if exists public.is_space_member(uuid);
drop function if exists public.is_space_admin(uuid);

create index if not exists activity_logs_actor_idx on public.activity_logs(actor_id);
create index if not exists import_sessions_created_by_idx on public.import_sessions(created_by);
create index if not exists import_sessions_space_idx on public.import_sessions(space_id);
create index if not exists location_tags_tag_idx on public.location_tags(tag_id);
create index if not exists locations_created_by_idx on public.locations(created_by);
create index if not exists locations_deleted_by_idx on public.locations(deleted_by);
create index if not exists locations_updated_by_idx on public.locations(updated_by);
create index if not exists share_links_created_by_idx on public.share_links(created_by);
create index if not exists share_links_space_idx on public.share_links(space_id);
create index if not exists space_members_invited_by_idx on public.space_members(invited_by);
create index if not exists space_members_user_idx on public.space_members(user_id);
create index if not exists spaces_created_by_idx on public.spaces(created_by);
create index if not exists tags_created_by_idx on public.tags(created_by);

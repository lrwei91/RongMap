create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '空间成员',
  created_at timestamptz not null default now()
);

create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  status text not null default 'active' check (status in ('invited','active')),
  invited_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  address text not null check (char_length(address) between 1 and 240),
  reason text not null default '' check (char_length(reason) <= 240),
  category text not null default 'food' check (category in ('food','spot','cafe_bar')),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  source_id text,
  source_type text not null default 'manual',
  source_platform text not null default 'web',
  source_content text,
  match_type text,
  poi_type text,
  normalized_address text,
  city text,
  district text,
  confidence double precision,
  rule_decision jsonb,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id),
  created_by_name text,
  updated_by uuid references public.profiles(id),
  deleted_by uuid references public.profiles(id),
  deleted_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists locations_space_active_idx on public.locations(space_id, created_at desc) where deleted_at is null;
create index if not exists locations_space_deleted_idx on public.locations(space_id, deleted_at desc) where deleted_at is not null;
create index if not exists locations_source_idx on public.locations(space_id, source_id) where source_id is not null;
create index if not exists locations_name_idx on public.locations(space_id, lower(name));

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(space_id, name)
);

create table if not exists public.location_tags (
  location_id uuid not null references public.locations(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key(location_id, tag_id)
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  actor_name text not null,
  action text not null,
  target_name text,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_space_created_idx on public.activity_logs(space_id, created_at desc);

create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  token_hash text not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_accessed_at timestamptz
);

create table if not exists public.import_sessions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  status text not null default 'preview',
  policy text,
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create or replace function public.is_space_member(target_space uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.space_members where space_id=target_space and user_id=auth.uid() and status='active') $$;

create or replace function public.is_space_admin(target_space uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.space_members where space_id=target_space and user_id=auth.uid() and role='admin' and status='active') $$;

alter table public.profiles enable row level security;
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.locations enable row level security;
alter table public.tags enable row level security;
alter table public.location_tags enable row level security;
alter table public.activity_logs enable row level security;
alter table public.share_links enable row level security;
alter table public.import_sessions enable row level security;

drop policy if exists profiles_self_or_space on public.profiles;
create policy profiles_self_or_space on public.profiles for select to authenticated using (id=auth.uid() or exists(select 1 from public.space_members mine join public.space_members theirs on mine.space_id=theirs.space_id where mine.user_id=auth.uid() and mine.status='active' and theirs.user_id=profiles.id));
drop policy if exists spaces_member_select on public.spaces;
create policy spaces_member_select on public.spaces for select to authenticated using (public.is_space_member(id));
drop policy if exists members_member_select on public.space_members;
create policy members_member_select on public.space_members for select to authenticated using (public.is_space_member(space_id));
drop policy if exists locations_member_select on public.locations;
create policy locations_member_select on public.locations for select to authenticated using (public.is_space_member(space_id));
drop policy if exists locations_member_insert on public.locations;
create policy locations_member_insert on public.locations for insert to authenticated with check (public.is_space_member(space_id) and created_by=auth.uid());
drop policy if exists locations_member_update on public.locations;
create policy locations_member_update on public.locations for update to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
drop policy if exists tags_member_all on public.tags;
create policy tags_member_all on public.tags for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));
drop policy if exists location_tags_member_all on public.location_tags;
create policy location_tags_member_all on public.location_tags for all to authenticated using (exists(select 1 from public.locations where id=location_id and public.is_space_member(space_id))) with check (exists(select 1 from public.locations where id=location_id and public.is_space_member(space_id)));
drop policy if exists activity_member_select on public.activity_logs;
create policy activity_member_select on public.activity_logs for select to authenticated using (public.is_space_member(space_id));
drop policy if exists share_admin_all on public.share_links;
create policy share_admin_all on public.share_links for all to authenticated using (public.is_space_admin(space_id)) with check (public.is_space_admin(space_id));
drop policy if exists imports_member_all on public.import_sessions;
create policy imports_member_all on public.import_sessions for all to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));

do $$ begin
  alter publication supabase_realtime add table public.locations;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.activity_logs;
exception when duplicate_object then null;
end $$;

-- 用户名登录后不再区分「已邀请 / 已加入」：成员由管理员在设置页直接注册。
-- 本迁移移除 status 列，调用方不再依赖邀请状态。
-- 顺序要点：profiles 的 RLS 策略直接内联引用了 space_members.status，
-- 必须先删策略、再删列，最后重建不带 status 的策略，否则 drop column 会报 2BP01。

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
  )
$$;

drop policy if exists profiles_self_or_space on public.profiles;

alter table public.space_members drop column if exists status;

create policy profiles_self_or_space on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or exists(
    select 1
    from public.space_members mine
    join public.space_members theirs on mine.space_id = theirs.space_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = profiles.id
  )
);
-- 用户名登录后不再区分「已邀请 / 已加入」：成员由管理员在设置页直接注册。
-- 本迁移清空残留成员数据并移除 status 列，调用方不再依赖邀请状态。
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

alter table public.space_members drop column if exists status;
alter table public.app_admins
  add column if not exists permissions text[] not null default array['evaluation', 'leave']::text[];

alter table public.app_admins
  drop constraint if exists app_admins_permissions_check;

alter table public.app_admins
  add constraint app_admins_permissions_check
  check (permissions <@ array['evaluation', 'leave']::text[] and cardinality(permissions) > 0);

insert into public.app_admins (email, active, permissions)
values ('anongnad.w@psuwitsurat.ac.th', true, array['leave']::text[])
on conflict (email) do update
set active = excluded.active,
    permissions = excluded.permissions;

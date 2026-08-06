alter table public.employees
  add column if not exists national_id text not null default '',
  add column if not exists bank_account text not null default '';

comment on column public.employees.national_id is 'Sensitive: national identity or taxpayer number. Server-side access only.';
comment on column public.employees.bank_account is 'Sensitive: bank account number. Server-side access only.';

create table if not exists public.app_admins (
  email text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

insert into public.app_admins (email, active)
values ('panuwat.pond@gmail.com', true)
on conflict (email) do update set active = excluded.active;

create extension if not exists pgcrypto;

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text unique,
  full_name text not null,
  email text not null default '',
  position text not null default '',
  personnel_group text not null default '',
  active boolean not null default true,
  source_sheet text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.evaluation_cycles (
  id uuid primary key default gen_random_uuid(),
  academic_year integer not null unique,
  title text not null,
  period_start date,
  period_end date,
  status text not null default 'draft' check (status in ('draft','ready','sent')),
  created_at timestamptz not null default now()
);

create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.evaluation_cycles(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  evaluation_score numeric(5,2) check (evaluation_score between 0 and 100),
  old_salary numeric(12,2) not null default 0 check (old_salary >= 0),
  raise_percent numeric(6,3) not null default 0 check (raise_percent >= 0),
  comment_1 text not null default '',
  comment_2 text not null default '',
  comment_3 text not null default '',
  comment_4 text not null default '',
  comment_5 text not null default '',
  status text not null default 'draft' check (status in ('draft','ready','sent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(cycle_id, employee_id)
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  imported_rows integer not null default 0,
  rejected_rows integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.employees enable row level security;
alter table public.evaluation_cycles enable row level security;
alter table public.evaluations enable row level security;
alter table public.import_batches enable row level security;

create index if not exists employees_email_idx on public.employees(email);
create index if not exists evaluations_cycle_idx on public.evaluations(cycle_id);

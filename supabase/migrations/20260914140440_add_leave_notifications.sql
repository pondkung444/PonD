create table if not exists public.leave_cycles (
  id uuid primary key default gen_random_uuid(),
  academic_year integer not null unique,
  as_of_date date not null,
  source_file_name text not null default '',
  imported_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_leave_balances (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.leave_cycles(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  source_row integer not null check (source_row >= 1),
  used_previous_term_1 numeric(7,2) not null default 0 check (used_previous_term_1 >= 0),
  used_previous_term_2 numeric(7,2) not null default 0 check (used_previous_term_2 >= 0),
  accumulated_previous numeric(7,2) not null default 0 check (accumulated_previous >= 0),
  added_days numeric(7,2) not null default 0 check (added_days >= 0),
  previous_year_balance numeric(7,2) not null default 0 check (previous_year_balance >= 0),
  total_days numeric(7,2) not null default 0 check (total_days >= 0),
  compensation_days numeric(7,2) not null default 0 check (compensation_days >= 0),
  net_accumulated_days numeric(7,2) not null default 0 check (net_accumulated_days >= 0),
  used_current_term_1 numeric(7,2) not null default 0 check (used_current_term_1 >= 0),
  used_current_term_2 numeric(7,2) not null default 0 check (used_current_term_2 >= 0),
  remaining_days numeric(7,2) not null default 0 check (remaining_days >= 0),
  snapshot_full_name text not null,
  snapshot_email text not null,
  snapshot_position text not null default '',
  updated_at timestamptz not null default now(),
  unique (cycle_id, employee_id),
  check (total_days = previous_year_balance + added_days),
  check (net_accumulated_days = total_days - compensation_days),
  check (remaining_days = net_accumulated_days - used_current_term_1 - used_current_term_2)
);

create table if not exists public.leave_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  leave_balance_id uuid not null references public.employee_leave_balances(id) on delete cascade,
  recipient_email text not null,
  sender_email text not null,
  delivery_type text not null default 'live' check (delivery_type in ('test', 'live')),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  provider_message_id text,
  error_message text,
  sent_by text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (request_id, leave_balance_id)
);

create index if not exists employee_leave_balances_cycle_idx on public.employee_leave_balances (cycle_id);
create index if not exists leave_email_deliveries_balance_idx on public.leave_email_deliveries (leave_balance_id, created_at desc);

alter table public.leave_cycles enable row level security;
alter table public.employee_leave_balances enable row level security;
alter table public.leave_email_deliveries enable row level security;

revoke all on public.leave_cycles from anon, authenticated;
revoke all on public.employee_leave_balances from anon, authenticated;
revoke all on public.leave_email_deliveries from anon, authenticated;
grant select, insert, update, delete on public.leave_cycles to service_role;
grant select, insert, update, delete on public.employee_leave_balances to service_role;
grant select, insert, update, delete on public.leave_email_deliveries to service_role;

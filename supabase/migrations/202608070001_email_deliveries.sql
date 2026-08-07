create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  recipient_email text not null,
  sender_email text not null,
  delivery_type text not null default 'live' check (delivery_type in ('test', 'live')),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  provider_message_id text,
  error_message text,
  sent_by text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (request_id, evaluation_id)
);

alter table public.email_deliveries enable row level security;

alter table public.email_deliveries
  add column if not exists delivery_type text not null default 'live';

create index if not exists email_deliveries_evaluation_idx
  on public.email_deliveries (evaluation_id, created_at desc);

create index if not exists email_deliveries_request_idx
  on public.email_deliveries (request_id);

comment on table public.email_deliveries is 'Server-side audit log for confidential personnel report email attempts.';

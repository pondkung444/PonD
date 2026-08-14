alter table public.evaluations
  add column if not exists note text not null default '';

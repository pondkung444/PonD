alter table public.evaluation_cycles drop constraint if exists evaluation_cycles_status_check;
alter table public.evaluation_cycles add constraint evaluation_cycles_status_check
  check (status in ('draft','ready','sent','closed'));
alter table public.evaluation_cycles add column if not exists closed_at timestamptz;

alter table public.evaluations add column if not exists snapshot_full_name text;
alter table public.evaluations add column if not exists snapshot_email text;
alter table public.evaluations add column if not exists snapshot_position text;
alter table public.evaluations add column if not exists snapshot_national_id text;
alter table public.evaluations add column if not exists snapshot_bank_account text;
alter table public.evaluations add column if not exists snapshot_personnel_group text;
alter table public.evaluations add column if not exists snapshot_source_sheet text;

update public.evaluations evaluation
set snapshot_full_name = coalesce(evaluation.snapshot_full_name, employee.full_name),
    snapshot_email = coalesce(evaluation.snapshot_email, employee.email),
    snapshot_position = coalesce(evaluation.snapshot_position, employee.position),
    snapshot_national_id = coalesce(evaluation.snapshot_national_id, employee.national_id),
    snapshot_bank_account = coalesce(evaluation.snapshot_bank_account, employee.bank_account),
    snapshot_personnel_group = coalesce(evaluation.snapshot_personnel_group, employee.personnel_group),
    snapshot_source_sheet = coalesce(evaluation.snapshot_source_sheet, employee.source_sheet)
from public.employees employee
where employee.id = evaluation.employee_id;

alter table public.import_batches add column if not exists cycle_id uuid references public.evaluation_cycles(id) on delete set null;
create index if not exists import_batches_cycle_idx on public.import_batches(cycle_id);

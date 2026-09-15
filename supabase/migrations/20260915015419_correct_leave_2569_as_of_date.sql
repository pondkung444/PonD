update public.leave_cycles
set as_of_date = date '2026-09-15',
    updated_at = now()
where academic_year = 2569;

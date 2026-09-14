alter table public.evaluations
  alter column raise_percent drop not null,
  add column if not exists salary_increase numeric(12,2) null check (salary_increase >= 0),
  add column if not exists current_salary numeric(12,2) null check (current_salary >= 0);

update public.evaluations
set
  salary_increase = round(old_salary * raise_percent / 100),
  current_salary = old_salary + round(old_salary * raise_percent / 100)
where raise_percent is not null
  and (salary_increase is null or current_salary is null);

comment on column public.evaluations.salary_increase is 'จำนวนเงินที่เพิ่มตาม Excel ซึ่งอาจเป็นยอดปรับกลมและไม่เท่ากับ old_salary * raise_percent';
comment on column public.evaluations.current_salary is 'เงินเดือนปัจจุบันตาม Excel; null หมายถึงไม่แสดงยอดปรับในรายงาน';

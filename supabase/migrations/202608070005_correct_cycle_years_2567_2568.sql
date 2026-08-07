update public.evaluation_cycles
set academic_year = 2699
where academic_year = 2569;

update public.evaluation_cycles
set academic_year = 2567,
    title = 'ผลการประเมินและการปรับขึ้นเงินเดือน ปีการศึกษา 2567',
    period_start = '2024-05-01',
    period_end = '2025-04-30'
where academic_year = 2568;

update public.evaluation_cycles
set academic_year = 2568,
    title = 'ผลการประเมินและการปรับขึ้นเงินเดือน ปีการศึกษา 2568',
    period_start = '2025-05-01',
    period_end = '2026-04-30'
where academic_year = 2699;

import { NextResponse } from "next/server";
import { requireAdmin, supabaseConfig } from "@/lib/supabase-server";

type Cycle = { id: string; academic_year: number; title: string; period_start: string | null; period_end: string | null; status: "draft" | "ready" | "sent" | "closed"; closed_at: string | null };

export async function GET(request: Request) {
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบผู้ดูแล" }, { status: 401 });
  const { baseUrl, headers } = supabaseConfig();
  const response = await fetch(`${baseUrl}/rest/v1/evaluation_cycles?select=id,academic_year,title,period_start,period_end,status,closed_at&order=academic_year.desc`, { headers, cache: "no-store" });
  if (!response.ok) return databaseError(response);
  return NextResponse.json({ rows: await response.json() });
}

export async function POST(request: Request) {
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบผู้ดูแล" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { academicYear?: unknown; sourceYear?: unknown } | null;
  const academicYear = Number(body?.academicYear);
  const sourceYear = Number(body?.sourceYear);
  if (!Number.isInteger(academicYear) || !Number.isInteger(sourceYear) || academicYear <= sourceYear) return NextResponse.json({ error: "ปีการศึกษารอบใหม่ไม่ถูกต้อง" }, { status: 400 });
  const { baseUrl, headers } = supabaseConfig();
  const cyclesResponse = await fetch(`${baseUrl}/rest/v1/evaluation_cycles?select=id,academic_year,status&academic_year=in.(${sourceYear},${academicYear})`, { headers, cache: "no-store" });
  if (!cyclesResponse.ok) return databaseError(cyclesResponse);
  const cycles = (await cyclesResponse.json()) as Cycle[];
  if (cycles.some(cycle => cycle.academic_year === academicYear)) return NextResponse.json({ error: `มีรอบปี ${academicYear} อยู่แล้ว` }, { status: 409 });
  const source = cycles.find(cycle => cycle.academic_year === sourceYear);
  if (!source) return NextResponse.json({ error: `ไม่พบรอบปี ${sourceYear}` }, { status: 404 });
  const buddhistOffset = 543;
  const startYear = academicYear - buddhistOffset;
  const cycleResponse = await fetch(`${baseUrl}/rest/v1/evaluation_cycles`, { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify([{ academic_year: academicYear, title: `ผลการประเมินและการปรับขึ้นเงินเดือน ปีการศึกษา ${academicYear}`, period_start: `${startYear}-05-01`, period_end: `${startYear + 1}-04-30`, status: "draft" }]) });
  if (!cycleResponse.ok) return databaseError(cycleResponse);
  const [created] = (await cycleResponse.json()) as Cycle[];
  const sourceResponse = await fetch(`${baseUrl}/rest/v1/evaluations?select=employee_id,old_salary,raise_percent,snapshot_full_name,snapshot_email,snapshot_position,snapshot_national_id,snapshot_bank_account,snapshot_personnel_group,snapshot_source_sheet,employee:employees(active)&cycle_id=eq.${source.id}`, { headers, cache: "no-store" });
  if (!sourceResponse.ok) return databaseError(sourceResponse);
  const sourceRows = (await sourceResponse.json()) as Array<Record<string, unknown> & { employee_id: string; old_salary: number | string; raise_percent: number | string; employee?: { active?: boolean } }>;
  const activeRows = sourceRows.filter(row => row.employee?.active !== false);
  const evaluations = activeRows.map(row => ({
    cycle_id: created.id, employee_id: row.employee_id,
    old_salary: Math.round(Number(row.old_salary) * (1 + Number(row.raise_percent) / 100)), raise_percent: 0,
    evaluation_score: null, comment_1: "", comment_2: "", comment_3: "", comment_4: "", comment_5: "", status: "draft",
    snapshot_full_name: row.snapshot_full_name, snapshot_email: row.snapshot_email, snapshot_position: row.snapshot_position,
    snapshot_national_id: row.snapshot_national_id, snapshot_bank_account: row.snapshot_bank_account,
    snapshot_personnel_group: row.snapshot_personnel_group, snapshot_source_sheet: row.snapshot_source_sheet,
  }));
  if (evaluations.length) {
    const copyResponse = await fetch(`${baseUrl}/rest/v1/evaluations`, { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(evaluations) });
    if (!copyResponse.ok) return databaseError(copyResponse);
  }
  await fetch(`${baseUrl}/rest/v1/evaluation_cycles?id=eq.${source.id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: "closed", closed_at: new Date().toISOString() }) });
  return NextResponse.json({ ok: true, cycle: created, copied: evaluations.length });
}

async function databaseError(response: Response) {
  console.error("Supabase cycle request failed", response.status, await response.text());
  return NextResponse.json({ error: "จัดการรอบประเมินไม่สำเร็จ" }, { status: 500 });
}

import { NextResponse } from "next/server";
import { requireAdmin, supabaseConfig } from "@/lib/supabase-server";

export async function GET(request: Request) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบผู้ดูแล" }, { status: 401 });
  }
  const year = Number(new URL(request.url).searchParams.get("year"));
  const { baseUrl, headers } = supabaseConfig();
  const cycleResponse = await fetch(
    `${baseUrl}/rest/v1/evaluation_cycles?select=id,academic_year,status&${Number.isInteger(year) ? `academic_year=eq.${year}` : "order=academic_year.desc"}&limit=1`,
    { headers, cache: "no-store" },
  );
  if (!cycleResponse.ok) return databaseError(cycleResponse);
  const [cycle] = (await cycleResponse.json()) as { id: string; academic_year: number; status: string }[];
  if (!cycle) return NextResponse.json({ error: "ไม่พบรอบประเมิน" }, { status: 404 });

  const query = "select=id,evaluation_score,old_salary,raise_percent,comment_1,comment_2,comment_3,comment_4,comment_5,snapshot_full_name,snapshot_email,snapshot_position,snapshot_national_id,snapshot_bank_account,snapshot_personnel_group,snapshot_source_sheet,employee:employees(id,employee_code,full_name,email,position,national_id,bank_account,personnel_group,source_sheet,active)&cycle_id=eq.";
  const response = await fetch(`${baseUrl}/rest/v1/evaluations?${query}${cycle.id}&order=created_at.asc`, {
    headers,
    cache: "no-store",
  });
  if (!response.ok) return databaseError(response);
  const rows = (await response.json()) as unknown[];
  return NextResponse.json({ academicYear: cycle.academic_year, cycleStatus: cycle.status, rows });
}

export async function PATCH(request: Request) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบผู้ดูแล" }, { status: 401 });
  }
  const body = (await request.json()) as {
    evaluationId?: string; employeeId?: string; name?: string; email?: string; position?: string;
    nationalId?: string; bankAccount?: string;
    score?: number | null; oldSalary?: number; raisePercent?: number; comments?: string[];
  };
  if (!body.evaluationId || !body.employeeId) {
    return NextResponse.json({ error: "ข้อมูลอ้างอิงบุคลากรไม่ครบ" }, { status: 400 });
  }
  const { baseUrl, headers } = supabaseConfig();
  const lockResponse = await fetch(`${baseUrl}/rest/v1/evaluations?select=cycle:evaluation_cycles(status)&id=eq.${body.evaluationId}&limit=1`, { headers, cache: "no-store" });
  if (!lockResponse.ok) return databaseError(lockResponse);
  const [locked] = (await lockResponse.json()) as { cycle?: { status?: string } }[];
  if (locked?.cycle?.status === "closed") return NextResponse.json({ error: "รอบประเมินนี้ปิดแล้ว จึงแก้ไขข้อมูลไม่ได้" }, { status: 409 });
  const evaluation = {
    evaluation_score: body.score,
    old_salary: body.oldSalary,
    raise_percent: body.raisePercent,
    comment_1: body.comments?.[0]?.trim() ?? "",
    comment_2: body.comments?.[1]?.trim() ?? "",
    comment_3: body.comments?.[2]?.trim() ?? "",
    comment_4: body.comments?.[3]?.trim() ?? "",
    comment_5: body.comments?.[4]?.trim() ?? "",
    snapshot_full_name: body.name?.trim() ?? "",
    snapshot_email: body.email?.trim().toLowerCase() ?? "",
    snapshot_position: body.position?.trim() ?? "",
    snapshot_national_id: body.nationalId?.trim() ?? "",
    snapshot_bank_account: body.bankAccount?.trim() ?? "",
    updated_at: new Date().toISOString(),
  };
  const employee = {
    full_name: body.name?.trim() ?? "",
    email: body.email?.trim().toLowerCase() ?? "",
    position: body.position?.trim() ?? "",
    national_id: body.nationalId?.trim() ?? "",
    bank_account: body.bankAccount?.trim() ?? "",
    updated_at: new Date().toISOString(),
  };
  const [evaluationResponse, employeeResponse] = await Promise.all([
    fetch(`${baseUrl}/rest/v1/evaluations?id=eq.${body.evaluationId}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(evaluation) }),
    fetch(`${baseUrl}/rest/v1/employees?id=eq.${body.employeeId}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(employee) }),
  ]);
  if (!evaluationResponse.ok) return databaseError(evaluationResponse);
  if (!employeeResponse.ok) return databaseError(employeeResponse);
  return NextResponse.json({ ok: true });
}

async function databaseError(response: Response) {
  console.error("Supabase request failed", response.status, await response.text());
  return NextResponse.json({ error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ" }, { status: 500 });
}

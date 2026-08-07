import { NextResponse } from "next/server";
import { requireAdmin, supabaseConfig } from "@/lib/supabase-server";

export async function GET(request: Request) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบผู้ดูแล" }, { status: 401 });
  }
  const { baseUrl, headers } = supabaseConfig();
  const cycleResponse = await fetch(
    `${baseUrl}/rest/v1/evaluation_cycles?select=id,academic_year&academic_year=eq.2569&limit=1`,
    { headers, cache: "no-store" },
  );
  if (!cycleResponse.ok) return databaseError(cycleResponse);
  const [cycle] = (await cycleResponse.json()) as { id: string; academic_year: number }[];
  if (!cycle) return NextResponse.json({ error: "ไม่พบรอบประเมินปี 2569" }, { status: 404 });

  const query = "select=id,evaluation_score,old_salary,raise_percent,comment_1,comment_2,comment_3,comment_4,comment_5,employee:employees(id,employee_code,full_name,email,position,national_id,bank_account,personnel_group,source_sheet,active)&cycle_id=eq.";
  const response = await fetch(`${baseUrl}/rest/v1/evaluations?${query}${cycle.id}&order=created_at.asc`, {
    headers,
    cache: "no-store",
  });
  if (!response.ok) return databaseError(response);
  const rows = (await response.json()) as { employee?: { active?: boolean } }[];
  return NextResponse.json({ academicYear: cycle.academic_year, rows: rows.filter((row) => row.employee?.active !== false) });
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
  const evaluation = {
    evaluation_score: body.score,
    old_salary: body.oldSalary,
    raise_percent: body.raisePercent,
    comment_1: body.comments?.[0]?.trim() ?? "",
    comment_2: body.comments?.[1]?.trim() ?? "",
    comment_3: body.comments?.[2]?.trim() ?? "",
    comment_4: body.comments?.[3]?.trim() ?? "",
    comment_5: body.comments?.[4]?.trim() ?? "",
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

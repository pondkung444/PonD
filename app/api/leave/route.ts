import { NextResponse } from "next/server";
import { requireAdmin, supabaseConfig } from "@/lib/supabase-server";

type InputRow = {
  employeeId: string; sourceRow: number; usedPreviousTerm1: number; usedPreviousTerm2: number;
  accumulatedPrevious: number; addedDays: number; previousYearBalance: number; totalDays: number;
  compensationDays: number; netAccumulatedDays: number; usedCurrentTerm1: number; usedCurrentTerm2: number; remainingDays: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const admin = await requireAdmin(request, "leave");
  if (!admin) return NextResponse.json({ error: "ไม่มีสิทธิ์ใช้งานระบบวันลา" }, { status: 403 });
  const year = Number(new URL(request.url).searchParams.get("year")) || 2569;
  const { baseUrl, headers } = supabaseConfig();
  const [employeesResponse, cycleResponse] = await Promise.all([
    fetch(`${baseUrl}/rest/v1/employees?select=id,employee_code,full_name,email,position,personnel_group,active&active=eq.true&order=full_name.asc`, { headers, cache: "no-store" }),
    fetch(`${baseUrl}/rest/v1/leave_cycles?select=id,academic_year,as_of_date,source_file_name&academic_year=eq.${year}&limit=1`, { headers, cache: "no-store" }),
  ]);
  if (!employeesResponse.ok) return databaseError(employeesResponse, "อ่านรายชื่อบุคลากรไม่สำเร็จ");
  if (!cycleResponse.ok) return missingSchema(cycleResponse);
  const employees = await employeesResponse.json();
  const [cycle] = await cycleResponse.json() as Array<{ id: string; academic_year: number; as_of_date: string; source_file_name: string }>;
  if (!cycle) return NextResponse.json({ employees, cycle: null, rows: [], deliveries: [], permissions: admin.permissions });
  const [rowsResponse, deliveriesResponse] = await Promise.all([
    fetch(`${baseUrl}/rest/v1/employee_leave_balances?select=*&cycle_id=eq.${cycle.id}&order=source_row.asc`, { headers, cache: "no-store" }),
    fetch(`${baseUrl}/rest/v1/leave_email_deliveries?select=id,leave_balance_id,status,sent_at,created_at,recipient_email,error_message&delivery_type=eq.live&order=created_at.desc&limit=500`, { headers, cache: "no-store" }),
  ]);
  if (!rowsResponse.ok || !deliveriesResponse.ok) return missingSchema(!rowsResponse.ok ? rowsResponse : deliveriesResponse);
  return NextResponse.json({ employees, cycle, rows: await rowsResponse.json(), deliveries: await deliveriesResponse.json(), permissions: admin.permissions });
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request, "leave");
  if (!admin) return NextResponse.json({ error: "ไม่มีสิทธิ์ใช้งานระบบวันลา" }, { status: 403 });
  const body = await request.json().catch(() => null) as { academicYear?: unknown; fileName?: unknown; rows?: unknown } | null;
  const academicYear = Number(body?.academicYear);
  const inputRows = Array.isArray(body?.rows) ? body.rows as InputRow[] : [];
  if (!Number.isInteger(academicYear) || academicYear < 2500 || inputRows.length < 1 || inputRows.length > 500) return NextResponse.json({ error: "ข้อมูลนำเข้าไม่ถูกต้อง" }, { status: 400 });
  const issues = validateRows(inputRows);
  if (issues.length) return NextResponse.json({ error: "ข้อมูลวันลายังไม่ถูกต้อง", issues }, { status: 400 });
  const { baseUrl, headers } = supabaseConfig();
  const ids = [...new Set(inputRows.map(row => row.employeeId))];
  const employeesResponse = await fetch(`${baseUrl}/rest/v1/employees?select=id,full_name,email,position,active&id=in.(${ids.join(",")})`, { headers, cache: "no-store" });
  if (!employeesResponse.ok) return databaseError(employeesResponse, "ตรวจรายชื่อบุคลากรไม่สำเร็จ");
  const employees = await employeesResponse.json() as Array<{ id: string; full_name: string; email: string; position: string; active: boolean }>;
  const employeeMap = new Map(employees.map(employee => [employee.id, employee]));
  const missing = ids.filter(id => !employeeMap.get(id)?.active);
  if (missing.length) return NextResponse.json({ error: "มีบุคลากรที่ไม่พบหรือไม่ได้เปิดใช้งาน" }, { status: 409 });
  const asOfDate = `${academicYear - 543}-09-15`;
  const cycleResponse = await fetch(`${baseUrl}/rest/v1/leave_cycles?on_conflict=academic_year`, { method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify([{ academic_year: academicYear, as_of_date: asOfDate, source_file_name: String(body?.fileName ?? "").slice(0, 250), imported_by: admin.email, updated_at: new Date().toISOString() }]) });
  if (!cycleResponse.ok) return missingSchema(cycleResponse);
  const [cycle] = await cycleResponse.json() as Array<{ id: string }>;
  const payload = inputRows.map(row => {
    const employee = employeeMap.get(row.employeeId)!;
    return { cycle_id: cycle.id, employee_id: row.employeeId, source_row: row.sourceRow, used_previous_term_1: row.usedPreviousTerm1, used_previous_term_2: row.usedPreviousTerm2, accumulated_previous: row.accumulatedPrevious, added_days: row.addedDays, previous_year_balance: row.previousYearBalance, total_days: row.totalDays, compensation_days: row.compensationDays, net_accumulated_days: row.netAccumulatedDays, used_current_term_1: row.usedCurrentTerm1, used_current_term_2: row.usedCurrentTerm2, remaining_days: row.remainingDays, snapshot_full_name: employee.full_name, snapshot_email: employee.email.trim().toLowerCase(), snapshot_position: employee.position, updated_at: new Date().toISOString() };
  });
  const saveResponse = await fetch(`${baseUrl}/rest/v1/employee_leave_balances?on_conflict=cycle_id,employee_id`, { method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(payload) });
  if (!saveResponse.ok) return databaseError(saveResponse, "บันทึกข้อมูลวันลาไม่สำเร็จ");
  return NextResponse.json({ ok: true, rows: await saveResponse.json() });
}

function validateRows(rows: InputRow[]) {
  const issues: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (!uuidPattern.test(row.employeeId)) issues.push(`รายการ ${index + 1}: ยังไม่ได้จับคู่บุคลากร`);
    if (seen.has(row.employeeId)) issues.push(`รายการ ${index + 1}: จับคู่บุคลากรซ้ำ`);
    seen.add(row.employeeId);
    const values = [row.usedPreviousTerm1, row.usedPreviousTerm2, row.accumulatedPrevious, row.addedDays, row.previousYearBalance, row.totalDays, row.compensationDays, row.netAccumulatedDays, row.usedCurrentTerm1, row.usedCurrentTerm2, row.remainingDays];
    if (values.some(value => !Number.isFinite(value) || value < 0)) issues.push(`รายการ ${index + 1}: จำนวนวันไม่ถูกต้อง`);
    if (row.totalDays !== row.previousYearBalance + row.addedDays || row.netAccumulatedDays !== row.totalDays - row.compensationDays || row.remainingDays !== row.netAccumulatedDays - row.usedCurrentTerm1 - row.usedCurrentTerm2) issues.push(`รายการ ${index + 1}: ยอดวันลาไม่สัมพันธ์กัน`);
  });
  return issues;
}

async function missingSchema(response: Response) { console.error("Leave schema request failed", response.status, await response.text()); return NextResponse.json({ error: "ยังไม่ได้ติดตั้งตารางระบบแจ้งวันลาใน Supabase", code: "LEAVE_SCHEMA_NOT_READY" }, { status: 503 }); }
async function databaseError(response: Response, message: string) { console.error(message, response.status, await response.text()); return NextResponse.json({ error: message }, { status: 500 }); }

import { NextResponse } from "next/server";
import { requireAdmin, supabaseConfig } from "@/lib/supabase-server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type RecordInput = { academicYear?: unknown; leaveBalanceId?: unknown; fullName?: unknown; email?: unknown; position?: unknown; previous?: unknown; added?: unknown; compensation?: unknown; used1?: unknown; used2?: unknown };

function parse(body: RecordInput | null) {
  const input = { academicYear: Number(body?.academicYear), leaveBalanceId: typeof body?.leaveBalanceId === "string" ? body.leaveBalanceId : "", fullName: typeof body?.fullName === "string" ? body.fullName.trim() : "", email: typeof body?.email === "string" ? body.email.trim().toLowerCase() : "", position: typeof body?.position === "string" ? body.position.trim() : "", previous: Number(body?.previous), added: Number(body?.added), compensation: Number(body?.compensation), used1: Number(body?.used1), used2: Number(body?.used2) };
  const total = input.previous + input.added; const net = total - input.compensation; const remaining = net - input.used1 - input.used2;
  const validNumbers = [input.previous, input.added, input.compensation, input.used1, input.used2].every(value => Number.isFinite(value) && value >= 0);
  const error = !Number.isInteger(input.academicYear) || input.academicYear < 2500 ? "ปีการศึกษาไม่ถูกต้อง" : !input.fullName ? "กรุณากรอกชื่อ–สกุล" : input.email && !emailPattern.test(input.email) ? "อีเมลไม่ถูกต้อง" : !validNumbers ? "จำนวนวันลาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป" : net < 0 ? "วันลาที่เปลี่ยนเป็นค่าตอบแทนมากกว่าวันลารวม" : remaining < 0 ? "จำนวนวันลาที่ใช้มากกว่าวันลาสะสมสุทธิ" : "";
  return { input, total, net, remaining, error };
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request, "leave");
  if (!admin) return NextResponse.json({ error: "ไม่มีสิทธิ์ใช้งานระบบวันลา" }, { status: 403 });
  const parsed = parse(await request.json().catch(() => null)); if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { input, total, net, remaining } = parsed; const { baseUrl, headers } = supabaseConfig();
  const cycleResponse = await fetch(`${baseUrl}/rest/v1/leave_cycles?select=id&academic_year=eq.${input.academicYear}&limit=1`, { headers, cache: "no-store" });
  const [cycle] = cycleResponse.ok ? await cycleResponse.json() as Array<{ id: string }> : [];
  if (!cycle) return NextResponse.json({ error: "ยังไม่มีรอบวันลาสำหรับปีการศึกษานี้" }, { status: 409 });
  const duplicateResponse = await fetch(`${baseUrl}/rest/v1/employees?select=id&full_name=eq.${encodeURIComponent(input.fullName)}&active=eq.true&limit=1`, { headers, cache: "no-store" });
  if (!duplicateResponse.ok) return NextResponse.json({ error: "ตรวจสอบรายชื่อไม่สำเร็จ" }, { status: 500 });
  if ((await duplicateResponse.json() as unknown[]).length) return NextResponse.json({ error: "มีบุคลากรชื่อนี้อยู่แล้ว กรุณาเลือกชื่อเดิมแล้วกดแก้ไข" }, { status: 409 });
  if (input.email) { const duplicateEmail = await fetch(`${baseUrl}/rest/v1/employees?select=id&email=eq.${encodeURIComponent(input.email)}&limit=1`, { headers, cache: "no-store" }); if (!duplicateEmail.ok || (await duplicateEmail.json() as unknown[]).length) return NextResponse.json({ error: duplicateEmail.ok ? "อีเมลนี้ผูกกับบุคลากรคนอื่นแล้ว" : "ตรวจสอบอีเมลไม่สำเร็จ" }, { status: duplicateEmail.ok ? 409 : 500 }); }
  const employeeResponse = await fetch(`${baseUrl}/rest/v1/employees`, { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify([{ full_name: input.fullName, email: input.email, position: input.position, personnel_group: "เพิ่มจากระบบวันลา", source_sheet: "ระบบวันลา", active: true, updated_at: new Date().toISOString() }]) });
  if (!employeeResponse.ok) return NextResponse.json({ error: "เพิ่มบุคลากรไม่สำเร็จ" }, { status: 500 });
  const [employee] = await employeeResponse.json() as Array<{ id: string }>;
  const lastRowResponse = await fetch(`${baseUrl}/rest/v1/employee_leave_balances?select=source_row&cycle_id=eq.${cycle.id}&order=source_row.desc&limit=1`, { headers, cache: "no-store" });
  const [lastRow] = lastRowResponse.ok ? await lastRowResponse.json() as Array<{ source_row: number }> : [];
  const balance = { cycle_id: cycle.id, employee_id: employee.id, source_row: Number(lastRow?.source_row ?? 0) + 1, previous_year_balance: input.previous, added_days: input.added, total_days: total, compensation_days: input.compensation, net_accumulated_days: net, used_current_term_1: input.used1, used_current_term_2: input.used2, remaining_days: remaining, snapshot_full_name: input.fullName, snapshot_email: input.email, snapshot_position: input.position, updated_at: new Date().toISOString() };
  const balanceResponse = await fetch(`${baseUrl}/rest/v1/employee_leave_balances`, { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify([balance]) });
  if (!balanceResponse.ok) { await fetch(`${baseUrl}/rest/v1/employees?id=eq.${employee.id}`, { method: "DELETE", headers }); return NextResponse.json({ error: "เพิ่มข้อมูลวันลาไม่สำเร็จ" }, { status: 500 }); }
  return NextResponse.json({ ok: true, row: (await balanceResponse.json())[0] });
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin(request, "leave");
  if (!admin) return NextResponse.json({ error: "ไม่มีสิทธิ์ใช้งานระบบวันลา" }, { status: 403 });
  const parsed = parse(await request.json().catch(() => null)); if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { input, total, net, remaining } = parsed; if (!uuidPattern.test(input.leaveBalanceId)) return NextResponse.json({ error: "ไม่พบรายการที่ต้องการแก้ไข" }, { status: 400 });
  const { baseUrl, headers } = supabaseConfig();
  const currentResponse = await fetch(`${baseUrl}/rest/v1/employee_leave_balances?select=employee_id,employee:employees(full_name,email,position)&id=eq.${input.leaveBalanceId}&limit=1`, { headers, cache: "no-store" });
  const [current] = currentResponse.ok ? await currentResponse.json() as Array<{ employee_id: string; employee: { full_name: string; email: string; position: string } }> : [];
  if (!current) return NextResponse.json({ error: "ไม่พบข้อมูลบุคลากร" }, { status: 404 });
  if (input.email) { const duplicateEmail = await fetch(`${baseUrl}/rest/v1/employees?select=id&email=eq.${encodeURIComponent(input.email)}&id=neq.${current.employee_id}&limit=1`, { headers, cache: "no-store" }); if (!duplicateEmail.ok || (await duplicateEmail.json() as unknown[]).length) return NextResponse.json({ error: duplicateEmail.ok ? "อีเมลนี้ผูกกับบุคลากรคนอื่นแล้ว" : "ตรวจสอบอีเมลไม่สำเร็จ" }, { status: duplicateEmail.ok ? 409 : 500 }); }
  const employeeResponse = await fetch(`${baseUrl}/rest/v1/employees?id=eq.${current.employee_id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ full_name: input.fullName, email: input.email, position: input.position, updated_at: new Date().toISOString() }) });
  if (!employeeResponse.ok) return NextResponse.json({ error: "แก้ไขข้อมูลบุคลากรไม่สำเร็จ" }, { status: 500 });
  const balanceResponse = await fetch(`${baseUrl}/rest/v1/employee_leave_balances?id=eq.${input.leaveBalanceId}`, { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify({ previous_year_balance: input.previous, added_days: input.added, total_days: total, compensation_days: input.compensation, net_accumulated_days: net, used_current_term_1: input.used1, used_current_term_2: input.used2, remaining_days: remaining, snapshot_full_name: input.fullName, snapshot_email: input.email, snapshot_position: input.position, updated_at: new Date().toISOString() }) });
  if (!balanceResponse.ok) { await fetch(`${baseUrl}/rest/v1/employees?id=eq.${current.employee_id}`, { method: "PATCH", headers, body: JSON.stringify(current.employee) }); return NextResponse.json({ error: "แก้ไขข้อมูลวันลาไม่สำเร็จ" }, { status: 500 }); }
  return NextResponse.json({ ok: true, row: (await balanceResponse.json())[0] });
}

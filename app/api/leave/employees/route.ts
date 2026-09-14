import { NextResponse } from "next/server";
import { requireAdmin, supabaseConfig } from "@/lib/supabase-server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PATCH(request: Request) {
  const admin = await requireAdmin(request, "leave");
  if (!admin) return NextResponse.json({ error: "ไม่มีสิทธิ์ใช้งานระบบวันลา" }, { status: 403 });
  const body = await request.json().catch(() => null) as { employeeId?: unknown; email?: unknown } | null;
  const employeeId = typeof body?.employeeId === "string" ? body.employeeId : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!uuidPattern.test(employeeId) || !emailPattern.test(email)) return NextResponse.json({ error: "กรุณากรอกอีเมลให้ถูกต้อง" }, { status: 400 });
  const { baseUrl, headers } = supabaseConfig();
  const duplicate = await fetch(`${baseUrl}/rest/v1/employees?select=id&email=eq.${encodeURIComponent(email)}&id=neq.${employeeId}&limit=1`, { headers, cache: "no-store" });
  if (!duplicate.ok) return NextResponse.json({ error: "ตรวจสอบอีเมลไม่สำเร็จ" }, { status: 500 });
  if ((await duplicate.json() as unknown[]).length) return NextResponse.json({ error: "อีเมลนี้ผูกกับบุคลากรคนอื่นแล้ว" }, { status: 409 });
  const response = await fetch(`${baseUrl}/rest/v1/employees?id=eq.${employeeId}`, { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify({ email }) });
  if (!response.ok) return NextResponse.json({ error: "บันทึกอีเมลไม่สำเร็จ" }, { status: 500 });
  const [employee] = await response.json() as Array<{ id: string; email: string }>;
  return employee ? NextResponse.json({ employee }) : NextResponse.json({ error: "ไม่พบบุคลากร" }, { status: 404 });
}

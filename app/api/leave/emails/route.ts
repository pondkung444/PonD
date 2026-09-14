import { NextResponse } from "next/server";
import { leaveEmailHtml } from "@/lib/leave-email";
import { createLeaveBalancePdf } from "@/lib/leave-pdf";
import { isEmailConfigured, workspaceTransporter } from "@/lib/workspace-email";
import { requireAdmin, supabaseConfig } from "@/lib/supabase-server";

type LeaveRow = { id: string; snapshot_full_name: string; snapshot_email: string; snapshot_position: string; previous_year_balance: number | string; added_days: number | string; total_days: number | string; compensation_days: number | string; net_accumulated_days: number | string; used_current_term_1: number | string; used_current_term_2: number | string; remaining_days: number | string; cycle: { academic_year: number; as_of_date: string }; employee: { email: string; active: boolean } };
type Delivery = { id: string; leave_balance_id: string; status: string; sent_at: string | null };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
export const maxDuration = 60;

export async function POST(request: Request) {
  const admin = await requireAdmin(request, "leave");
  if (!admin) return NextResponse.json({ error: "ไม่มีสิทธิ์ใช้งานระบบวันลา" }, { status: 403 });
  if (!isEmailConfigured()) return NextResponse.json({ error: "ยังไม่ได้ตั้งค่าอีเมล Google Workspace บน Vercel" }, { status: 503 });
  const body = await request.json().catch(() => null) as { requestId?: unknown; leaveBalanceIds?: unknown; test?: unknown } | null;
  const requestId = typeof body?.requestId === "string" && uuidPattern.test(body.requestId) ? body.requestId : "";
  const ids = Array.isArray(body?.leaveBalanceIds) ? [...new Set(body.leaveBalanceIds.filter((id): id is string => typeof id === "string" && uuidPattern.test(id)))] : [];
  const isTest = body?.test === true;
  if (!requestId || !ids.length || ids.length > 5 || (isTest && ids.length !== 1)) return NextResponse.json({ error: "ส่งได้ครั้งละไม่เกิน 5 คน" }, { status: 400 });
  const testRecipient = process.env.EMAIL_TEST_RECIPIENT?.trim().toLowerCase() ?? "";
  if (isTest && !emailPattern.test(testRecipient)) return NextResponse.json({ error: "ยังไม่ได้ตั้งค่าอีเมลผู้รับการทดสอบ" }, { status: 503 });
  const { baseUrl, headers } = supabaseConfig();
  const select = "id,snapshot_full_name,snapshot_email,snapshot_position,previous_year_balance,added_days,total_days,compensation_days,net_accumulated_days,used_current_term_1,used_current_term_2,remaining_days,cycle:leave_cycles(academic_year,as_of_date),employee:employees(email,active)";
  const rowsResponse = await fetch(`${baseUrl}/rest/v1/employee_leave_balances?select=${select}&id=in.(${ids.join(",")})`, { headers, cache: "no-store" });
  if (!rowsResponse.ok) return NextResponse.json({ error: "อ่านข้อมูลวันลาสำหรับส่งอีเมลไม่สำเร็จ" }, { status: 500 });
  const rows = await rowsResponse.json() as LeaveRow[];
  const byId = new Map(rows.map(row => [row.id, row]));
  const ordered = ids.map(id => byId.get(id)).filter((row): row is LeaveRow => Boolean(row));
  if (ordered.length !== ids.length || ordered.some(row => !row.employee?.active || !emailPattern.test(row.employee.email || row.snapshot_email))) return NextResponse.json({ error: "ข้อมูลผู้รับบางรายการยังไม่พร้อมส่ง" }, { status: 409 });
  const { transporter, config } = workspaceTransporter();
  const results: Array<{ leaveBalanceId: string; name: string; status: "sent" | "failed" | "skipped"; error?: string; sentAt?: string }> = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index];
    const recipient = isTest ? testRecipient : (row.employee.email || row.snapshot_email).trim().toLowerCase();
    const delivery = await ensureDelivery(baseUrl, headers, requestId, row.id, recipient, config.email, admin.email, isTest);
    if (!delivery) { transporter.close(); return NextResponse.json({ error: "บันทึกประวัติการส่งอีเมลไม่สำเร็จ" }, { status: 503 }); }
    if (delivery.status === "sent") { results.push({ leaveBalanceId: row.id, name: row.snapshot_full_name, status: "skipped", sentAt: delivery.sent_at ?? undefined }); continue; }
    await updateDelivery(baseUrl, headers, delivery.id, { status: "sending", error_message: null });
    try {
      const leaveData = { fullName: row.snapshot_full_name, position: row.snapshot_position, academicYear: row.cycle.academic_year, asOfDate: row.cycle.as_of_date, previousYearBalance: Number(row.previous_year_balance), addedDays: Number(row.added_days), totalDays: Number(row.total_days), compensationDays: Number(row.compensation_days), netAccumulatedDays: Number(row.net_accumulated_days), usedCurrentTerm1: Number(row.used_current_term_1), usedCurrentTerm2: Number(row.used_current_term_2), remainingDays: Number(row.remaining_days) };
      const pdf = await createLeaveBalancePdf(leaveData);
      const safeName = row.snapshot_full_name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
      const info = await transporter.sendMail({ from: { name: config.fromName, address: config.email }, replyTo: config.replyTo, to: recipient, subject: `${isTest ? "[ทดสอบ] " : ""}แจ้งยอดวันลาสะสมและวันลาที่เปลี่ยนเป็นค่าตอบแทน ปีการศึกษา ${row.cycle.academic_year}`, html: leaveEmailHtml(leaveData), attachments: [{ filename: `แจ้งยอดวันลา-${safeName}.pdf`, content: Buffer.from(pdf), contentType: "application/pdf" }] });
      const sentAt = new Date().toISOString();
      await updateDelivery(baseUrl, headers, delivery.id, { status: "sent", provider_message_id: info.messageId, sent_at: sentAt, error_message: null });
      results.push({ leaveBalanceId: row.id, name: row.snapshot_full_name, status: "sent", sentAt });
    } catch (error) {
      const message = emailErrorMessage(error); await updateDelivery(baseUrl, headers, delivery.id, { status: "failed", error_message: message }); results.push({ leaveBalanceId: row.id, name: row.snapshot_full_name, status: "failed", error: message });
    }
    if (index < ordered.length - 1) await pause(500);
  }
  transporter.close();
  return NextResponse.json({ results });
}

async function ensureDelivery(baseUrl: string, headers: Record<string, string>, requestId: string, leaveBalanceId: string, recipient: string, sender: string, sentBy: string, isTest: boolean) {
  const response = await fetch(`${baseUrl}/rest/v1/leave_email_deliveries?on_conflict=request_id,leave_balance_id`, { method: "POST", headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify([{ request_id: requestId, leave_balance_id: leaveBalanceId, recipient_email: recipient, sender_email: sender, sent_by: sentBy, delivery_type: isTest ? "test" : "live", status: "queued" }]) });
  if (!response.ok) return null;
  const inserted = await response.json() as Delivery[];
  if (inserted[0]) return inserted[0];
  const existing = await fetch(`${baseUrl}/rest/v1/leave_email_deliveries?select=id,leave_balance_id,status,sent_at&request_id=eq.${requestId}&leave_balance_id=eq.${leaveBalanceId}&limit=1`, { headers, cache: "no-store" });
  return existing.ok ? ((await existing.json() as Delivery[])[0] ?? null) : null;
}
async function updateDelivery(baseUrl: string, headers: Record<string, string>, id: string, patch: Record<string, unknown>) { await fetch(`${baseUrl}/rest/v1/leave_email_deliveries?id=eq.${id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(patch) }); }
function emailErrorMessage(error: unknown) { const code = typeof error === "object" && error && "code" in error ? String(error.code) : ""; if (code === "EAUTH") return "Google ปฏิเสธการเข้าสู่ระบบ"; if (code === "EENVELOPE") return "อีเมลผู้รับไม่ถูกต้อง"; if (code === "ETIMEDOUT" || code === "ECONNECTION") return "เชื่อมต่อ Google ไม่สำเร็จ"; return "ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่"; }

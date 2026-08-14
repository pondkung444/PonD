import { NextResponse } from "next/server";
import { createPersonnelReportPdf } from "@/lib/report-pdf";
import { requireAdmin, supabaseConfig } from "@/lib/supabase-server";
import { isEmailConfigured, personnelEmailHtml, workspaceTransporter } from "@/lib/workspace-email";

type EvaluationRow = {
  id: string;
  snapshot_full_name: string;
  snapshot_email: string;
  snapshot_position: string;
  snapshot_national_id: string;
  snapshot_bank_account: string;
  evaluation_score: number | string | null;
  old_salary: number | string;
  raise_percent: number | string;
  comment_1: string | null;
  comment_2: string | null;
  comment_3: string | null;
  comment_4: string | null;
  comment_5: string | null;
  note: string | null;
  cycle: { academic_year: number };
  employee: { full_name: string; email: string; position: string; national_id: string; bank_account: string; active: boolean };
};

type Delivery = { id: string; evaluation_id: string; status: string; sent_at: string | null; created_at: string; recipient_email: string; error_message: string | null };

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim() || "บุคลากร";
}

export async function GET(request: Request) {
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบผู้ดูแล" }, { status: 401 });
  const { baseUrl, headers } = supabaseConfig();
  const response = await fetch(`${baseUrl}/rest/v1/email_deliveries?select=id,evaluation_id,status,sent_at,created_at,recipient_email,error_message&delivery_type=eq.live&order=created_at.desc&limit=500`, { headers, cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    console.error("Email history query failed", response.status, detail);
    return NextResponse.json({ configured: isEmailConfigured(), historyReady: false, testRecipient: process.env.EMAIL_TEST_RECIPIENT?.trim() || "", rows: [] });
  }
  return NextResponse.json({ configured: isEmailConfigured(), historyReady: true, testRecipient: process.env.EMAIL_TEST_RECIPIENT?.trim() || "", rows: (await response.json()) as Delivery[] });
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบผู้ดูแล" }, { status: 401 });
  if (!isEmailConfigured()) return NextResponse.json({ error: "ยังไม่ได้ตั้งค่าอีเมล Google Workspace บน Vercel", code: "EMAIL_NOT_CONFIGURED" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { requestId?: unknown; evaluationIds?: unknown; test?: unknown } | null;
  const isTest = body?.test === true;
  const requestId = typeof body?.requestId === "string" && uuidPattern.test(body.requestId) ? body.requestId : "";
  const ids = Array.isArray(body?.evaluationIds)
    ? [...new Set(body.evaluationIds.filter((value): value is string => typeof value === "string" && uuidPattern.test(value)))]
    : [];
  if (!requestId || !ids.length || ids.length > 5 || (isTest && ids.length !== 1)) return NextResponse.json({ error: "ส่งได้ครั้งละไม่เกิน 5 คน กรุณาลองใหม่" }, { status: 400 });
  const testRecipient = process.env.EMAIL_TEST_RECIPIENT?.trim().toLowerCase() || "";
  if (isTest && !emailPattern.test(testRecipient)) return NextResponse.json({ error: "ยังไม่ได้ตั้งค่าอีเมลผู้รับการทดสอบ" }, { status: 503 });

  const { baseUrl, headers } = supabaseConfig();
  const select = "id,evaluation_score,old_salary,raise_percent,comment_1,comment_2,comment_3,comment_4,comment_5,note,snapshot_full_name,snapshot_email,snapshot_position,snapshot_national_id,snapshot_bank_account,cycle:evaluation_cycles(academic_year),employee:employees(full_name,email,position,national_id,bank_account,active)";
  const dataResponse = await fetch(`${baseUrl}/rest/v1/evaluations?select=${select}&id=in.(${ids.join(",")})`, { headers, cache: "no-store" });
  if (!dataResponse.ok) return databaseFailure(dataResponse, "อ่านข้อมูลสำหรับส่งอีเมลไม่สำเร็จ");
  const rows = (await dataResponse.json()) as EvaluationRow[];
  const byId = new Map(rows.map(row => [row.id, row]));
  const orderedRows = ids.map(id => byId.get(id)).filter((row): row is EvaluationRow => Boolean(row));
  if (orderedRows.length !== ids.length) return NextResponse.json({ error: "ไม่พบข้อมูลบุคลากรบางรายการ" }, { status: 409 });
  const invalid = orderedRows.find(row => row.evaluation_score === null || Number(row.old_salary) <= 0 || !emailPattern.test(row.snapshot_email || row.employee.email));
  if (invalid) return NextResponse.json({ error: `ข้อมูลของ ${invalid.snapshot_full_name || invalid.employee.full_name} ยังไม่พร้อมส่ง` }, { status: 409 });

  const { transporter, config } = workspaceTransporter();
  const results: { evaluationId: string; name: string; email: string; status: "sent" | "failed" | "skipped"; sentAt?: string; error?: string }[] = [];
  for (let index = 0; index < orderedRows.length; index += 1) {
    const row = orderedRows[index];
    const recipient = isTest ? testRecipient : (row.snapshot_email || row.employee.email).trim().toLowerCase();
    const delivery = await ensureDelivery(baseUrl, headers, { requestId, row, recipient, sender: config.email, sentBy: admin.email, deliveryType: isTest ? "test" : "live" });
    if (!delivery) {
      transporter.close();
      return NextResponse.json({ error: "ยังไม่ได้สร้างตารางประวัติอีเมลใน Supabase" }, { status: 503 });
    }
    if (delivery.status === "sent") {
      results.push({ evaluationId: row.id, name: row.snapshot_full_name || row.employee.full_name, email: recipient, status: "skipped", sentAt: delivery.sent_at ?? undefined });
      continue;
    }
    await updateDelivery(baseUrl, headers, delivery.id, { status: "sending", error_message: null });
    try {
      const pdf = await createPersonnelReportPdf({
        academicYear: row.cycle.academic_year,
        fullName: row.snapshot_full_name || row.employee.full_name,
        position: row.snapshot_position || row.employee.position,
        nationalId: row.snapshot_national_id || row.employee.national_id,
        bankAccount: row.snapshot_bank_account || row.employee.bank_account,
        evaluationScore: Number(row.evaluation_score),
        oldSalary: Number(row.old_salary),
        raisePercent: Number(row.raise_percent),
        comments: [row.comment_1, row.comment_2, row.comment_3, row.comment_4, row.comment_5].map(value => value?.trim() ?? ""),
        note: row.note?.trim() ?? "",
      });
      const info = await transporter.sendMail({
        from: { name: config.fromName, address: config.email },
        replyTo: config.replyTo,
        to: recipient,
        subject: `${isTest ? "[ทดสอบ] " : ""}แจ้งผลการประเมินและการปรับขึ้นเงินเดือน ปีการศึกษา ${row.cycle.academic_year}`,
        html: personnelEmailHtml(row.snapshot_full_name || row.employee.full_name, row.cycle.academic_year),
        attachments: [{ filename: `หนังสือแจ้งผลประเมิน_${safeFileName(row.snapshot_full_name || row.employee.full_name)}_ลับ.pdf`, content: Buffer.from(pdf), contentType: "application/pdf" }],
      });
      const sentAt = new Date().toISOString();
      await Promise.all([
        updateDelivery(baseUrl, headers, delivery.id, { status: "sent", provider_message_id: info.messageId, sent_at: sentAt, error_message: null }),
        isTest ? Promise.resolve(new Response()) : fetch(`${baseUrl}/rest/v1/evaluations?id=eq.${row.id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", updated_at: sentAt }) }),
      ]);
      results.push({ evaluationId: row.id, name: row.snapshot_full_name || row.employee.full_name, email: recipient, status: "sent", sentAt });
    } catch (error) {
      const message = emailErrorMessage(error);
      await updateDelivery(baseUrl, headers, delivery.id, { status: "failed", error_message: message });
      results.push({ evaluationId: row.id, name: row.snapshot_full_name || row.employee.full_name, email: recipient, status: "failed", error: message });
    }
    if (index < orderedRows.length - 1) await pause(500);
  }
  transporter.close();
  return NextResponse.json({ results });
}

async function ensureDelivery(baseUrl: string, headers: Record<string, string>, input: { requestId: string; row: EvaluationRow; recipient: string; sender: string; sentBy: string; deliveryType: "test" | "live" }) {
  const response = await fetch(`${baseUrl}/rest/v1/email_deliveries?on_conflict=request_id,evaluation_id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify([{ request_id: input.requestId, evaluation_id: input.row.id, recipient_email: input.recipient, sender_email: input.sender, sent_by: input.sentBy, delivery_type: input.deliveryType, status: "queued" }]),
  });
  if (!response.ok) {
    console.error("Email delivery insert failed", response.status, await response.text());
    return null;
  }
  const inserted = (await response.json()) as Delivery[];
  if (inserted[0]) return inserted[0];
  const existing = await fetch(`${baseUrl}/rest/v1/email_deliveries?select=id,evaluation_id,status,sent_at,created_at,recipient_email,error_message&request_id=eq.${input.requestId}&evaluation_id=eq.${input.row.id}&limit=1`, { headers, cache: "no-store" });
  if (!existing.ok) return null;
  return ((await existing.json()) as Delivery[])[0] ?? null;
}

async function updateDelivery(baseUrl: string, headers: Record<string, string>, id: string, patch: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/rest/v1/email_deliveries?id=eq.${id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  if (!response.ok) console.error("Email delivery update failed", response.status, await response.text());
}

function emailErrorMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "EAUTH") return "Google ปฏิเสธการเข้าสู่ระบบ กรุณาตรวจอีเมลและ App Password";
  if (code === "EENVELOPE") return "อีเมลผู้รับไม่ถูกต้อง";
  if (code === "ETIMEDOUT" || code === "ECONNECTION") return "เชื่อมต่อ Google ไม่สำเร็จ กรุณาลองใหม่";
  return "ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่";
}

async function databaseFailure(response: Response, message: string) {
  console.error("Supabase email request failed", response.status, await response.text());
  return NextResponse.json({ error: message }, { status: 500 });
}

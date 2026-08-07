import JSZip from "jszip";
import { NextResponse } from "next/server";
import { createPersonnelReportPdf } from "@/lib/report-pdf";
import { requireAdmin, supabaseConfig } from "@/lib/supabase-server";

type EvaluationRow = {
  id: string;
  evaluation_score: number | string | null;
  old_salary: number | string;
  raise_percent: number | string;
  comment_1: string | null;
  comment_2: string | null;
  comment_3: string | null;
  comment_4: string | null;
  comment_5: string | null;
  cycle: { academic_year: number };
  employee: {
    full_name: string;
    position: string;
    national_id: string;
    bank_account: string;
    active: boolean;
  };
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim() || "บุคลากร";
}

export async function POST(request: Request) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบผู้ดูแล" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { evaluationIds?: unknown } | null;
  const ids = Array.isArray(body?.evaluationIds)
    ? [...new Set(body.evaluationIds.filter((value): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)))]
    : [];
  if (!ids.length || ids.length > 200) {
    return NextResponse.json({ error: "รายการสำหรับสร้าง PDF ไม่ถูกต้อง" }, { status: 400 });
  }

  const { baseUrl, headers } = supabaseConfig();
  const select = [
    "id", "evaluation_score", "old_salary", "raise_percent",
    "comment_1", "comment_2", "comment_3", "comment_4", "comment_5",
    "cycle:evaluation_cycles(academic_year)",
    "employee:employees(full_name,position,national_id,bank_account,active)",
  ].join(",");
  const response = await fetch(
    `${baseUrl}/rest/v1/evaluations?select=${select}&id=in.(${ids.join(",")})`,
    { headers, cache: "no-store" },
  );
  if (!response.ok) {
    console.error("Supabase batch report query failed", response.status, await response.text());
    return NextResponse.json({ error: "อ่านข้อมูลรายงานไม่สำเร็จ" }, { status: 500 });
  }
  const rows = ((await response.json()) as EvaluationRow[]).filter(row => row.employee?.active !== false);
  if (rows.length !== ids.length) {
    return NextResponse.json({ error: "ข้อมูลบางรายการไม่พร้อมสร้างรายงาน กรุณาโหลดหน้าใหม่แล้วตรวจอีกครั้ง" }, { status: 409 });
  }
  const byId = new Map(rows.map(row => [row.id, row]));
  const orderedRows = ids.map(id => byId.get(id)).filter((row): row is EvaluationRow => Boolean(row));

  try {
    const zip = new JSZip();
    for (let index = 0; index < orderedRows.length; index += 1) {
      const row = orderedRows[index];
      const pdf = await createPersonnelReportPdf({
        academicYear: row.cycle.academic_year,
        fullName: row.employee.full_name,
        position: row.employee.position,
        nationalId: row.employee.national_id,
        bankAccount: row.employee.bank_account,
        evaluationScore: row.evaluation_score === null ? null : Number(row.evaluation_score),
        oldSalary: Number(row.old_salary),
        raisePercent: Number(row.raise_percent),
        comments: [row.comment_1, row.comment_2, row.comment_3, row.comment_4, row.comment_5].map(value => value?.trim() ?? ""),
      });
      const order = String(index + 1).padStart(3, "0");
      zip.file(`${order}_หนังสือแจ้งผลประเมิน_${safeFileName(row.employee.full_name)}_ลับ.pdf`, pdf);
    }
    const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const academicYear = orderedRows[0]?.cycle.academic_year ?? 2568;
    const fileName = `หนังสือแจ้งผลประเมิน_บุคลากรทั้งหมด_${academicYear}_ลับ.zip`;
    return new Response(Uint8Array.from(archive), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="personnel-reports.zip"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Batch PDF generation failed", error);
    return NextResponse.json({ error: "สร้างชุด PDF ไม่สำเร็จ" }, { status: 500 });
  }
}

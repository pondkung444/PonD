import { NextResponse } from "next/server";
import { createPersonnelReportPdf } from "@/lib/report-pdf";
import { requireAdmin, supabaseConfig } from "@/lib/supabase-server";

type EvaluationRow = {
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ evaluationId: string }> },
) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบผู้ดูแล" }, { status: 401 });
  }

  const { evaluationId } = await params;
  const { baseUrl, headers } = supabaseConfig();
  const select = [
    "evaluation_score",
    "old_salary",
    "raise_percent",
    "comment_1",
    "comment_2",
    "comment_3",
    "comment_4",
    "comment_5",
    "cycle:evaluation_cycles(academic_year)",
    "employee:employees(full_name,position,national_id,bank_account,active)",
  ].join(",");
  const response = await fetch(
    `${baseUrl}/rest/v1/evaluations?select=${select}&id=eq.${encodeURIComponent(evaluationId)}&limit=1`,
    { headers, cache: "no-store" },
  );
  if (!response.ok) {
    console.error("Supabase report query failed", response.status, await response.text());
    return NextResponse.json({ error: "อ่านข้อมูลรายงานไม่สำเร็จ" }, { status: 500 });
  }
  const [row] = (await response.json()) as EvaluationRow[];
  if (!row || row.employee?.active === false) {
    return NextResponse.json({ error: "ไม่พบข้อมูลรายงานของบุคลากร" }, { status: 404 });
  }

  try {
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
    const safeName = row.employee.full_name.replace(/[\\/:*?"<>|]/g, "_").trim() || "บุคลากร";
    const fileName = `หนังสือแจ้งผลประเมิน_${safeName}_ลับ.pdf`;
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="personnel-report.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("PDF generation failed", error);
    return NextResponse.json({ error: "สร้าง PDF ไม่สำเร็จ" }, { status: 500 });
  }
}

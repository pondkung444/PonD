import { NextResponse } from "next/server";
import { createLeaveBalancePdf } from "@/lib/leave-pdf";
import { requireAdmin, supabaseConfig } from "@/lib/supabase-server";

export async function GET(request: Request, context: { params: Promise<{ leaveBalanceId: string }> }) {
  if (!(await requireAdmin(request, "leave"))) return NextResponse.json({ error: "ไม่มีสิทธิ์ใช้งานระบบวันลา" }, { status: 403 });
  const { leaveBalanceId } = await context.params; const { baseUrl, headers } = supabaseConfig();
  const select = "id,snapshot_full_name,snapshot_position,previous_year_balance,added_days,total_days,compensation_days,net_accumulated_days,used_current_term_1,used_current_term_2,remaining_days,snapshot_email,cycle:leave_cycles(academic_year,as_of_date)";
  const response = await fetch(`${baseUrl}/rest/v1/employee_leave_balances?select=${select}&id=eq.${encodeURIComponent(leaveBalanceId)}&limit=1`, { headers, cache: "no-store" });
  if (!response.ok) return NextResponse.json({ error: "อ่านข้อมูล PDF ไม่สำเร็จ" }, { status: 500 });
  const [row] = await response.json() as Array<Record<string, unknown> & { cycle: { academic_year: number; as_of_date: string } }>;
  if (!row) return NextResponse.json({ error: "ไม่พบข้อมูลวันลา" }, { status: 404 });
  const pdf = await createLeaveBalancePdf({ fullName: String(row.snapshot_full_name), position: String(row.snapshot_position || ""), academicYear: row.cycle.academic_year, asOfDate: row.cycle.as_of_date, previousYearBalance: Number(row.previous_year_balance), addedDays: Number(row.added_days), totalDays: Number(row.total_days), compensationDays: Number(row.compensation_days), netAccumulatedDays: Number(row.net_accumulated_days), usedCurrentTerm1: Number(row.used_current_term_1), usedCurrentTerm2: Number(row.used_current_term_2), remainingDays: Number(row.remaining_days) });
  const safeName = String(row.snapshot_full_name).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(`แจ้งยอดวันลา-${safeName}.pdf`)}`, "Cache-Control": "no-store" } });
}

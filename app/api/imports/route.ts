import { NextResponse } from "next/server";
import { requireAdmin, supabaseConfig } from "@/lib/supabase-server";

type ImportRow = {
  code?: string; status?: string; name?: string; email?: string; position?: string;
  nationalId?: string; bankAccount?: string; score?: number | null; oldSalary?: number;
  raisePercent?: number | null; comments?: string[]; source?: string;
};

type EmployeeRecord = {
  id: string; employee_code: string | null; full_name: string; email: string; position: string;
  national_id: string; bank_account: string; personnel_group: string; active: boolean;
};

type NormalizedRow = ReturnType<typeof normalizeRow>;
const groups = new Set(["ผู้บริหาร", "หัวหน้าฝ่าย", "หัวหน้ากลุ่มสาระ", "บุคลากร", "หอพัก", "แม่บ้าน-รปภ"]);
const statuses = new Set(["ปฏิบัติงาน", "พ้นสภาพ"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบผู้ดูแล" }, { status: 401 });

  const body = (await request.json()) as { academicYear?: number; fileName?: string; confirm?: boolean; rows?: ImportRow[] };
  const academicYear = Number(body.academicYear ?? 2568);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!Number.isInteger(academicYear) || academicYear < 2500 || academicYear > 2700) return NextResponse.json({ error: "ปีการศึกษาไม่ถูกต้อง" }, { status: 400 });
  if (!rows.length || rows.length > 500) return NextResponse.json({ error: "จำนวนรายการนำเข้าต้องอยู่ระหว่าง 1–500 คน" }, { status: 400 });

  const normalized = rows.map((row, index) => normalizeRow(row, index));
  const issues = [
    ...normalized.flatMap((row) => row.errors.map((message) => ({ row: row.rowNumber, name: row.full_name, message }))),
    ...findDuplicates(normalized),
  ];
  if (issues.length) return NextResponse.json({ error: "พบข้อมูลที่ต้องแก้ไขก่อนนำเข้า", issues }, { status: 400 });

  const { baseUrl, headers } = supabaseConfig();
  const [cycleResponse, existingResponse] = await Promise.all([
    fetch(`${baseUrl}/rest/v1/evaluation_cycles?select=id,academic_year&academic_year=eq.${academicYear}&limit=1`, { headers, cache: "no-store" }),
    fetch(`${baseUrl}/rest/v1/employees?select=id,employee_code,full_name,email,position,national_id,bank_account,personnel_group,active`, { headers, cache: "no-store" }),
  ]);
  if (!cycleResponse.ok) return databaseError(cycleResponse);
  if (!existingResponse.ok) return databaseError(existingResponse);
  const [cycle] = (await cycleResponse.json()) as { id: string; academic_year: number }[];
  if (!cycle) return NextResponse.json({ error: `ยังไม่ได้สร้างรอบประเมินปี ${academicYear}` }, { status: 400 });
  const existing = (await existingResponse.json()) as EmployeeRecord[];
  const comparison = compareRows(normalized, existing);

  if (!body.confirm) return NextResponse.json({ ok: true, preview: comparison.preview });
  if (comparison.preview.missing.length) {
    return NextResponse.json({ error: "ยังยืนยันไม่ได้ กรุณาระบุสถานะของบุคลากรที่ไม่พบในไฟล์", missing: comparison.preview.missing }, { status: 400 });
  }

  const now = new Date().toISOString();
  const employeePayload = comparison.matches.map(({ row, employee }) => ({
    ...(employee ? { id: employee.id } : {}),
    employee_code: employee?.employee_code || row.employee_code || generatedCode(academicYear, row, row.rowNumber),
    full_name: row.full_name,
    email: row.email,
    position: row.position,
    national_id: row.national_id,
    bank_account: row.bank_account,
    personnel_group: row.personnel_group,
    source_sheet: row.personnel_group,
    active: row.status === "ปฏิบัติงาน",
    updated_at: now,
  }));
  const existingPayload = employeePayload.filter((row) => "id" in row);
  const newPayload = employeePayload.filter((row) => !("id" in row));
  const savedEmployees: EmployeeRecord[] = [];
  if (existingPayload.length) savedEmployees.push(...await upsertEmployees(baseUrl, headers, "id", existingPayload));
  if (newPayload.length) savedEmployees.push(...await upsertEmployees(baseUrl, headers, "employee_code", newPayload));

  const savedByIdentity = buildIdentityMaps(savedEmployees);
  const activeRows = normalized.filter((row) => row.status === "ปฏิบัติงาน");
  const evaluations = activeRows.map((row) => {
    const employee = findEmployee(row, savedByIdentity);
    if (!employee) throw new Error(`Imported employee could not be resolved: ${row.full_name}`);
    return {
      cycle_id: cycle.id, employee_id: employee.id, evaluation_score: row.evaluation_score,
      old_salary: row.old_salary, raise_percent: row.raise_percent,
      comment_1: row.comments[0] ?? "", comment_2: row.comments[1] ?? "", comment_3: row.comments[2] ?? "",
      comment_4: row.comments[3] ?? "", comment_5: row.comments[4] ?? "", status: "draft", updated_at: now,
    };
  });
  const evaluationResponse = await fetch(`${baseUrl}/rest/v1/evaluations?on_conflict=cycle_id,employee_id`, {
    method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(evaluations),
  });
  if (!evaluationResponse.ok) return databaseError(evaluationResponse);
  const savedEvaluations = (await evaluationResponse.json()) as unknown[];

  const batchResponse = await fetch(`${baseUrl}/rest/v1/import_batches`, {
    method: "POST", headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify([{ file_name: String(body.fileName || "excel-import.xlsx").slice(0, 250), imported_rows: normalized.length, rejected_rows: 0 }]),
  });
  if (!batchResponse.ok) return databaseError(batchResponse);

  return NextResponse.json({ ok: true, academicYear, importedEmployees: savedEmployees.length, importedEvaluations: savedEvaluations.length, preview: comparison.preview });
}

function normalizeRow(row: ImportRow, index: number) {
  const employee_code = clean(row.code);
  const status = clean(row.status) || "ปฏิบัติงาน";
  const full_name = clean(row.name);
  const email = clean(row.email).toLowerCase();
  const position = clean(row.position);
  const national_id = clean(row.nationalId);
  const bank_account = clean(row.bankAccount);
  const personnel_group = clean(row.source);
  const old_salary = Number(row.oldSalary ?? 0);
  const score = row.score === null || row.score === undefined ? null : Number(row.score);
  const raise = row.raisePercent === null || row.raisePercent === undefined ? 0 : Number(row.raisePercent);
  const errors: string[] = [];
  if (!statuses.has(status)) errors.push("สถานะปีนี้ต้องเป็น ปฏิบัติงาน หรือ พ้นสภาพ");
  if (!full_name) errors.push("ไม่มีชื่อ–สกุล");
  if (!emailPattern.test(email)) errors.push("อีเมลไม่ถูกต้อง");
  if (!position) errors.push("ไม่มีตำแหน่ง");
  if (!national_id) errors.push("ไม่มีเลขบัตรประชาชน/เลขผู้เสียภาษี");
  if (!bank_account) errors.push("ไม่มีเลขบัญชีธนาคาร");
  if (!groups.has(personnel_group)) errors.push("ชื่อกลุ่มบุคลากรไม่ถูกต้อง");
  if (status === "ปฏิบัติงาน" && (!Number.isFinite(old_salary) || old_salary <= 0)) errors.push("เงินเดือนเดิมไม่ถูกต้อง");
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) errors.push("ผลประเมินต้องอยู่ระหว่าง 0–100");
  if (!Number.isFinite(raise) || raise < 0) errors.push("ร้อยละที่เพิ่มไม่ถูกต้อง");
  return { rowNumber: index + 1, employee_code, status, full_name, email, position, national_id, bank_account, personnel_group, evaluation_score: score, old_salary, raise_percent: raise, comments: Array.from({ length: 5 }, (_, i) => clean(row.comments?.[i])), errors };
}

function compareRows(rows: NormalizedRow[], existing: EmployeeRecord[]) {
  const maps = buildIdentityMaps(existing);
  const matchedIds = new Set<string>();
  const matches = rows.map((row) => {
    const employee = findEmployee(row, maps);
    if (employee) matchedIds.add(employee.id);
    return { row, employee };
  });
  const newPeople = matches.filter(({ row, employee }) => !employee && row.status === "ปฏิบัติงาน").map(({ row }) => row.full_name);
  const departing = matches.filter(({ row, employee }) => employee && row.status === "พ้นสภาพ").map(({ row }) => row.full_name);
  const changed = matches.filter(({ row, employee }) => employee && hasChanges(row, employee)).map(({ row }) => row.full_name);
  const missing = existing.filter((employee) => employee.active && !matchedIds.has(employee.id)).map((employee) => employee.full_name);
  return { matches, preview: { total: rows.length, existing: matches.filter(({ employee }) => Boolean(employee)).length, newPeople, departing, changed, missing } };
}

function buildIdentityMaps(employees: EmployeeRecord[]) {
  return {
    byNational: new Map(employees.filter((e) => e.national_id).map((e) => [identity(e.national_id), e])),
    byCode: new Map(employees.filter((e) => e.employee_code).map((e) => [e.employee_code!.toLowerCase(), e])),
    byEmail: new Map(employees.filter((e) => e.email).map((e) => [e.email.trim().toLowerCase(), e])),
  };
}

function findEmployee(row: Pick<NormalizedRow, "national_id" | "employee_code" | "email">, maps: ReturnType<typeof buildIdentityMaps>) {
  return maps.byNational.get(identity(row.national_id)) ?? maps.byCode.get(row.employee_code.toLowerCase()) ?? maps.byEmail.get(row.email.toLowerCase());
}

function hasChanges(row: NormalizedRow, employee: EmployeeRecord) {
  return row.full_name !== employee.full_name || row.email !== employee.email.trim().toLowerCase() || row.position !== employee.position || identity(row.national_id) !== identity(employee.national_id) || identity(row.bank_account) !== identity(employee.bank_account) || row.personnel_group !== employee.personnel_group || (row.status === "ปฏิบัติงาน") !== employee.active;
}

function findDuplicates(rows: NormalizedRow[]) {
  const issues: { row: number; name: string; message: string }[] = [];
  for (const field of ["employee_code", "email", "national_id"] as const) {
    const seen = new Map<string, number>();
    for (const row of rows) {
      const value = field === "employee_code" ? row[field].toLowerCase() : identity(row[field]);
      if (!value) continue;
      const first = seen.get(value);
      if (first !== undefined) issues.push({ row: row.rowNumber, name: row.full_name, message: `${field === "employee_code" ? "รหัสบุคลากร" : field === "email" ? "อีเมล" : "เลขบัตรประชาชน"} ซ้ำกับรายการที่ ${first}` });
      else seen.set(value, row.rowNumber);
    }
  }
  return issues;
}

async function upsertEmployees(baseUrl: string, headers: Record<string, string>, conflict: string, payload: object[]) {
  const response = await fetch(`${baseUrl}/rest/v1/employees?on_conflict=${conflict}`, { method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Employee import failed (${response.status}): ${await response.text()}`);
  return (await response.json()) as EmployeeRecord[];
}

function generatedCode(year: number, row: NormalizedRow, index: number) {
  const seed = identity(row.national_id).slice(-6) || String(index).padStart(3, "0");
  return `NEW-${year}-${seed}-${String(index).padStart(3, "0")}`;
}

function clean(value: unknown) { return String(value ?? "").trim(); }
function identity(value: string) { return value.replace(/[-\s]/g, "").toLowerCase(); }

async function databaseError(response: Response) {
  console.error("Supabase import failed", response.status, await response.text());
  return NextResponse.json({ error: "บันทึกข้อมูลนำเข้าไม่สำเร็จ" }, { status: 500 });
}

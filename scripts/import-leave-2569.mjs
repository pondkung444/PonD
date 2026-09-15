import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import XLSX from "xlsx";

const inputPath = process.argv[2];
if (!inputPath || !fs.existsSync(inputPath)) throw new Error("ไม่พบไฟล์ Excel ที่ระบุ");

const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !serviceKey) throw new Error("ไม่พบค่าการเชื่อมต่อ Supabase");

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};
const normalize = value => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("th");
const aliases = new Map([
  ["นายพงศกร แก้วชลคราม", "นายพงศธร แก้วชลคราม"],
  ["นางสาวสุชานาถ ชูพูล", "นางสาวสุชานาถ ชูพล"],
  ["Mrs. Beulah Lawanin Laranjo", "Mrs. BEULAH LAWANIN"],
  ["นางสาวอนงกรณ์ พูลกลับ", "นางสาวอนงกรณ์ พลูกลับ"],
  ["นางสาวเจษฎา กุฏอินทร์", "นางสาวเจษฎา กุฎอินทร์"],
].map(([source, target]) => [normalize(source), normalize(target)]));
const numberValue = value => {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const equal = (left, right) => Math.abs(left - right) < 0.00001;

async function request(endpoint, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${endpoint}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const employees = await request("employees?select=id,full_name,email,position,active&active=eq.true");
const employeeByName = new Map(employees.map(employee => [normalize(employee.full_name), employee]));
const workbook = XLSX.readFile(inputPath, { cellDates: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
const parsedRows = [];
const problems = [];

for (let index = 3; index < grid.length; index += 1) {
  const cells = grid[index] ?? [];
  const sourceName = String(cells[1] ?? "").replace(/\s+/g, " ").trim();
  if (!sourceName) continue;
  const normalized = normalize(sourceName);
  const employee = employeeByName.get(aliases.get(normalized) ?? normalized);
  if (!employee) { problems.push(`แถว ${index + 1}: ไม่พบ ${sourceName}`); continue; }
  const values = Array.from({ length: 11 }, (_, offset) => numberValue(cells[offset + 2]));
  const [usedPreviousTerm1, usedPreviousTerm2, accumulatedPrevious, addedDays, previousYearBalance, totalDays, compensationDays, netAccumulatedDays, usedCurrentTerm1, usedCurrentTerm2, remainingDays] = values;
  if (!equal(totalDays, previousYearBalance + addedDays) || !equal(netAccumulatedDays, totalDays - compensationDays) || !equal(remainingDays, netAccumulatedDays - usedCurrentTerm1 - usedCurrentTerm2)) problems.push(`แถว ${index + 1}: ยอดวันลาไม่สัมพันธ์กัน`);
  parsedRows.push({ employee, sourceRow: index + 1, usedPreviousTerm1, usedPreviousTerm2, accumulatedPrevious, addedDays, previousYearBalance, totalDays, compensationDays, netAccumulatedDays, usedCurrentTerm1, usedCurrentTerm2, remainingDays });
}

if (problems.length) throw new Error(problems.join("\n"));
if (parsedRows.length !== 83) throw new Error(`คาดว่าจะพบ 83 คน แต่พบ ${parsedRows.length} คน`);
if (new Set(parsedRows.map(row => row.employee.id)).size !== parsedRows.length) throw new Error("พบการจับคู่บุคลากรซ้ำ");

const [cycle] = await request("leave_cycles?on_conflict=academic_year", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  body: JSON.stringify([{ academic_year: 2569, as_of_date: "2026-09-15", source_file_name: path.basename(inputPath), imported_by: "codex-import", updated_at: new Date().toISOString() }]),
});

const payload = parsedRows.map(row => ({
  cycle_id: cycle.id,
  employee_id: row.employee.id,
  source_row: row.sourceRow,
  used_previous_term_1: row.usedPreviousTerm1,
  used_previous_term_2: row.usedPreviousTerm2,
  accumulated_previous: row.accumulatedPrevious,
  added_days: row.addedDays,
  previous_year_balance: row.previousYearBalance,
  total_days: row.totalDays,
  compensation_days: row.compensationDays,
  net_accumulated_days: row.netAccumulatedDays,
  used_current_term_1: row.usedCurrentTerm1,
  used_current_term_2: row.usedCurrentTerm2,
  remaining_days: row.remainingDays,
  snapshot_full_name: row.employee.full_name,
  snapshot_email: String(row.employee.email ?? "").trim().toLowerCase(),
  snapshot_position: row.employee.position ?? "",
  updated_at: new Date().toISOString(),
}));

await request("employee_leave_balances?on_conflict=cycle_id,employee_id", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify(payload),
});

const verification = await request(`employee_leave_balances?select=id,compensation_days,remaining_days,snapshot_email&cycle_id=eq.${cycle.id}`);
console.log(JSON.stringify({
  cycleId: cycle.id,
  imported: verification.length,
  compensationPeople: verification.filter(row => Number(row.compensation_days) > 0).length,
  pendingEmail: verification.filter(row => !String(row.snapshot_email ?? "").includes("@")).length,
  remainingDaysTotal: verification.reduce((sum, row) => sum + Number(row.remaining_days), 0),
}, null, 2));

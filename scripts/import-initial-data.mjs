import fs from "node:fs";
import crypto from "node:crypto";
import XLSX from "xlsx";

function loadEnv(path) {
  const env = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) continue;
    const i = clean.indexOf("=");
    if (i > 0) env[clean.slice(0, i)] = clean.slice(i + 1).trim();
  }
  return env;
}

const appRoot = new URL("../", import.meta.url);
const env = loadEnv(new URL(".env.local", appRoot));
const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
const secret = env.SUPABASE_SERVICE_ROLE_KEY;
const commit = process.argv.includes("--commit");
const workbookPath = new URL("../../รายการปรับเงินเดือน.xlsx", import.meta.url);
const supportedSheets = ["Salary_ผู้บริหาร","Salary_หัวหน้าฝ่าย","Salary_หัวหน้ากลุ่มสาระ","Salary_บุคลากร","Salary_หอพัก","Salary_แม่บ้านรปภ."];

const wb = XLSX.readFile(workbookPath);
const people = [];
for (const sheetName of supportedSheets) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
  const header = rows.findIndex((row) => row.some((cell) => String(cell).includes("ชื่อ-สกุล")));
  if (header < 0) continue;
  for (const row of rows.slice(header + 1)) {
    const name = String(row[2] ?? "").trim();
    if (!name) continue;
    const email = String(row[3] ?? "").trim().toLowerCase();
    const codeSeed = `${sheetName}|${name}`;
    const code = `LEGACY-${crypto.createHash("sha256").update(codeSeed).digest("hex").slice(0, 10).toUpperCase()}`;
    people.push({
      employee_code: code,
      full_name: name,
      email,
      position: String(row[5] ?? "").trim(),
      personnel_group: sheetName.replace("Salary_", ""),
      source_sheet: sheetName,
      active: true,
      national_id: String(row[4] ?? "").trim(),
      bank_account: String(row[sheetName === "Salary_แม่บ้านรปภ." ? 20 : 25] ?? "").trim(),
      evaluation_score: row[6] === "" ? null : Number(row[6]),
      raise_percent: Number(row[7]) || 0,
      old_salary: Number(row[9]) || 0,
    });
  }
}

const duplicateEmails = [...new Set(people.filter((p, i, all) => p.email && all.findIndex((x) => x.email === p.email) !== i).map((p) => p.email))];
const rejected = people.filter((p) => !p.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) || p.old_salary <= 0);
const valid = people.filter((p) => !rejected.includes(p));
console.log(JSON.stringify({ mode: commit ? "commit" : "dry-run", found: people.length, valid: valid.length, rejected: rejected.length, duplicateEmails: duplicateEmails.length, missingNationalId: people.filter(p=>!p.national_id).length, missingBankAccount: people.filter(p=>!p.bank_account).length }));
if (!commit) process.exit(0);
if (!baseUrl || !secret) throw new Error("Supabase environment is incomplete");
if (rejected.length) throw new Error("Import stopped: fix rejected records first");

const headers = { apikey: secret, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" };
const employeePayload = valid.map((person) => {
  const employee = { ...person };
  delete employee.evaluation_score;
  delete employee.raise_percent;
  delete employee.old_salary;
  return employee;
});
const employeeResponse = await fetch(`${baseUrl}/rest/v1/employees?on_conflict=employee_code`, { method: "POST", headers, body: JSON.stringify(employeePayload) });
if (!employeeResponse.ok) throw new Error(`Employee import failed (${employeeResponse.status}): ${await employeeResponse.text()}`);
const savedEmployees = await employeeResponse.json();

const cycleResponse = await fetch(`${baseUrl}/rest/v1/evaluation_cycles?on_conflict=academic_year`, {
  method: "POST", headers,
  body: JSON.stringify([{ academic_year: 2568, title: "ผลการประเมินและการปรับขึ้นเงินเดือน ปีการศึกษา 2568", period_start: "2025-05-01", period_end: "2026-04-30", status: "draft" }]),
});
if (!cycleResponse.ok) throw new Error(`Cycle import failed (${cycleResponse.status}): ${await cycleResponse.text()}`);
const [cycle] = await cycleResponse.json();
const byCode = new Map(savedEmployees.map((employee) => [employee.employee_code, employee.id]));
const evaluations = valid.map((person) => ({ cycle_id: cycle.id, employee_id: byCode.get(person.employee_code), evaluation_score: person.evaluation_score, old_salary: person.old_salary, raise_percent: person.raise_percent, status: "draft" }));
const evaluationResponse = await fetch(`${baseUrl}/rest/v1/evaluations?on_conflict=cycle_id,employee_id`, { method: "POST", headers, body: JSON.stringify(evaluations) });
if (!evaluationResponse.ok) throw new Error(`Evaluation import failed (${evaluationResponse.status}): ${await evaluationResponse.text()}`);
console.log(JSON.stringify({ importedEmployees: savedEmployees.length, importedEvaluations: (await evaluationResponse.json()).length, academicYear: 2568 }));

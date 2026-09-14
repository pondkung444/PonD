import fs from "node:fs/promises";
import * as XLSX from "xlsx";

const mode = process.argv[2] ?? "preview";
if (!new Set(["preview", "confirm"]).has(mode)) throw new Error("Use preview or confirm");
const filePath = process.argv[3] ?? "C:/Users/ASUS FX505/Downloads/แบบกรอกผลประเมิน_แยกตามกลุ่มบุคลากร(3).xlsx";
const envText = await fs.readFile(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/).filter(line => line && !line.trimStart().startsWith("#") && line.includes("=")).map(line => {
  const split = line.indexOf("="); return [line.slice(0, split).trim(), line.slice(split + 1).trim().replace(/^['"]|['"]$/g, "")];
}));
const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !serviceKey) throw new Error("Supabase configuration is missing");
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
const groups = new Set(["ผู้บริหาร", "หัวหน้าฝ่าย", "หัวหน้ากลุ่มสาระ", "บุคลากร", "หอพัก", "แม่บ้าน-รปภ"]);
const keys = {
  name:["ชื่อ-สกุล","ชื่อ–สกุล","ชื่อ - สกุล","ชื่อ-นามสกุล"], status:["สถานะปีนี้","สถานะ"], email:["อีเมล","email"], position:["ตำแหน่ง","position"],
  score:["ผลประเมิน(%)","ผลประเมิน (%)","ผลประเมิน"], raise:["ร้อยละที่เพิิ่ม","ร้อยละที่เพิ่ม","ร้อยละที่ปรับขึ้น"], old:["เงินเดือนเดิม","old salary"],
  increase:["จำนวนเงินที่เพิ่ม","เงินเดือนที่เพิ่ม"], current:["เงินเดือนปัจจุบัน","เงินเดือนใหม่"],
  id:["รหัสบุคลากร","รหัสพนักงาน","เลขประจำตัว"], nationalId:["เลขบัตรประชาชน","เลขประจำตัวประชาชน","เลขประจำตัวประชาชน/ผู้เสียภาษี"],
  bankAccount:["เลขบัญชีธนาคาร","เข้าบัญชีธนาคารไทยพาณิชย์ เลขที่"], note:["หมายเหตุ","หมายเหตุ (ถ้ามี)"],
  comments:Array.from({length:5},(_,i)=>i===0?["ข้อเสนอแนะ","ข้อเสนอแนะ 1","ข้อเสนอแนะ1"]:[`ข้อเสนอแนะ ${i+1}`,`ข้อเสนอแนะ${i+1}`]),
};
const pick = (row,names) => { const found=Object.keys(row).find(k=>names.some(n=>k.trim().toLowerCase()===n.toLowerCase())); return found?row[found]:undefined; };
const clean = value => String(value ?? "").trim();
const identity = value => clean(value).replace(/[-\s]/g, "").toLowerCase();
const numeric = value => Number(clean(value).replace(/,/g,"")) || 0;
const optionalNumeric = value => { const cleaned=clean(value).replace(/,/g,""); return !cleaned||cleaned==="-"?null:Number(cleaned); };

const wb = XLSX.read(await fs.readFile(filePath), { type:"buffer" });
const sourceRows=[];
for (const sheetName of wb.SheetNames) {
  if (!groups.has(sheetName)) continue;
  const raw=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:""});
  const headerIndex=raw.findIndex(row=>row.some(cell=>keys.name.includes(clean(cell))));
  if(headerIndex<0) continue;
  const header=raw[headerIndex].map(cell=>clean(cell).replace(/\n/g," "));
  for(const cells of raw.slice(headerIndex+1)){const row={};header.forEach((h,i)=>row[h]=cells[i]);row.__sheet=sheetName;if(pick(row,keys.name))sourceRows.push(row);}
}
const rows=sourceRows.map((row,index)=>({
  rowNumber:index+1, employee_code:clean(pick(row,keys.id)), status:clean(pick(row,keys.status))||"ปฏิบัติงาน", full_name:clean(pick(row,keys.name)),
  email:clean(pick(row,keys.email)).toLowerCase(), position:clean(pick(row,keys.position)), national_id:clean(pick(row,keys.nationalId)), bank_account:clean(pick(row,keys.bankAccount)),
  personnel_group:clean(row.__sheet), evaluation_score:clean(pick(row,keys.score))===""?null:numeric(pick(row,keys.score)), old_salary:numeric(pick(row,keys.old)),
  raise_percent:optionalNumeric(pick(row,keys.raise)), salary_increase:optionalNumeric(pick(row,keys.increase)), current_salary:optionalNumeric(pick(row,keys.current)), comments:keys.comments.map(names=>clean(pick(row,names))), note:clean(pick(row,keys.note)),
}));
if(rows.length!==86) throw new Error(`Expected 86 rows, found ${rows.length}`);
for(const row of rows){const adjustment=[row.raise_percent,row.salary_increase,row.current_salary];const has=adjustment.some(value=>value!==null);const complete=adjustment.every(value=>value!==null);if(row.status==="ปฏิบัติงาน"&&has&&!complete)throw new Error(`Incomplete salary adjustment: ${row.full_name}`);if(complete&&row.current_salary!==row.old_salary+row.salary_increase)throw new Error(`Salary total mismatch: ${row.full_name}`);}

async function rest(path, options={}) { const response=await fetch(`${baseUrl}/rest/v1/${path}`,{...options,headers:{...headers,...options.headers}}); const text=await response.text(); if(!response.ok)throw new Error(`${options.method??"GET"} ${path} failed (${response.status}): ${text}`); return text?JSON.parse(text):null; }
const [cycle] = await rest("evaluation_cycles?select=id,academic_year,status&academic_year=eq.2568&limit=1");
if(!cycle||cycle.status==="closed") throw new Error("Cycle 2568 is missing or closed");
const existing=await rest("employees?select=id,employee_code,full_name,email,position,national_id,bank_account,personnel_group,active");
const maps={
  national:new Map(existing.filter(e=>e.national_id).map(e=>[identity(e.national_id),e])), code:new Map(existing.filter(e=>e.employee_code).map(e=>[clean(e.employee_code).toLowerCase(),e])),
  email:new Map(existing.filter(e=>e.email).map(e=>[clean(e.email).toLowerCase(),e])),
};
const find=row=>maps.national.get(identity(row.national_id))??maps.code.get(row.employee_code.toLowerCase())??maps.email.get(row.email);
const matched=new Set(); const matches=rows.map(row=>{const employee=find(row);if(employee)matched.add(employee.id);return{row,employee};});
const missing=existing.filter(e=>e.active&&!matched.has(e.id)).map(e=>e.full_name);
const preview={total:rows.length,active:rows.filter(r=>r.status==="ปฏิบัติงาน").length,departed:rows.filter(r=>r.status==="พ้นสภาพ").map(r=>r.full_name),newPeople:matches.filter(x=>!x.employee&&x.row.status==="ปฏิบัติงาน").map(x=>x.row.full_name),missing};
console.log(JSON.stringify({mode,preview},null,2));
if(mode==="preview") process.exit(0);
if(missing.length) throw new Error(`Active employees missing from file: ${missing.join(", ")}`);

const now=new Date().toISOString();
const payload=matches.map(({row,employee})=>({...(employee?{id:employee.id}:{}),employee_code:employee?.employee_code||row.employee_code||`NEW-2568-${identity(row.national_id).slice(-6)}-${String(row.rowNumber).padStart(3,"0")}`,full_name:row.full_name,email:row.email,position:row.position,national_id:row.national_id,bank_account:row.bank_account,personnel_group:row.personnel_group,source_sheet:row.personnel_group,active:row.status==="ปฏิบัติงาน",updated_at:now}));
const existingPayload=payload.filter(row=>row.id); const newPayload=payload.filter(row=>!row.id); let saved=[];
if(existingPayload.length)saved.push(...await rest("employees?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(existingPayload)}));
if(newPayload.length)saved.push(...await rest("employees?on_conflict=employee_code",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(newPayload)}));
const savedMaps={national:new Map(saved.map(e=>[identity(e.national_id),e])),code:new Map(saved.filter(e=>e.employee_code).map(e=>[clean(e.employee_code).toLowerCase(),e])),email:new Map(saved.map(e=>[clean(e.email).toLowerCase(),e]))};
const findSaved=row=>savedMaps.national.get(identity(row.national_id))??savedMaps.code.get(row.employee_code.toLowerCase())??savedMaps.email.get(row.email);
const departedIds=rows.filter(r=>r.status==="พ้นสภาพ").map(r=>findSaved(r)?.id).filter(Boolean);
if(departedIds.length) await rest(`evaluations?cycle_id=eq.${cycle.id}&employee_id=in.(${departedIds.join(",")})`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
const evaluations=rows.filter(r=>r.status==="ปฏิบัติงาน").map(row=>{const employee=findSaved(row);if(!employee)throw new Error(`Could not resolve ${row.full_name}`);return{cycle_id:cycle.id,employee_id:employee.id,evaluation_score:row.evaluation_score,old_salary:row.old_salary,raise_percent:row.raise_percent,salary_increase:row.salary_increase,current_salary:row.current_salary,comment_1:row.comments[0],comment_2:row.comments[1],comment_3:row.comments[2],comment_4:row.comments[3],comment_5:row.comments[4],note:row.note,status:"draft",updated_at:now,snapshot_full_name:row.full_name,snapshot_email:row.email,snapshot_position:row.position,snapshot_national_id:row.national_id,snapshot_bank_account:row.bank_account,snapshot_personnel_group:row.personnel_group,snapshot_source_sheet:row.personnel_group};});
const savedEvaluations=await rest("evaluations?on_conflict=cycle_id,employee_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(evaluations)});
await rest("import_batches",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify([{cycle_id:cycle.id,file_name:filePath.split(/[\\/]/).pop(),imported_rows:rows.length,rejected_rows:0}])});
console.log(JSON.stringify({ok:true,employees:saved.length,evaluations:savedEvaluations.length,departedEvaluationsRemoved:departedIds.length},null,2));

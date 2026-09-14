"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";

type Person = {
  id: string; employeeId?: string; evaluationId?: string; name: string; email: string; position: string;
  status: "ปฏิบัติงาน"|"พ้นสภาพ"; nationalId: string; bankAccount: string;
  score: number | null; raisePercent: number | null; oldSalary: number; salaryIncrease: number | null; currentSalary: number | null;
  comments: string[]; note: string; source: string;
};

type Comparison = { total:number; existing:number; newPeople:string[]; departing:string[]; changed:string[]; missing:string[] };
type ImportPreview = { fileName: string; rows: Person[]; sheetCount: number; groupCounts: Record<string,number>; issues: string[]; comparison?:Comparison };
type Cycle = { id:string; academic_year:number; title:string; period_start:string|null; period_end:string|null; status:"draft"|"ready"|"sent"|"closed"; closed_at:string|null };
type ApiEvaluationRow = { id:string; evaluation_score:number|string|null; old_salary:number|string; raise_percent:number|string|null; salary_increase:number|string|null; current_salary:number|string|null; comment_1:string; comment_2:string; comment_3:string; comment_4:string; comment_5:string; note:string; snapshot_full_name:string|null; snapshot_email:string|null; snapshot_position:string|null; snapshot_national_id:string|null; snapshot_bank_account:string|null; snapshot_personnel_group:string|null; snapshot_source_sheet:string|null; employee:{ id:string; employee_code:string|null; full_name:string; email:string; position:string; national_id:string; bank_account:string; active:boolean; personnel_group:string|null; source_sheet:string|null } };
type EmailHistoryRow = { id:string; evaluation_id:string; status:"queued"|"sending"|"sent"|"failed"; sent_at:string|null; created_at:string; recipient_email:string; error_message:string|null };

const personnelGroups = ["ผู้บริหาร","หัวหน้าฝ่าย","หัวหน้ากลุ่มสาระ","บุคลากร","หอพัก","แม่บ้าน-รปภ"] as const;
type PersonnelGroup = "ทั้งหมด" | typeof personnelGroups[number];

const sample: Person[] = [
  { id:"EMP-001", status:"ปฏิบัติงาน", name:"นางสาวตัวอย่าง หนึ่ง", email:"person1@school.ac.th", position:"ครูประจำการวิชาคณิตศาสตร์", nationalId:"1-2345-67890-12-3", bankAccount:"123-4-56789-0", score:88.5, raisePercent:4, oldSalary:24200, salaryIncrease:970, currentSalary:25170, comments:["มีความรับผิดชอบและพัฒนาการจัดการเรียนรู้อย่างต่อเนื่อง",""], note:"", source:"ตัวอย่าง" },
  { id:"EMP-002", status:"ปฏิบัติงาน", name:"นายตัวอย่าง สอง", email:"person2@school.ac.th", position:"ครูประจำการวิชาวิทยาศาสตร์", nationalId:"2-3456-78901-23-4", bankAccount:"234-5-67890-1", score:84, raisePercent:3.5, oldSalary:21800, salaryIncrease:760, currentSalary:22560, comments:["ควรพัฒนาการจัดเก็บหลักฐานผลการปฏิบัติงานให้เป็นระบบ",""], note:"", source:"ตัวอย่าง" },
  { id:"EMP-003", status:"ปฏิบัติงาน", name:"นางตัวอย่าง สาม", email:"", position:"เจ้าหน้าที่บริหารงานทั่วไป", nationalId:"", bankAccount:"", score:null, raisePercent:null, oldSalary:19500, salaryIncrease:null, currentSalary:null, comments:[""], note:"", source:"ตัวอย่าง" },
];

const keys = {
  name:["ชื่อ-สกุล","ชื่อ–สกุล","ชื่อ - สกุล","ชื่อ-นามสกุล"],
  status:["สถานะปีนี้","สถานะ"],
  email:["อีเมล","email"], position:["ตำแหน่ง","position"],
  score:["ผลประเมิน(%)","ผลประเมิน (%)","ผลประเมิน"],
  raise:["ร้อยละที่เพิิ่ม","ร้อยละที่เพิ่ม","ร้อยละที่ปรับขึ้น"],
  old:["เงินเดือนเดิม","old salary"], id:["รหัสบุคลากร","รหัสพนักงาน","เลขประจำตัว"],
  increase:["จำนวนเงินที่เพิ่ม","เงินเดือนที่เพิ่ม"], current:["เงินเดือนปัจจุบัน","เงินเดือนใหม่"],
  nationalId:["เลขบัตรประชาชน","เลขประจำตัวประชาชน","เลขประจำตัวประชาชน/ผู้เสียภาษี"],
  bankAccount:["เลขบัญชีธนาคาร","เข้าบัญชีธนาคารไทยพาณิชย์ เลขที่"],
  comments:[
    ["ข้อเสนอแนะ","ข้อเสนอแนะ 1","ข้อเสนอแนะ1"],
    ["ข้อเสนอแนะ 2","ข้อเสนอแนะ2"],
    ["ข้อเสนอแนะ 3","ข้อเสนอแนะ3"],
    ["ข้อเสนอแนะ 4","ข้อเสนอแนะ4"],
    ["ข้อเสนอแนะ 5","ข้อเสนอแนะ5"],
  ],
  note:["หมายเหตุ","หมายเหตุ (ถ้ามี)"],
};

function pick(row: Record<string, unknown>, names: string[]) {
  const found = Object.keys(row).find(k => names.some(n => k.trim().toLowerCase() === n.toLowerCase()));
  return found ? row[found] : undefined;
}
const num = (v: unknown) => Number(String(v ?? "").replace(/,/g,"")) || 0;
const optionalNum = (v: unknown) => { const value=String(v??"").replace(/,/g,"").trim(); return !value||value==="-"?null:Number(value); };
const salaryText = (value:number|null) => value===null?"-":`${value.toLocaleString()} บาท`;

function validateImport(rows:Person[]){
  const allowed=new Set(["ผู้บริหาร","หัวหน้าฝ่าย","หัวหน้ากลุ่มสาระ","บุคลากร","หอพัก","แม่บ้าน-รปภ"]);
  const issues:string[]=[];const emails=new Set<string>();const codes=new Set<string>();const nationalIds=new Set<string>();
  rows.forEach((person,index)=>{
    const label=`แถว ${index+1}${person.name?` (${person.name})`:""}`;
    if(!allowed.has(person.source))issues.push(`${label}: ชื่อแท็บไม่ถูกต้อง`);
    if(person.status!=="ปฏิบัติงาน"&&person.status!=="พ้นสภาพ")issues.push(`${label}: สถานะปีนี้ไม่ถูกต้อง`);
    if(!person.name)issues.push(`${label}: ไม่มีชื่อ–สกุล`);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email))issues.push(`${label}: อีเมลไม่ถูกต้อง`);
    if(!person.position)issues.push(`${label}: ไม่มีตำแหน่ง`);
    if(!person.nationalId)issues.push(`${label}: ไม่มีเลขบัตรประชาชน/เลขผู้เสียภาษี`);
    if(!person.bankAccount)issues.push(`${label}: ไม่มีเลขบัญชีธนาคาร`);
    if(person.status==="ปฏิบัติงาน"&&person.oldSalary<=0)issues.push(`${label}: เงินเดือนเดิมไม่ถูกต้อง`);
    const hasAdjustment=[person.raisePercent,person.salaryIncrease,person.currentSalary].some(value=>value!==null);
    const completeAdjustment=[person.raisePercent,person.salaryIncrease,person.currentSalary].every(value=>value!==null);
    if(person.status==="ปฏิบัติงาน"&&hasAdjustment&&!completeAdjustment)issues.push(`${label}: ข้อมูลการปรับเงินเดือนไม่ครบ`);
    if(completeAdjustment&&person.currentSalary!==person.oldSalary+person.salaryIncrease!)issues.push(`${label}: เงินเดือนปัจจุบันไม่เท่ากับเงินเดือนเดิมบวกจำนวนเงินที่เพิ่ม`);
    const email=person.email.toLowerCase();const code=person.id.toLowerCase();const national=person.nationalId.replace(/[-\s]/g,"").toLowerCase();
    if(email&&emails.has(email))issues.push(`${label}: อีเมลซ้ำ`);else emails.add(email);
    if(code&&codes.has(code))issues.push(`${label}: รหัสบุคลากรซ้ำ`);else if(code)codes.add(code);
    if(national&&nationalIds.has(national))issues.push(`${label}: เลขบัตรประชาชนซ้ำ`);else nationalIds.add(national);
  });
  return issues;
}
function serializeImportRows(rows:Person[]){
  return rows.map(person=>({code:person.id,status:person.status,name:person.name,email:person.email,position:person.position,nationalId:person.nationalId,bankAccount:person.bankAccount,score:person.score,oldSalary:person.oldSalary,raisePercent:person.raisePercent,salaryIncrease:person.salaryIncrease,currentSalary:person.currentSalary,comments:person.comments,note:person.note,source:person.source}));
}

export default function Home() {
  const [people,setPeople] = useState<Person[]>(sample);
  const [selected,setSelected] = useState(0);
  const [step,setStep] = useState<"import"|"review"|"report">("import");
  const [message,setMessage] = useState("");
  const [token,setToken] = useState<string|null>(null);
  const [authReady,setAuthReady] = useState(false);
  const [loginEmail,setLoginEmail] = useState("panuwat.pond@gmail.com");
  const [loginPassword,setLoginPassword] = useState("");
  const [authError,setAuthError] = useState("");
  const [recoveryToken,setRecoveryToken] = useState<string|null>(null);
  const [newPassword,setNewPassword] = useState("");
  const [resetMessage,setResetMessage] = useState("");
  const [saving,setSaving] = useState(false);
  const [pdfLoading,setPdfLoading] = useState<"preview"|"download"|null>(null);
  const [batchPdfLoading,setBatchPdfLoading] = useState(false);
  const [emailHistory,setEmailHistory] = useState<Record<string,EmailHistoryRow>>({});
  const [emailDelivered,setEmailDelivered] = useState<Record<string,boolean>>({});
  const [emailConfigured,setEmailConfigured] = useState(false);
  const [emailHistoryReady,setEmailHistoryReady] = useState(false);
  const [emailTestRecipient,setEmailTestRecipient] = useState("");
  const [sendingEmails,setSendingEmails] = useState<"test"|"single"|"all"|null>(null);
  const [emailProgress,setEmailProgress] = useState({done:0,total:0,sent:0,failed:0});
  const [pendingImport,setPendingImport] = useState<ImportPreview|null>(null);
  const [importing,setImporting] = useState(false);
  const [cycles,setCycles] = useState<Cycle[]>([]);
  const [academicYear,setAcademicYear] = useState(2568);
  const [cycleStatus,setCycleStatus] = useState<Cycle["status"]>("draft");
  const [creatingCycle,setCreatingCycle] = useState(false);
  const [personnelGroup,setPersonnelGroup] = useState<PersonnelGroup>("ทั้งหมด");
  const [personnelSearch,setPersonnelSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const current=people[selected] ?? sample[0];
  const errors=useMemo(()=>people.map((p,i)=>{const adjustment=[p.raisePercent,p.salaryIncrease,p.currentSalary];const hasAdjustment=adjustment.some(value=>value!==null);const completeAdjustment=adjustment.every(value=>value!==null);return {i,items:[!p.name&&"ไม่มีชื่อ",!p.email&&"ไม่มีอีเมล",p.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)&&"อีเมลไม่ถูกต้อง",!p.nationalId&&"ไม่มีเลขบัตรประชาชน",!p.bankAccount&&"ไม่มีเลขบัญชีธนาคาร",p.oldSalary<=0&&"ไม่มีเงินเดือนเดิม",p.score===null&&"ยังไม่มีผลประเมิน",hasAdjustment&&!completeAdjustment&&"ข้อมูลการปรับเงินเดือนไม่ครบ",completeAdjustment&&p.currentSalary!==p.oldSalary+p.salaryIncrease!&&"ยอดเงินเดือนปัจจุบันไม่ตรง"].filter(Boolean) as string[]}}).filter(x=>x.items.length),[people]);
  const groupCounts=useMemo(()=>people.reduce<Record<string,number>>((counts,person)=>{counts[person.source]=(counts[person.source]??0)+1;return counts;},{}),[people]);
  const visiblePeople=useMemo(()=>{
    const query=personnelSearch.trim().toLocaleLowerCase("th");
    return people.map((person,index)=>({person,index})).filter(({person})=>
      (personnelGroup==="ทั้งหมด"||person.source===personnelGroup)&&
      (!query||[person.name,person.position,person.email].some(value=>value.toLocaleLowerCase("th").includes(query)))
    );
  },[people,personnelGroup,personnelSearch]);
  const visiblePosition=visiblePeople.findIndex(item=>item.index===selected);
  const visibleErrors=errors.filter(error=>visiblePeople.some(item=>item.index===error.i));
  const visibleReady=visiblePeople.length-visibleErrors.length;
  const increase=current.salaryIncrease;
  const currentEmailHistory=current.evaluationId?emailHistory[current.evaluationId]:undefined;

  useEffect(()=>{
    async function initialize(){
      await Promise.resolve();
      const hash=new URLSearchParams(window.location.hash.replace(/^#/,""));
      if(hash.get("type")==="recovery"&&hash.get("access_token")){
        setRecoveryToken(hash.get("access_token"));setAuthReady(true);window.history.replaceState({},"",window.location.pathname);return;
      }
      const saved=window.localStorage.getItem("psu_admin_token");
      if(!saved){setAuthReady(true);return;}
      const savedPermissions=JSON.parse(window.localStorage.getItem("psu_admin_permissions")||"[]") as string[];
      if(savedPermissions.includes("leave")&&!savedPermissions.includes("evaluation")){window.location.replace("/leave");return;}
      setToken(saved);await loadCycles(saved);setAuthReady(true);
    }
    void initialize();
    // Initial authentication bootstrap intentionally runs once on page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  useEffect(()=>{
    if(visiblePeople.length&&!visiblePeople.some(item=>item.index===selected))setSelected(visiblePeople[0].index);
  },[selected,visiblePeople]);

  async function loadCycles(accessToken:string,preferredYear?:number){
    const response=await fetch("/api/cycles",{headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store"});
    if(response.status===401){window.localStorage.removeItem("psu_admin_token");setToken(null);return;}
    const data=await response.json();
    if(!response.ok){setMessage(data.error??"โหลดรอบประเมินไม่สำเร็จ");return;}
    const rows=(data.rows??[]) as Cycle[];setCycles(rows);
    const target=rows.find(row=>row.academic_year===preferredYear)??rows[0];
    if(target){setAcademicYear(target.academic_year);setCycleStatus(target.status);await loadPeople(accessToken,target.academic_year);}
  }

  async function loadPeople(accessToken:string,year=academicYear){
    const response=await fetch(`/api/evaluations?year=${year}`,{headers:{Authorization:`Bearer ${accessToken}`}});
    if(response.status===401){window.localStorage.removeItem("psu_admin_token");setToken(null);setAuthError("กรุณาเข้าสู่ระบบอีกครั้ง");return;}
    const data=await response.json();
    if(!response.ok){setMessage(data.error??"โหลดข้อมูลไม่สำเร็จ");return;}
    const loaded:Person[]=data.rows.map((row:ApiEvaluationRow)=>({
      id:row.employee.employee_code||row.employee.id, employeeId:row.employee.id, evaluationId:row.id,
      status:row.employee.active===false?"พ้นสภาพ":"ปฏิบัติงาน", name:row.snapshot_full_name||row.employee.full_name, email:row.snapshot_email||row.employee.email, position:row.snapshot_position||row.employee.position,
      nationalId:row.snapshot_national_id||row.employee.national_id||"", bankAccount:row.snapshot_bank_account||row.employee.bank_account||"",
      score:row.evaluation_score===null?null:Number(row.evaluation_score), raisePercent:row.raise_percent===null?null:Number(row.raise_percent),
      oldSalary:Number(row.old_salary), salaryIncrease:row.salary_increase===null?null:Number(row.salary_increase), currentSalary:row.current_salary===null?null:Number(row.current_salary), comments:[row.comment_1,row.comment_2,row.comment_3,row.comment_4,row.comment_5], note:row.note||"",
      source:row.snapshot_personnel_group||row.employee.personnel_group||row.snapshot_source_sheet||row.employee.source_sheet||"ไม่ระบุประเภท",
    }));
    setAcademicYear(data.academicYear);setCycleStatus(data.cycleStatus);setPeople(loaded);setSelected(0);setMessage(`โหลดข้อมูลปี ${data.academicYear} แล้ว ${loaded.length} คน`);void loadEmailHistory(accessToken);
  }

  async function loadEmailHistory(accessToken:string){
    const response=await fetch("/api/emails",{headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store"});
    if(!response.ok)return;
    const data=await response.json();setEmailConfigured(Boolean(data.configured));setEmailHistoryReady(Boolean(data.historyReady));setEmailTestRecipient(String(data.testRecipient||""));
    const latest:Record<string,EmailHistoryRow>={};const delivered:Record<string,boolean>={};
    (data.rows as EmailHistoryRow[]).forEach(row=>{if(!latest[row.evaluation_id])latest[row.evaluation_id]=row;if(row.status==="sent")delivered[row.evaluation_id]=true;});
    setEmailHistory(latest);setEmailDelivered(delivered);
  }

  async function login(e:React.FormEvent){
    e.preventDefault();setAuthError("");
    const base=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if(!base||!key){setAuthError("ยังไม่ได้ตั้งค่า Supabase บน Vercel");return;}
    const response=await fetch(`${base}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:key,"Content-Type":"application/json"},body:JSON.stringify({email:loginEmail,password:loginPassword})});
    const data=await response.json();
    if(!response.ok){setAuthError("อีเมลหรือรหัสผ่านไม่ถูกต้อง");return;}
    const permissions=Array.isArray(data.user?.app_metadata?.permissions)?data.user.app_metadata.permissions:[];
    window.localStorage.setItem("psu_admin_token",data.access_token);window.localStorage.setItem("psu_admin_permissions",JSON.stringify(permissions));
    if(permissions.includes("leave")&&!permissions.includes("evaluation")){window.location.replace("/leave");return;}
    setToken(data.access_token);setAuthReady(true);await loadCycles(data.access_token);
  }

  async function requestRecovery(){
    setAuthError("");setResetMessage("");
    const base=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if(!base||!key){setAuthError("ระบบยังไม่ได้ตั้งค่า Supabase");return;}
    const response=await fetch(`${base}/auth/v1/recover`,{method:"POST",headers:{apikey:key,"Content-Type":"application/json"},body:JSON.stringify({email:loginEmail,redirect_to:window.location.origin})});
    if(!response.ok){setAuthError("ส่งลิงก์ตั้งรหัสผ่านไม่สำเร็จ");return;}
    setResetMessage(`ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ${loginEmail} แล้ว`);
  }

  async function updatePassword(e:React.FormEvent){
    e.preventDefault();setAuthError("");
    const base=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if(!base||!key||!recoveryToken)return;
    const response=await fetch(`${base}/auth/v1/user`,{method:"PUT",headers:{apikey:key,Authorization:`Bearer ${recoveryToken}`,"Content-Type":"application/json"},body:JSON.stringify({password:newPassword})});
    if(!response.ok){setAuthError("ตั้งรหัสผ่านไม่สำเร็จ ลิงก์อาจหมดอายุ");return;}
    window.localStorage.setItem("psu_admin_token",recoveryToken);setToken(recoveryToken);setRecoveryToken(null);await loadCycles(recoveryToken);
  }

  async function saveCurrent(){
    if(cycleStatus==="closed"){setMessage("รอบประเมินนี้ปิดแล้ว จึงแก้ไขข้อมูลไม่ได้");return;}
    if(!token||!current.employeeId||!current.evaluationId){setMessage("รายการนี้ยังไม่ได้เชื่อมกับฐานข้อมูล");return;}
    setSaving(true);setMessage("");
    const response=await fetch("/api/evaluations",{method:"PATCH",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({...current})});
    const data=await response.json();setSaving(false);
    setMessage(response.ok?`บันทึกข้อมูลของ ${current.name} แล้ว`:data.error??"บันทึกไม่สำเร็จ");
  }

  async function openPdf(mode:"preview"|"download"){
    if(!token||!current.evaluationId){setMessage("รายการนี้ยังไม่ได้เชื่อมกับฐานข้อมูล");return;}
    const previewWindow=mode==="preview"?window.open("","_blank"):null;
    if(previewWindow){previewWindow.document.title="กำลังสร้าง PDF";previewWindow.document.body.textContent="กำลังสร้าง PDF กรุณารอสักครู่...";}
    setPdfLoading(mode);setMessage("");
    try{
      const response=await fetch(`/api/reports/${encodeURIComponent(current.evaluationId)}/pdf`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
      if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error??"สร้าง PDF ไม่สำเร็จ");}
      const blob=await response.blob();const url=URL.createObjectURL(blob);
      if(mode==="preview"){
        if(previewWindow)previewWindow.location.href=url;else window.open(url,"_blank");
        window.setTimeout(()=>URL.revokeObjectURL(url),60_000);
      }else{
        const link=document.createElement("a");link.href=url;link.download=`หนังสือแจ้งผลประเมิน_${current.name}_ลับ.pdf`;document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1_000);
      }
    }catch(error){previewWindow?.close();setMessage(error instanceof Error?error.message:"สร้าง PDF ไม่สำเร็จ");}
    finally{setPdfLoading(null);}
  }

  async function downloadAllPdfs(){
    if(!token){setMessage("กรุณาเข้าสู่ระบบอีกครั้ง");return;}
    const evaluationIds=people.map(person=>person.evaluationId).filter((id):id is string=>Boolean(id));
    if(evaluationIds.length!==people.length){setMessage("มีบุคลากรบางรายที่ยังไม่ได้เชื่อมกับฐานข้อมูล");return;}
    setBatchPdfLoading(true);setMessage("");
    try{
      const response=await fetch("/api/reports/batch",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({evaluationIds})});
      if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error??"สร้างชุด PDF ไม่สำเร็จ");}
      const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement("a");
      link.href=url;link.download=`หนังสือแจ้งผลประเมิน_บุคลากรทั้งหมด_${academicYear}_ลับ.zip`;document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1_000);
      setMessage(`สร้าง PDF ครบ ${evaluationIds.length} คนแล้ว`);
    }catch(error){setMessage(error instanceof Error?error.message:"สร้างชุด PDF ไม่สำเร็จ");}
    finally{setBatchPdfLoading(false);}
  }

  async function sendEmails(mode:"test"|"single"|"all"){
    if(!token){setMessage("กรุณาเข้าสู่ระบบอีกครั้ง");return;}
    if(!emailConfigured){setMessage("ยังไม่ได้ตั้งค่า Google Workspace บน Vercel");return;}
    if(!emailHistoryReady){setMessage("ยังไม่ได้สร้างตารางประวัติอีเมลใน Supabase");return;}
    const targets=mode==="single"||mode==="test"?[current]:people.filter(person=>!person.evaluationId||!emailDelivered[person.evaluationId]);
    if(!targets.length){setMessage("บุคลากรทุกคนส่งสำเร็จแล้ว หากต้องการส่งซ้ำให้เลือกและกดส่งรายคน");return;}
    const evaluationIds=targets.map(person=>person.evaluationId).filter((id):id is string=>Boolean(id));
    if(evaluationIds.length!==targets.length){setMessage("มีรายการที่ยังไม่ได้เชื่อมกับฐานข้อมูล");return;}
    const confirmation=mode==="test"
      ?`ยืนยันส่งอีเมลทดสอบไปที่\n${emailTestRecipient}\n\nPDF ที่แนบเป็นข้อมูลจริงของ ${current.name} แต่จะไม่บันทึกว่าบุคลากรได้รับแล้ว`
      :mode==="single"
      ?`ยืนยันส่งเอกสารลับให้\n${current.name}\n${current.email}\n\nระบบจะส่ง PDF ของบุคคลนี้อีกครั้ง`
      :`ยืนยันส่งเอกสารลับให้บุคลากร ${targets.length} คน\n\nแต่ละคนจะได้รับเฉพาะ PDF ของตนเอง กรุณาตรวจอีเมลผู้รับแล้ว`;
    if(!window.confirm(confirmation))return;
    const requestId=crypto.randomUUID();let sent=0;let failed=0;let done=0;
    setSendingEmails(mode);setEmailProgress({done:0,total:evaluationIds.length,sent:0,failed:0});setMessage("");
    try{
      for(let start=0;start<evaluationIds.length;start+=5){
        const chunk=evaluationIds.slice(start,start+5);
        const response=await fetch("/api/emails",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({requestId,evaluationIds:chunk,test:mode==="test"})});
        const data=await response.json();
        if(!response.ok)throw new Error(data.error??"ส่งอีเมลไม่สำเร็จ");
        for(const result of data.results as {status:"sent"|"failed"|"skipped"}[]){if(result.status==="failed")failed+=1;else sent+=1;done+=1;}
        setEmailProgress({done,total:evaluationIds.length,sent,failed});
      }
      setMessage(mode==="test"&&!failed?`ส่งอีเมลทดสอบไปที่ ${emailTestRecipient} แล้ว`:failed?`ส่งสำเร็จ ${sent} คน · ไม่สำเร็จ ${failed} คน สามารถส่งซ้ำเป็นรายคนได้`:`ส่งอีเมลสำเร็จครบ ${sent} คน`);
    }catch(error){setMessage(error instanceof Error?error.message:"ส่งอีเมลไม่สำเร็จ");}
    finally{setSendingEmails(null);await loadEmailHistory(token);}
  }

  async function importExcel(file: File) {
    try {
      const data=await file.arrayBuffer(); const wb=XLSX.read(data,{type:"array"});
      const rows: Record<string,unknown>[]=[];
      wb.SheetNames.forEach(sheetName=>{
        const sheet=wb.Sheets[sheetName];
        const raw=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:""});
        const headerIndex=raw.findIndex(r=>Array.isArray(r)&&r.some(c=>keys.name.some(name=>String(c).replace(/\n/g," ").trim()===name)));
        if(headerIndex<0)return;
        const headers=(raw[headerIndex] as unknown[]).map(x=>String(x).replace(/\n/g," ").trim());
        raw.slice(headerIndex+1).forEach(r=>{const obj:Record<string,unknown>={};headers.forEach((h,i)=>obj[h]=(r as unknown[])[i]);obj.__sheet=sheetName;rows.push(obj);});
      });
      const imported=rows.filter(r=>pick(r,keys.name)).map((r,i):Person=>({
        id:String(pick(r,keys.id)??`EMP-${String(i+1).padStart(3,"0")}`), name:String(pick(r,keys.name)??""),
        status:String(pick(r,keys.status)??"ปฏิบัติงาน").trim()==="พ้นสภาพ"?"พ้นสภาพ":"ปฏิบัติงาน",
        email:String(pick(r,keys.email)??"").trim().toLowerCase(), position:String(pick(r,keys.position)??""),
        nationalId:String(pick(r,keys.nationalId)??"").trim(), bankAccount:String(pick(r,keys.bankAccount)??"").trim(),
        score:pick(r,keys.score)===""||pick(r,keys.score)==null?null:num(pick(r,keys.score)),
        raisePercent:optionalNum(pick(r,keys.raise)), oldSalary:num(pick(r,keys.old)), salaryIncrease:optionalNum(pick(r,keys.increase)), currentSalary:optionalNum(pick(r,keys.current)),
        comments:keys.comments.map(names=>String(pick(r,names)??"").trim()), note:String(pick(r,keys.note)??"").trim(), source:String(r.__sheet??"")
      }));
      if(!imported.length) throw new Error("ไม่พบตารางบุคลากรในรูปแบบที่รองรับ");
      const issues=validateImport(imported);
      const groupCounts=imported.reduce<Record<string,number>>((result,person)=>{result[person.source]=(result[person.source]??0)+1;return result;},{});
      if(issues.length){setPendingImport({fileName:file.name,rows:imported,sheetCount:Object.keys(groupCounts).length,groupCounts,issues});setMessage(`พบข้อมูลที่ต้องแก้ ${issues.length} จุด`);return;}
      if(!token)throw new Error("กรุณาเข้าสู่ระบบอีกครั้ง");
      const previewResponse=await fetch("/api/imports",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({academicYear,fileName:file.name,confirm:false,rows:serializeImportRows(imported)})});
      const previewData=await previewResponse.json();
      if(!previewResponse.ok)throw new Error(previewData.issues?.slice(0,5).map((issue:{name?:string;message:string})=>`${issue.name||"รายการ"}: ${issue.message}`).join(" · ")||previewData.error||"ตรวจไฟล์ไม่สำเร็จ");
      setPendingImport({fileName:file.name,rows:imported,sheetCount:Object.keys(groupCounts).length,groupCounts,issues:[],comparison:previewData.preview});
      setMessage(previewData.preview.missing.length?`พบคนที่ไม่อยู่ในไฟล์ ${previewData.preview.missing.length} คน กรุณาตรวจสอบ`:`ตรวจไฟล์แล้ว ${imported.length} คน กรุณายืนยันก่อนบันทึก`);
    } catch (e) { setMessage(e instanceof Error?e.message:"อ่านไฟล์ไม่สำเร็จ"); }
  }

  async function confirmImport(){
    if(!token||!pendingImport||pendingImport.issues.length)return;
    setImporting(true);setMessage("");
    const response=await fetch("/api/imports",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({academicYear,fileName:pendingImport.fileName,confirm:true,rows:serializeImportRows(pendingImport.rows)})});
    const data=await response.json();setImporting(false);
    if(!response.ok){setMessage(data.issues?.slice(0,5).map((issue:{row:number;name?:string;message:string})=>`${issue.name||`รายการ ${issue.row}`}: ${issue.message}`).join(" · ")||data.error||"นำเข้าไม่สำเร็จ");return;}
    setPendingImport(null);await loadPeople(token,academicYear);setStep("review");setMessage(`บันทึกข้อมูลแล้ว ${data.importedEmployees} คน`);
  }

  async function createNextCycle(){
    if(!token||creatingCycle)return;
    const nextYear=Math.max(...cycles.map(cycle=>cycle.academic_year),academicYear)+1;
    if(!window.confirm(`สร้างรอบปีการศึกษา ${nextYear} จากข้อมูลปี ${academicYear}\n\nระบบจะยกเงินเดือนใหม่มาเป็นเงินเดือนเดิม และล้างคะแนนกับข้อเสนอแนะ`))return;
    setCreatingCycle(true);setMessage("");
    const response=await fetch("/api/cycles",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({academicYear:nextYear,sourceYear:academicYear})});
    const data=await response.json();setCreatingCycle(false);
    if(!response.ok){setMessage(data.error??"สร้างรอบใหม่ไม่สำเร็จ");return;}
    await loadCycles(token,nextYear);setStep("import");setMessage(`สร้างรอบปี ${nextYear} แล้ว ยกข้อมูลมา ${data.copied} คน กรุณานำเข้า Excel ใหม่เพื่อตรวจสอบ`);
  }

  function update(patch:Partial<Person>){setPeople(list=>list.map((p,i)=>i===selected?{...p,...patch}:p));}
  function updateComment(i:number,value:string){const comments=[...current.comments];comments[i]=value;update({comments});}
  function selectPrevious(){if(visiblePosition>0)setSelected(visiblePeople[visiblePosition-1].index);}
  function selectNext(){if(visiblePosition>=0&&visiblePosition<visiblePeople.length-1)setSelected(visiblePeople[visiblePosition+1].index);}

  if(!authReady)return <main className="login-page"><div className="login-card"><h1>กำลังโหลดระบบ</h1><p>กรุณารอสักครู่</p></div></main>;
  if(recoveryToken)return <main className="login-page"><form className="login-card" onSubmit={updatePassword}><div className="logo">ป</div><h1>ตั้งรหัสผ่านใหม่</h1><p>กรอกรหัสผ่านอย่างน้อย 8 ตัวอักษร</p><label>รหัสผ่านใหม่<input type="password" minLength={8} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/></label>{authError&&<div className="alert">{authError}</div>}<button className="primary" type="submit">บันทึกรหัสผ่านใหม่</button></form></main>;
  if(!token)return <main className="login-page"><form className="login-card" onSubmit={login}><div className="logo">ป</div><h1>เข้าสู่ระบบผู้ดูแล</h1><p>ระบบแจ้งผลประเมินบุคลากร</p><label>อีเมล<input type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} required/></label><label>รหัสผ่าน<input type="password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} required/></label>{authError&&<div className="alert">{authError}</div>}{resetMessage&&<div className="message compact">{resetMessage}</div>}<button className="primary" type="submit">เข้าสู่ระบบ</button><button className="link-button" type="button" onClick={requestRecovery}>ลืมรหัสผ่าน</button></form></main>;

  return <div className="app-shell">
    <header className="topbar"><div className="identity"><div className="logo">ป</div><div><strong>ระบบแจ้งผลประเมินบุคลากร</strong><span>โรงเรียน มอ. วิทยานุสรณ์ สุราษฎร์ธานี</span></div></div><div className="cycle cycle-controls"><Link className="module-link" href="/leave">แจ้งวันลา</Link><select aria-label="เลือกรอบประเมิน" value={academicYear} onChange={e=>token&&loadCycles(token,Number(e.target.value))}>{cycles.map(cycle=><option key={cycle.id} value={cycle.academic_year}>ปีการศึกษา {cycle.academic_year}{cycle.status==="closed"?" · ประวัติ":""}</option>)}</select><button onClick={createNextCycle} disabled={creatingCycle}>{creatingCycle?"กำลังสร้าง...":"+ สร้างรอบใหม่"}</button></div></header>
    <nav className="steps" aria-label="ขั้นตอนทำงาน">
      <button className={step==="import"?"active":""} onClick={()=>setStep("import")}><b>1</b><span>นำเข้า Excel</span></button>
      <button className={step==="review"?"active":""} onClick={()=>setStep("review")}><b>2</b><span>ตรวจและแก้ไข</span></button>
      <button className={step==="report"?"active":""} onClick={()=>setStep("report")}><b>3</b><span>ดูรายงานและส่ง</span></button>
    </nav>
    <main>
      {step==="import"&&<section className="page narrow"><div className="page-title"><div><h1>นำเข้าข้อมูลจาก Excel · ปี {academicYear}</h1><p>{cycleStatus==="closed"?"รอบนี้เป็นประวัติและถูกล็อกแล้ว เลือกรอบใหม่เพื่อทำข้อมูล":"ระบบจะเปรียบเทียบคนเดิม คนเข้าใหม่ คนพ้นสภาพ และข้อมูลที่เปลี่ยนก่อนบันทึก"}</p></div></div>
        <div className={`upload-card ${cycleStatus==="closed"?"disabled":""}`} onClick={()=>cycleStatus!=="closed"&&inputRef.current?.click()} onKeyDown={e=>e.key==="Enter"&&cycleStatus!=="closed"&&inputRef.current?.click()} role="button" tabIndex={0}>
          <div className="upload-icon">↑</div><h2>เลือกไฟล์ Excel</h2><p>รองรับ .xlsx และ .xls ข้อมูลต้นฉบับจะไม่ถูกแก้ไข</p><button className="primary">เลือกไฟล์จากเครื่อง</button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={e=>e.target.files?.[0]&&importExcel(e.target.files[0])}/>
        </div>
        {message&&<div className="message">{message}</div>}
        {pendingImport&&<div className="import-preview"><div><strong>ตรวจพบ {pendingImport.rows.length} คน จาก {pendingImport.sheetCount} กลุ่ม</strong><p>{Object.entries(pendingImport.groupCounts).map(([group,count])=>`${group} ${count} คน`).join(" · ")}</p></div>{pendingImport.comparison&&<div className="compare-grid"><div><span>คนเดิม</span><strong>{pendingImport.comparison.existing}</strong></div><div><span>เข้าใหม่</span><strong>{pendingImport.comparison.newPeople.length}</strong></div><div><span>พ้นสภาพ</span><strong>{pendingImport.comparison.departing.length}</strong></div><div><span>ข้อมูลเปลี่ยน</span><strong>{pendingImport.comparison.changed.length}</strong></div></div>}{pendingImport.comparison?.newPeople.length?<div className="change-note"><strong>คนเข้าใหม่</strong><p>{pendingImport.comparison.newPeople.join(" · ")}</p></div>:null}{pendingImport.comparison?.departing.length?<div className="change-note"><strong>พ้นสภาพ</strong><p>{pendingImport.comparison.departing.join(" · ")}</p></div>:null}{pendingImport.comparison?.missing.length?<div className="alert"><strong>ยังยืนยันไม่ได้ — ไม่พบในไฟล์ {pendingImport.comparison.missing.length} คน</strong><p>{pendingImport.comparison.missing.join(" · ")}</p><p>กรุณากลับไปเพิ่มรายชื่อและเลือกสถานะ “พ้นสภาพ” หรือเพิ่มข้อมูลที่ตกหล่น</p></div>:null}{pendingImport.issues.length>0?<div className="alert"><strong>ยังนำเข้าไม่ได้</strong><ul>{pendingImport.issues.slice(0,8).map((issue,index)=><li key={index}>{issue}</li>)}</ul>{pendingImport.issues.length>8&&<p>และอีก {pendingImport.issues.length-8} จุด</p>}</div>:<div className="import-actions"><button className="secondary" onClick={()=>{setPendingImport(null);setMessage("")}}>เลือกไฟล์ใหม่</button><button className="primary" disabled={importing||Boolean(pendingImport.comparison?.missing.length)} onClick={confirmImport}>{importing?"กำลังบันทึก...":`ยืนยันนำเข้า ${pendingImport.rows.length} คน`}</button></div>}</div>}
        <div className="safe-note"><strong>ข้อมูลที่ระบบใช้</strong><span>ชื่อ–สกุล · ตำแหน่ง · อีเมล · เลขบัตรประชาชน · บัญชีธนาคาร · ผลประเมิน · เงินเดือนเดิม · ร้อยละที่เพิ่ม · จำนวนเงินที่เพิ่ม · เงินเดือนปัจจุบัน · ข้อเสนอแนะ 1–5 และหมายเหตุ (ถ้ามี)</span></div>
      </section>}
      {step==="review"&&<section className="page"><div className="page-title"><div><h1>ตรวจและแก้ไขข้อมูล</h1><p>เลือกบุคลากรทางซ้าย แก้ข้อมูลและกรอกข้อเสนอแนะทางขวา</p></div><button className="primary" disabled={errors.length>0} onClick={()=>setStep("report")}>ดูรายงานทั้งหมด</button></div>
        <section className="personnel-filter" aria-label="ตัวกรองบุคลากร"><div className="filter-heading"><div><h2>เลือกแสดงบุคลากรตามประเภท</h2><p>เลือกกลุ่มเพื่อดูเฉพาะรายชื่อที่ต้องการ</p></div><label className="person-search"><span>ค้นหารายชื่อ</span><input type="search" value={personnelSearch} onChange={e=>setPersonnelSearch(e.target.value)} placeholder="ค้นหาชื่อ ตำแหน่ง หรืออีเมล"/></label></div><div className="group-tabs" role="group" aria-label="ประเภทบุคลากร"><button className={personnelGroup==="ทั้งหมด"?"active":""} aria-pressed={personnelGroup==="ทั้งหมด"} onClick={()=>setPersonnelGroup("ทั้งหมด")}><span>ทั้งหมด</span><strong>{people.length}</strong></button>{personnelGroups.map(group=><button key={group} className={personnelGroup===group?"active":""} aria-pressed={personnelGroup===group} onClick={()=>setPersonnelGroup(group)}><span>{group}</span><strong>{groupCounts[group]??0}</strong></button>)}</div></section>
        <div className="stats"><div><span>กำลังแสดง</span><strong>{visiblePeople.length}</strong></div><div><span>พร้อมแล้ว</span><strong>{visibleReady}</strong></div><div className={visibleErrors.length?"warning":""}><span>ต้องตรวจ</span><strong>{visibleErrors.length}</strong></div></div>
        {message&&<div className="message compact">{message}</div>}
        <div className="workspace"><aside className="person-list"><div className="list-head"><span>รายชื่อบุคลากร</span><small>{personnelGroup} · {visiblePeople.length} คน</small></div>{visiblePeople.length?visiblePeople.map(({person:p,index:i})=>{const issue=errors.find(x=>x.i===i);return <button key={`${p.id}-${i}`} className={i===selected?"selected":""} onClick={()=>setSelected(i)}><span><strong>{p.name||"ยังไม่มีชื่อ"}</strong><small>{p.position||"ยังไม่มีตำแหน่ง"}</small></span><em className={issue?"bad":"good"}>{issue?issue.items.length:"✓"}</em></button>}):<div className="empty-list"><strong>ไม่พบรายชื่อ</strong><span>ลองเปลี่ยนประเภทหรือคำค้นหา</span></div>}</aside>
          <div className="editor"><div className="editor-head"><div><h2>{current.name||"ข้อมูลบุคลากร"}</h2><div className="person-meta"><span>{current.source}</span><small>{current.position||"ยังไม่มีตำแหน่ง"}</small></div></div><span className={errors.find(x=>x.i===selected)?"pill bad":"pill good"}>{errors.find(x=>x.i===selected)?"ข้อมูลยังไม่ครบ":"พร้อมสร้างรายงาน"}</span></div>
            {errors.find(x=>x.i===selected)&&<div className="alert">กรุณาตรวจ: {errors.find(x=>x.i===selected)?.items.join(" · ")}</div>}
            <div className="form-grid"><label>ชื่อ–สกุล<input value={current.name} onChange={e=>update({name:e.target.value})}/></label><label>ตำแหน่ง<input value={current.position} onChange={e=>update({position:e.target.value})}/></label><label>อีเมลผู้รับ<input type="email" value={current.email} onChange={e=>update({email:e.target.value})}/></label><label>เลขบัตรประชาชน/ผู้เสียภาษี<input value={current.nationalId} onChange={e=>update({nationalId:e.target.value})}/></label><label>เลขบัญชีธนาคาร<input value={current.bankAccount} onChange={e=>update({bankAccount:e.target.value})}/></label><label>ผลประเมิน (%)<input type="number" min="0" max="100" step="0.01" value={current.score??""} onChange={e=>update({score:e.target.value===""?null:Number(e.target.value)})}/></label><label>เงินเดือนเดิม (บาท)<input type="number" min="0" value={current.oldSalary||""} onChange={e=>update({oldSalary:Number(e.target.value)})}/></label><label>ร้อยละที่ปรับขึ้น<input type="number" min="0" step="0.01" placeholder="-" value={current.raisePercent??""} onChange={e=>update({raisePercent:e.target.value===""?null:Number(e.target.value)})}/></label><label>จำนวนเงินที่เพิ่ม (บาท)<input type="number" min="0" step="1" placeholder="-" value={current.salaryIncrease??""} onChange={e=>{const salaryIncrease=e.target.value===""?null:Number(e.target.value);update({salaryIncrease,currentSalary:salaryIncrease===null?null:current.oldSalary+salaryIncrease})}}/></label><label>เงินเดือนปัจจุบัน (บาท)<input type="number" min="0" step="1" placeholder="-" value={current.currentSalary??""} onChange={e=>update({currentSalary:e.target.value===""?null:Number(e.target.value)})}/></label></div>
            <div className="calculation"><div><span>เงินเดือนเดิม</span><strong>{salaryText(current.oldSalary)}</strong></div><div><span>จำนวนเงินที่เพิ่ม</span><strong>{salaryText(increase)}</strong></div><div><span>เงินเดือนปัจจุบัน</span><strong>{salaryText(current.currentSalary)}</strong></div></div>
            <div className="comments"><div><h3>ข้อเสนอแนะของงานบุคลากร</h3><p>ไม่บังคับกรอก เพิ่มได้สูงสุด 5 ข้อ</p></div>{Array.from({length:5}).map((_,i)=><label key={i}><span>{i+1}.</span><textarea rows={2} placeholder="ข้อเสนอแนะ (ถ้ามี)" value={current.comments[i]??""} onChange={e=>updateComment(i,e.target.value)}/></label>)}</div>
            <section className={`note-editor ${current.note.trim()?"has-note":""}`}><div><div><h3>หมายเหตุในรายงาน</h3><p>แสดงในหน้ารายงาน PDF และอีเมลเฉพาะบุคลากรที่มีข้อความ</p></div><span>{current.note.trim()?"มีหมายเหตุ":"ไม่มีหมายเหตุ"}</span></div><textarea rows={3} placeholder="กรอกหมายเหตุเฉพาะกรณีที่ต้องการให้แสดงในรายงาน" value={current.note} onChange={e=>update({note:e.target.value})}/></section>
            <div className="editor-actions"><button className="secondary" disabled={visiblePosition<=0} onClick={selectPrevious}>คนก่อนหน้า</button><span className="record-position">{visiblePosition>=0?`${visiblePosition+1} / ${visiblePeople.length}`:"–"}</span><div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}><button className="secondary" disabled={Boolean(errors.find(x=>x.i===selected))||pdfLoading!==null} onClick={()=>openPdf("preview")}>{pdfLoading==="preview"?"กำลังสร้าง...":"ดู PDF รายคน"}</button><button className="primary" disabled={saving||cycleStatus==="closed"} onClick={async()=>{await saveCurrent();selectNext()}}>{cycleStatus==="closed"?"รอบนี้ปิดแล้ว":saving?"กำลังบันทึก...":visiblePosition===visiblePeople.length-1?"บันทึกข้อมูล":"บันทึกและไปคนถัดไป"}</button></div></div>
          </div></div>
      </section>}
      {step==="report"&&<section className="page"><div className="page-title"><div><h1>ตรวจรายงานก่อนส่ง</h1><p>ข้อมูลด้านล่างคือข้อมูลที่จะปรากฏใน PDF ของบุคลากร</p></div><div className="report-actions"><button className="secondary" disabled={Boolean(errors.find(x=>x.i===selected))||sendingEmails!==null||!emailConfigured||!emailHistoryReady||!emailTestRecipient} onClick={()=>sendEmails("test")}>{sendingEmails==="test"?"กำลังส่งทดสอบ...":"ส่งอีเมลทดสอบ"}</button><button className="secondary" onClick={()=>setStep("review")}>กลับไปแก้ข้อมูล</button></div></div>
        {errors.length>0?<div className="blocking"><strong>ยังสร้างรายงานทั้งหมดไม่ได้</strong><p>มีข้อมูลที่ต้องตรวจอีก {errors.length} คน กรุณากลับไปแก้ให้ครบ</p><button className="primary" onClick={()=>{setSelected(errors[0].i);setStep("review")}}>ไปยังรายการแรกที่ต้องแก้</button></div>:<div className="report-layout"><aside className="report-nav">{people.map((p,i)=><button key={p.id} onClick={()=>setSelected(i)} className={i===selected?"selected":""}>{p.name}</button>)}</aside><div><article className="paper"><div className="school">โรงเรียน มอ. วิทยานุสรณ์ สุราษฎร์ธานี</div><h2>หนังสือแจ้งผลการประเมินผลการปฏิบัติงาน<br/>และการปรับขึ้นเงินเดือน ปีการศึกษา {academicYear}</h2><dl><dt>ชื่อ–สกุล</dt><dd>{current.name}</dd><dt>ตำแหน่ง</dt><dd>{current.position}</dd><dt>ผลประเมิน</dt><dd>{current.score?.toFixed(2)}%</dd></dl><div className="salary-table"><div>เงินเดือนเดิม</div><div>ร้อยละที่เพิ่ม</div><div>จำนวนเงินที่เพิ่ม</div><div>เงินเดือนปัจจุบัน</div><strong>{current.oldSalary.toLocaleString()}</strong><strong>{current.raisePercent===null?"-":`${current.raisePercent.toFixed(2)}%`}</strong><strong>{increase===null?"-":increase.toLocaleString()}</strong><strong>{current.currentSalary===null?"-":current.currentSalary.toLocaleString()}</strong></div>{current.comments.some(c=>c.trim())&&<><h3>ข้อเสนอแนะ</h3><ol>{current.comments.filter(c=>c.trim()).map((c,i)=><li key={i}>{c}</li>)}</ol></>}{current.note.trim()&&<div className="report-note"><h3>หมายเหตุ</h3><p>{current.note}</p></div>}</article><div className="send-panel"><div><strong>PDF ของ {current.name}</strong><p>ไฟล์จริงมีเลขบัตรประชาชน บัญชีธนาคาร และคำว่า “ลับ”</p></div><div className="report-actions"><button className="secondary" disabled={pdfLoading!==null||batchPdfLoading||sendingEmails!==null} onClick={()=>openPdf("preview")}>{pdfLoading==="preview"?"กำลังสร้าง...":"ดู PDF"}</button><button className="secondary" disabled={pdfLoading!==null||batchPdfLoading||sendingEmails!==null} onClick={()=>openPdf("download")}>{pdfLoading==="download"?"กำลังดาวน์โหลด...":"ดาวน์โหลดรายคน"}</button><button className="secondary" disabled={pdfLoading!==null||batchPdfLoading||sendingEmails!==null} onClick={downloadAllPdfs}>{batchPdfLoading?"กำลังสร้างทุกคน...":`ดาวน์โหลดทุกคน (${people.length})`}</button></div></div><div className="send-panel email-send-panel"><div><strong>ส่งอีเมลเอกสารลับ</strong><p>{current.name} · {current.email}</p>{currentEmailHistory?.status==="sent"&&<p className="sent-status">ส่งล่าสุด {new Date(currentEmailHistory.sent_at||currentEmailHistory.created_at).toLocaleString("th-TH")}</p>}{currentEmailHistory?.status==="failed"&&<p className="failed-status">ครั้งล่าสุดส่งไม่สำเร็จ — กดส่งรายคนเพื่อลองอีกครั้ง</p>}{!emailConfigured&&<p className="failed-status">ยังไม่ได้ตั้งค่า Google Workspace บน Vercel</p>}{emailConfigured&&!emailHistoryReady&&<p className="failed-status">ยังไม่ได้สร้างตารางประวัติอีเมลใน Supabase</p>}</div><div className="report-actions"><button className="secondary" disabled={sendingEmails!==null||!emailConfigured||!emailHistoryReady} onClick={()=>sendEmails("single")}>{sendingEmails==="single"?"กำลังส่ง...":currentEmailHistory?.status==="sent"?"ส่งอีเมลรายคนอีกครั้ง":"ส่งอีเมลรายคน"}</button><button className="primary" disabled={sendingEmails!==null||!emailConfigured||!emailHistoryReady} onClick={()=>sendEmails("all")}>{sendingEmails==="all"?`กำลังส่ง ${emailProgress.done}/${emailProgress.total}`:`ยืนยันและส่งทั้งหมด (${people.length})`}</button></div></div>{sendingEmails&&<div className="email-progress"><strong>กำลังส่งอีเมล กรุณาอย่าปิดหน้านี้</strong><p>ดำเนินการแล้ว {emailProgress.done} จาก {emailProgress.total} · สำเร็จ {emailProgress.sent} · ไม่สำเร็จ {emailProgress.failed}</p><progress max={emailProgress.total||1} value={emailProgress.done}/></div>}{message&&<div className="message compact">{message}</div>}</div></div>}
      </section>}
    </main>
  </div>;
}


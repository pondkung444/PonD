"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

type Person = {
  id: string; employeeId?: string; evaluationId?: string; name: string; email: string; position: string;
  score: number | null; raisePercent: number; oldSalary: number;
  comments: string[]; source: string;
};

const sample: Person[] = [
  { id:"EMP-001", name:"นางสาวตัวอย่าง หนึ่ง", email:"person1@school.ac.th", position:"ครูประจำการวิชาคณิตศาสตร์", score:88.5, raisePercent:4, oldSalary:24200, comments:["มีความรับผิดชอบและพัฒนาการจัดการเรียนรู้อย่างต่อเนื่อง",""], source:"ตัวอย่าง" },
  { id:"EMP-002", name:"นายตัวอย่าง สอง", email:"person2@school.ac.th", position:"ครูประจำการวิชาวิทยาศาสตร์", score:84, raisePercent:3.5, oldSalary:21800, comments:["ควรพัฒนาการจัดเก็บหลักฐานผลการปฏิบัติงานให้เป็นระบบ",""], source:"ตัวอย่าง" },
  { id:"EMP-003", name:"นางตัวอย่าง สาม", email:"", position:"เจ้าหน้าที่บริหารงานทั่วไป", score:null, raisePercent:0, oldSalary:19500, comments:[""], source:"ตัวอย่าง" },
];

const keys = {
  name:["ชื่อ-สกุล","ชื่อ–สกุล","ชื่อ - สกุล","ชื่อ-นามสกุล"],
  email:["อีเมล","email"], position:["ตำแหน่ง","position"],
  score:["ผลประเมิน(%)","ผลประเมิน (%)","ผลประเมิน"],
  raise:["ร้อยละที่เพิิ่ม","ร้อยละที่เพิ่ม","ร้อยละที่ปรับขึ้น"],
  old:["เงินเดือนเดิม","old salary"], id:["รหัสบุคลากร","รหัสพนักงาน","เลขประจำตัว"],
  comments:[
    ["ข้อเสนอแนะ","ข้อเสนอแนะ 1","ข้อเสนอแนะ1"],
    ["ข้อเสนอแนะ 2","ข้อเสนอแนะ2"],
    ["ข้อเสนอแนะ 3","ข้อเสนอแนะ3"],
    ["ข้อเสนอแนะ 4","ข้อเสนอแนะ4"],
    ["ข้อเสนอแนะ 5","ข้อเสนอแนะ5"],
  ],
};

function pick(row: Record<string, unknown>, names: string[]) {
  const found = Object.keys(row).find(k => names.some(n => k.trim().toLowerCase() === n.toLowerCase()));
  return found ? row[found] : undefined;
}
const num = (v: unknown) => Number(String(v ?? "").replace(/,/g,"")) || 0;

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
  const [saving,setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const current=people[selected] ?? sample[0];
  const errors=useMemo(()=>people.map((p,i)=>({i,items:[!p.name&&"ไม่มีชื่อ",!p.email&&"ไม่มีอีเมล",p.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)&&"อีเมลไม่ถูกต้อง",p.oldSalary<=0&&"ไม่มีเงินเดือนเดิม",p.score===null&&"ยังไม่มีผลประเมิน"].filter(Boolean) as string[]})).filter(x=>x.items.length),[people]);
  const increase=Math.round(current.oldSalary*current.raisePercent/100);

  useEffect(()=>{
    const saved=window.localStorage.getItem("psu_admin_token");
    if(!saved){setAuthReady(true);return;}
    setToken(saved); void loadPeople(saved).finally(()=>setAuthReady(true));
  },[]);

  async function loadPeople(accessToken:string){
    const response=await fetch("/api/evaluations",{headers:{Authorization:`Bearer ${accessToken}`}});
    if(response.status===401){window.localStorage.removeItem("psu_admin_token");setToken(null);setAuthError("กรุณาเข้าสู่ระบบอีกครั้ง");return;}
    const data=await response.json();
    if(!response.ok){setMessage(data.error??"โหลดข้อมูลไม่สำเร็จ");return;}
    const loaded:Person[]=data.rows.map((row:any)=>({
      id:row.employee.employee_code||row.employee.id, employeeId:row.employee.id, evaluationId:row.id,
      name:row.employee.full_name, email:row.employee.email, position:row.employee.position,
      score:row.evaluation_score===null?null:Number(row.evaluation_score), raisePercent:Number(row.raise_percent),
      oldSalary:Number(row.old_salary), comments:[row.comment_1,row.comment_2,row.comment_3,row.comment_4,row.comment_5],
      source:row.employee.source_sheet||"Supabase",
    }));
    setPeople(loaded);setSelected(0);setMessage(`โหลดข้อมูลจริงแล้ว ${loaded.length} คน`);
  }

  async function login(e:React.FormEvent){
    e.preventDefault();setAuthError("");
    const base=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if(!base||!key){setAuthError("ยังไม่ได้ตั้งค่า Supabase บน Vercel");return;}
    const response=await fetch(`${base}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:key,"Content-Type":"application/json"},body:JSON.stringify({email:loginEmail,password:loginPassword})});
    const data=await response.json();
    if(!response.ok){setAuthError("อีเมลหรือรหัสผ่านไม่ถูกต้อง");return;}
    window.localStorage.setItem("psu_admin_token",data.access_token);setToken(data.access_token);setAuthReady(true);await loadPeople(data.access_token);
  }

  async function saveCurrent(){
    if(!token||!current.employeeId||!current.evaluationId){setMessage("รายการนี้ยังไม่ได้เชื่อมกับฐานข้อมูล");return;}
    setSaving(true);setMessage("");
    const response=await fetch("/api/evaluations",{method:"PATCH",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({...current})});
    const data=await response.json();setSaving(false);
    setMessage(response.ok?`บันทึกข้อมูลของ ${current.name} แล้ว`:data.error??"บันทึกไม่สำเร็จ");
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
        email:String(pick(r,keys.email)??"").trim(), position:String(pick(r,keys.position)??""),
        score:pick(r,keys.score)===""||pick(r,keys.score)==null?null:num(pick(r,keys.score)),
        raisePercent:num(pick(r,keys.raise)), oldSalary:num(pick(r,keys.old)),
        comments:keys.comments.map(names=>String(pick(r,names)??"").trim()), source:String(r.__sheet??"")
      }));
      if(!imported.length) throw new Error("ไม่พบตารางบุคลากรในรูปแบบที่รองรับ");
      const unique=imported.filter((p,i,a)=>a.findIndex(x=>x.email&&x.email===p.email)>=i || !p.email);
      setPeople(existing=>{
        const next=[...existing];
        for(const importedPerson of unique){
          const index=next.findIndex(person=>(importedPerson.email&&person.email.toLowerCase()===importedPerson.email.toLowerCase())||person.name.trim()===importedPerson.name.trim());
          if(index>=0){const saved=next[index];next[index]={...saved,...importedPerson,id:saved.id,employeeId:saved.employeeId,evaluationId:saved.evaluationId};}
          else next.push(importedPerson);
        }
        return next;
      }); setSelected(0); setStep("review"); setMessage(`นำเข้าสำเร็จ ${unique.length} คน จาก ${wb.SheetNames.length} ชีต`);
    } catch (e) { setMessage(e instanceof Error?e.message:"อ่านไฟล์ไม่สำเร็จ"); }
  }

  function update(patch:Partial<Person>){setPeople(list=>list.map((p,i)=>i===selected?{...p,...patch}:p));}
  function updateComment(i:number,value:string){const comments=[...current.comments];comments[i]=value;update({comments});}
  const ready=people.length-errors.length;

  if(!authReady)return <main className="login-page"><div className="login-card"><h1>กำลังโหลดระบบ</h1><p>กรุณารอสักครู่</p></div></main>;
  if(!token)return <main className="login-page"><form className="login-card" onSubmit={login}><div className="logo">ป</div><h1>เข้าสู่ระบบผู้ดูแล</h1><p>ระบบแจ้งผลประเมินบุคลากร</p><label>อีเมล<input type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} required/></label><label>รหัสผ่าน<input type="password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} required/></label>{authError&&<div className="alert">{authError}</div>}<button className="primary" type="submit">เข้าสู่ระบบ</button></form></main>;

  return <div className="app-shell">
    <header className="topbar"><div className="identity"><div className="logo">ป</div><div><strong>ระบบแจ้งผลประเมินบุคลากร</strong><span>โรงเรียน มอ. วิทยานุสรณ์ สุราษฎร์ธานี</span></div></div><div className="cycle">ปีการศึกษา 2568</div></header>
    <nav className="steps" aria-label="ขั้นตอนทำงาน">
      <button className={step==="import"?"active":""} onClick={()=>setStep("import")}><b>1</b><span>นำเข้า Excel</span></button>
      <button className={step==="review"?"active":""} onClick={()=>setStep("review")}><b>2</b><span>ตรวจและแก้ไข</span></button>
      <button className={step==="report"?"active":""} onClick={()=>setStep("report")}><b>3</b><span>ดูรายงานและส่ง</span></button>
    </nav>
    <main>
      {step==="import"&&<section className="page narrow"><div className="page-title"><div><h1>นำเข้าข้อมูลจาก Excel</h1><p>ใช้ไฟล์รายการปรับเงินเดือนเดิม ระบบจะรวมรายชื่อจากทุกกลุ่มให้โดยอัตโนมัติ</p></div></div>
        <div className="upload-card" onClick={()=>inputRef.current?.click()} onKeyDown={e=>e.key==="Enter"&&inputRef.current?.click()} role="button" tabIndex={0}>
          <div className="upload-icon">↑</div><h2>เลือกไฟล์ Excel</h2><p>รองรับ .xlsx และ .xls ข้อมูลต้นฉบับจะไม่ถูกแก้ไข</p><button className="primary">เลือกไฟล์จากเครื่อง</button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={e=>e.target.files?.[0]&&importExcel(e.target.files[0])}/>
        </div>
        {message&&<div className="message">{message}</div>}
        <div className="safe-note"><strong>ข้อมูลที่ระบบใช้</strong><span>ชื่อ–สกุล · ตำแหน่ง · อีเมล · ผลประเมิน · ร้อยละที่เพิ่ม · เงินเดือนเดิม · ข้อเสนอแนะ 1–5 (ถ้ามี)</span></div>
      </section>}
      {step==="review"&&<section className="page"><div className="page-title"><div><h1>ตรวจและแก้ไขข้อมูล</h1><p>เลือกบุคลากรทางซ้าย แก้ข้อมูลและกรอกข้อเสนอแนะทางขวา</p></div><button className="primary" disabled={errors.length>0} onClick={()=>setStep("report")}>ดูรายงานทั้งหมด</button></div>
        <div className="stats"><div><span>ทั้งหมด</span><strong>{people.length}</strong></div><div><span>พร้อมแล้ว</span><strong>{ready}</strong></div><div className={errors.length?"warning":""}><span>ต้องตรวจ</span><strong>{errors.length}</strong></div></div>
        {message&&<div className="message compact">{message}</div>}
        <div className="workspace"><aside className="person-list"><div className="list-head">รายชื่อบุคลากร</div>{people.map((p,i)=>{const issue=errors.find(x=>x.i===i);return <button key={`${p.id}-${i}`} className={i===selected?"selected":""} onClick={()=>setSelected(i)}><span><strong>{p.name||"ยังไม่มีชื่อ"}</strong><small>{p.position||"ยังไม่มีตำแหน่ง"}</small></span><em className={issue?"bad":"good"}>{issue?issue.items.length:"✓"}</em></button>})}</aside>
          <div className="editor"><div className="editor-head"><div><h2>{current.name||"ข้อมูลบุคลากร"}</h2><p>แหล่งข้อมูล: {current.source}</p></div><span className={errors.find(x=>x.i===selected)?"pill bad":"pill good"}>{errors.find(x=>x.i===selected)?"ข้อมูลยังไม่ครบ":"พร้อมสร้างรายงาน"}</span></div>
            {errors.find(x=>x.i===selected)&&<div className="alert">กรุณาตรวจ: {errors.find(x=>x.i===selected)?.items.join(" · ")}</div>}
            <div className="form-grid"><label>ชื่อ–สกุล<input value={current.name} onChange={e=>update({name:e.target.value})}/></label><label>ตำแหน่ง<input value={current.position} onChange={e=>update({position:e.target.value})}/></label><label>อีเมลผู้รับ<input type="email" value={current.email} onChange={e=>update({email:e.target.value})}/></label><label>ผลประเมิน (%)<input type="number" min="0" max="100" step="0.01" value={current.score??""} onChange={e=>update({score:e.target.value===""?null:Number(e.target.value)})}/></label><label>เงินเดือนเดิม (บาท)<input type="number" min="0" value={current.oldSalary||""} onChange={e=>update({oldSalary:Number(e.target.value)})}/></label><label>ร้อยละที่ปรับขึ้น<input type="number" min="0" step="0.01" value={current.raisePercent} onChange={e=>update({raisePercent:Number(e.target.value)})}/></label></div>
            <div className="calculation"><div><span>เงินเดือนเดิม</span><strong>{current.oldSalary.toLocaleString()} บาท</strong></div><div><span>จำนวนเงินที่เพิ่ม</span><strong>{increase.toLocaleString()} บาท</strong></div><div><span>เงินเดือนใหม่</span><strong>{(current.oldSalary+increase).toLocaleString()} บาท</strong></div></div>
            <div className="comments"><div><h3>ข้อเสนอแนะของงานบุคลากร</h3><p>ไม่บังคับกรอก เพิ่มได้สูงสุด 5 ข้อ</p></div>{Array.from({length:5}).map((_,i)=><label key={i}><span>{i+1}.</span><textarea rows={2} placeholder="ข้อเสนอแนะ (ถ้ามี)" value={current.comments[i]??""} onChange={e=>updateComment(i,e.target.value)}/></label>)}</div>
            <div className="editor-actions"><button className="secondary" disabled={selected===0} onClick={()=>setSelected(Math.max(0,selected-1))}>คนก่อนหน้า</button><button className="primary" disabled={saving} onClick={async()=>{await saveCurrent();if(selected<people.length-1)setSelected(selected+1)}}>{saving?"กำลังบันทึก...":"บันทึกและไปคนถัดไป"}</button></div>
          </div></div>
      </section>}
      {step==="report"&&<section className="page"><div className="page-title"><div><h1>ตรวจรายงานก่อนส่ง</h1><p>ข้อมูลด้านล่างคือข้อมูลที่จะปรากฏใน PDF ของบุคลากร</p></div><button className="secondary" onClick={()=>setStep("review")}>กลับไปแก้ข้อมูล</button></div>
        {errors.length>0?<div className="blocking"><strong>ยังสร้างรายงานทั้งหมดไม่ได้</strong><p>มีข้อมูลที่ต้องตรวจอีก {errors.length} คน กรุณากลับไปแก้ให้ครบ</p><button className="primary" onClick={()=>{setSelected(errors[0].i);setStep("review")}}>ไปยังรายการแรกที่ต้องแก้</button></div>:<div className="report-layout"><aside className="report-nav">{people.map((p,i)=><button key={p.id} onClick={()=>setSelected(i)} className={i===selected?"selected":""}>{p.name}</button>)}</aside><div><article className="paper"><div className="school">โรงเรียน มอ. วิทยานุสรณ์ สุราษฎร์ธานี</div><h2>หนังสือแจ้งผลการประเมินผลการปฏิบัติงาน<br/>และการปรับขึ้นเงินเดือน ปีการศึกษา 2568</h2><dl><dt>ชื่อ–สกุล</dt><dd>{current.name}</dd><dt>ตำแหน่ง</dt><dd>{current.position}</dd><dt>ผลประเมิน</dt><dd>{current.score?.toFixed(2)}%</dd></dl><div className="salary-table"><div>เงินเดือนเดิม</div><div>ร้อยละที่เพิ่ม</div><div>จำนวนเงินที่เพิ่ม</div><div>เงินเดือนใหม่</div><strong>{current.oldSalary.toLocaleString()}</strong><strong>{current.raisePercent.toFixed(2)}%</strong><strong>{increase.toLocaleString()}</strong><strong>{(current.oldSalary+increase).toLocaleString()}</strong></div>{current.comments.some(c=>c.trim())&&<><h3>ข้อเสนอแนะ</h3><ol>{current.comments.filter(c=>c.trim()).map((c,i)=><li key={i}>{c}</li>)}</ol></>}</article><div className="send-panel"><div><strong>พร้อมสร้างรายงาน {people.length} ฉบับ</strong><p>ขั้นส่งอีเมลจริงจะเปิดหลังยืนยันรูปแบบรายงาน</p></div><button className="primary" onClick={()=>setMessage("บันทึกการตรวจรูปแบบแล้ว — ขั้นถัดไปคือเชื่อมการสร้าง PDF และอีเมลจริง")}>ยืนยันรูปแบบรายงาน</button></div>{message&&<div className="message compact">{message}</div>}</div></div>}
      </section>}
    </main>
  </div>;
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./leave.module.css";

type Employee = { id: string; employee_code: string | null; full_name: string; email: string; position: string; personnel_group: string; active: boolean };
type LeaveRow = { id?: string; employeeId: string; sourceRow: number; sourceName: string; usedPreviousTerm1: number; usedPreviousTerm2: number; accumulatedPrevious: number; addedDays: number; previousYearBalance: number; totalDays: number; compensationDays: number; netAccumulatedDays: number; usedCurrentTerm1: number; usedCurrentTerm2: number; remainingDays: number; snapshotName?: string; snapshotEmail?: string; snapshotPosition?: string };
type Delivery = { leave_balance_id: string; status: "queued" | "sending" | "sent" | "failed"; sent_at: string | null; created_at: string; error_message: string | null };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeName = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("th");
const employeeNameAliases = new Map([
  ["นายพงศกร แก้วชลคราม", "นายพงศธร แก้วชลคราม"],
  ["นางสาวสุชานาถ ชูพูล", "นางสาวสุชานาถ ชูพล"],
  ["Mrs. Beulah Lawanin Laranjo", "Mrs. BEULAH LAWANIN"],
  ["นางสาวอนงกรณ์ พูลกลับ", "นางสาวอนงกรณ์ พลูกลับ"],
  ["นางสาวเจษฎา กุฏอินทร์", "นางสาวเจษฎา กุฎอินทร์"],
].map(([source, target]) => [normalizeName(source), normalizeName(target)]));
const numberValue = (value: unknown) => { const number = Number(String(value ?? "").replace(/,/g, "")); return Number.isFinite(number) ? number : 0; };
const dayText = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(2)} วัน`;

export default function LeavePage() {
  const [token, setToken] = useState<string | null>(null);
  const [canEvaluate, setCanEvaluate] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery>>({});
  const [year, setYear] = useState(2569);
  const [fileName, setFileName] = useState("");
  const [step, setStep] = useState<"import" | "review" | "send">("import");
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<"test" | "single" | "all" | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, sent: 0, failed: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function initialize() {
      await Promise.resolve();
      const saved = window.localStorage.getItem("psu_admin_token");
      setToken(saved);
      if (saved) await load(saved, 2569);
    }
    void initialize();
  }, []);

  async function load(accessToken: string, academicYear: number) {
    setLoading(true); setMessage("");
    try {
      const response = await fetch(`/api/leave?year=${academicYear}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const data = await response.json();
      if (response.status === 401) { window.localStorage.removeItem("psu_admin_token"); setToken(null); return; }
      if (!response.ok) throw new Error(data.error ?? "โหลดข้อมูลไม่สำเร็จ");
      setCanEvaluate(Array.isArray(data.permissions) && data.permissions.includes("evaluation"));
      setEmployees(data.employees ?? []);
      const loaded = (data.rows ?? []).map((row: Record<string, unknown>) => ({ id: String(row.id), employeeId: String(row.employee_id), sourceRow: Number(row.source_row), sourceName: String(row.snapshot_full_name), usedPreviousTerm1: Number(row.used_previous_term_1), usedPreviousTerm2: Number(row.used_previous_term_2), accumulatedPrevious: Number(row.accumulated_previous), addedDays: Number(row.added_days), previousYearBalance: Number(row.previous_year_balance), totalDays: Number(row.total_days), compensationDays: Number(row.compensation_days), netAccumulatedDays: Number(row.net_accumulated_days), usedCurrentTerm1: Number(row.used_current_term_1), usedCurrentTerm2: Number(row.used_current_term_2), remainingDays: Number(row.remaining_days), snapshotName: String(row.snapshot_full_name), snapshotEmail: String(row.snapshot_email), snapshotPosition: String(row.snapshot_position) }));
      setRows(loaded); setFileName(data.cycle?.source_file_name ?? "");
      const latest: Record<string, Delivery> = {}; (data.deliveries ?? []).forEach((delivery: Delivery) => { if (!latest[delivery.leave_balance_id]) latest[delivery.leave_balance_id] = delivery; }); setDeliveries(latest);
      if (loaded.length) setStep("send");
    } catch (error) { setMessage(error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"); }
    finally { setLoading(false); }
  }

  async function readExcel(file: File) {
    if (!token) return;
    setLoading(true); setMessage("");
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
      const employeeByName = new Map(employees.map(employee => [normalizeName(employee.full_name), employee]));
      const imported: LeaveRow[] = [];
      for (let index = 3; index < grid.length; index += 1) {
        const cells = grid[index] ?? [];
        const sourceName = String(cells[1] ?? "").replace(/\s+/g, " ").trim();
        if (!sourceName) continue;
        const normalizedSourceName = normalizeName(sourceName);
        const employee = employeeByName.get(employeeNameAliases.get(normalizedSourceName) ?? normalizedSourceName);
        imported.push({ employeeId: employee?.id ?? "", sourceRow: index + 1, sourceName, usedPreviousTerm1: numberValue(cells[2]), usedPreviousTerm2: numberValue(cells[3]), accumulatedPrevious: numberValue(cells[4]), addedDays: numberValue(cells[5]), previousYearBalance: numberValue(cells[6]), totalDays: numberValue(cells[7]), compensationDays: numberValue(cells[8]), netAccumulatedDays: numberValue(cells[9]), usedCurrentTerm1: numberValue(cells[10]), usedCurrentTerm2: numberValue(cells[11]), remainingDays: numberValue(cells[12]) });
      }
      if (!imported.length) throw new Error("ไม่พบข้อมูลบุคลากรในไฟล์");
      setRows(imported); setFileName(file.name); setSelected(0); setStep("review"); setMessage(`อ่านไฟล์แล้ว ${imported.length} คน กรุณาตรวจสอบการจับคู่ก่อนบันทึก`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "อ่านไฟล์ไม่สำเร็จ"); }
    finally { setLoading(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  const issues = useMemo(() => rows.map((row, index) => {
    const employee = employees.find(item => item.id === row.employeeId);
    const errors = [!employee && "ยังไม่ได้จับคู่บุคลากร", row.totalDays !== row.previousYearBalance + row.addedDays && "ยอดวันลารวมไม่ตรง", row.netAccumulatedDays !== row.totalDays - row.compensationDays && "ยอดวันลาสะสมสุทธิไม่ตรง", row.remainingDays !== row.netAccumulatedDays - row.usedCurrentTerm1 - row.usedCurrentTerm2 && "ยอดคงเหลือไม่ตรง"].filter(Boolean) as string[];
    return { index, errors };
  }).filter(item => item.errors.length), [employees, rows]);
  const duplicateEmployeeIds = useMemo(() => { const seen = new Set<string>(); const duplicates = new Set<string>(); rows.forEach(row => { if (!row.employeeId) return; if (seen.has(row.employeeId)) duplicates.add(row.employeeId); seen.add(row.employeeId); }); return duplicates; }, [rows]);
  const ready = issues.length === 0 && duplicateEmployeeIds.size === 0 && rows.length > 0;
  const current = rows[selected];
  const currentEmployee = employees.find(employee => employee.id === current?.employeeId);
  const compensationCount = rows.filter(row => row.compensationDays > 0).length;
  const emailPendingCount = rows.filter(row => {
    const employee = employees.find(item => item.id === row.employeeId);
    return !emailPattern.test(employee?.email ?? row.snapshotEmail ?? "");
  }).length;
  const currentEmail = currentEmployee?.email || current?.snapshotEmail || "";

  async function saveImport() {
    if (!token || !ready) return;
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/leave", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ academicYear: year, fileName, rows }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.issues?.join(" · ") ?? data.error ?? "บันทึกไม่สำเร็จ");
      await load(token, year); setStep("send"); setMessage(`บันทึกข้อมูลวันลาแล้ว ${rows.length} คน`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ"); }
    finally { setLoading(false); }
  }

  async function sendEmails(mode: "test" | "single" | "all") {
    if (!token || !current?.id) return;
    if (mode === "single" && !emailPattern.test(currentEmail)) { setMessage("บุคลากรรายนี้ยังไม่มีอีเมล กรุณาผูกอีเมลก่อนส่ง"); return; }
    if (mode === "all" && emailPendingCount > 0) { setMessage(`ยังส่งทั้งหมดไม่ได้ มีบุคลากร ${emailPendingCount} คนที่รอผูกอีเมล`); return; }
    const targets = mode === "all" ? rows.filter(row => row.id) : [current];
    const wording = mode === "test" ? `ส่งอีเมลทดสอบโดยใช้ข้อมูลของ ${current.sourceName}?` : mode === "single" ? `ยืนยันส่งข้อมูลวันลาให้ ${current.snapshotName ?? current.sourceName}?` : `ยืนยันส่งข้อมูลวันลาให้บุคลากรทั้งหมด ${targets.length} คน?`;
    if (!window.confirm(wording)) return;
    setSending(mode); setProgress({ done: 0, total: targets.length, sent: 0, failed: 0 }); setMessage("");
    let sent = 0; let failed = 0; const requestId = crypto.randomUUID();
    try {
      for (let index = 0; index < targets.length; index += 5) {
        const batch = targets.slice(index, index + 5);
        const response = await fetch("/api/leave/emails", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ requestId, leaveBalanceIds: batch.map(row => row.id), test: mode === "test" }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "ส่งอีเมลไม่สำเร็จ");
        sent += data.results.filter((result: { status: string }) => result.status === "sent" || result.status === "skipped").length; failed += data.results.filter((result: { status: string }) => result.status === "failed").length;
        setProgress({ done: Math.min(index + batch.length, targets.length), total: targets.length, sent, failed });
      }
      setMessage(mode === "test" ? "ส่งอีเมลทดสอบแล้ว" : `ส่งสำเร็จ ${sent} คน${failed ? ` · ไม่สำเร็จ ${failed} คน` : ""}`); await load(token, year); setStep("send");
    } catch (error) { setMessage(error instanceof Error ? error.message : "ส่งอีเมลไม่สำเร็จ"); }
    finally { setSending(null); }
  }

  if (!token) return <main className={styles.center}><section className={styles.login}><h1>กรุณาเข้าสู่ระบบก่อน</h1><p>ใช้บัญชีผู้ดูแลเดียวกับระบบรายงานผลปฏิบัติงาน</p><Link className="primary" href="/">ไปหน้าเข้าสู่ระบบ</Link></section></main>;

  return <div className="app-shell"><header className="topbar"><div className="identity"><div className="logo">PSU</div><div><strong>ระบบแจ้งวันลา</strong><span>งานบุคคล · ข้อมูลเฉพาะบุคคล</span></div></div><div className={styles.headerActions}><label>ปีการศึกษา <input type="number" value={year} onChange={event => setYear(Number(event.target.value))} onBlur={() => void load(token, year)} /></label>{canEvaluate ? <Link className="secondary" href="/">ระบบประเมิน</Link> : null}</div></header>
    <nav className="steps" aria-label="ขั้นตอนทำงาน"><button className={step === "import" ? "active" : ""} onClick={() => setStep("import")}><b>1</b><span>นำเข้า Excel</span></button><button className={step === "review" ? "active" : ""} disabled={!rows.length} onClick={() => setStep("review")}><b>2</b><span>ตรวจสอบข้อมูล</span></button><button className={step === "send" ? "active" : ""} disabled={!rows.some(row => row.id)} onClick={() => setStep("send")}><b>3</b><span>ดูตัวอย่างและส่ง</span></button></nav>
    <main>{step === "import" ? <section className="page narrow"><div className="page-title"><div><h1>นำเข้าข้อมูลวันลา · ปี {year}</h1><p>ระบบอ่านข้อมูลจากชีตแรกและจับคู่กับบุคลากรที่กำลังปฏิบัติงาน</p></div></div><div className={`upload-card ${loading ? "disabled" : ""}`} role="button" tabIndex={0} onClick={() => !loading && inputRef.current?.click()} onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && !loading) inputRef.current?.click(); }}><div className="upload-icon">↑</div><h2>{loading ? "กำลังตรวจข้อมูล..." : "เลือกไฟล์ Excel วันลา"}</h2><p>รองรับไฟล์ .xlsx ตามแบบปีการศึกษา 2569</p><button className="primary" disabled={loading}>เลือกไฟล์</button><input ref={inputRef} hidden type="file" accept=".xlsx,.xls" onChange={event => { const file = event.target.files?.[0]; if (file) void readExcel(file); }} /></div>{rows.some(row => row.id) ? <div className="safe-note"><strong>มีข้อมูลที่บันทึกไว้แล้ว</strong><span>{rows.length} คน · ไฟล์ {fileName || "ไม่ระบุ"}</span><button className="secondary" onClick={() => setStep("send")}>เปิดข้อมูลล่าสุด</button></div> : null}{message ? <div className="message">{message}</div> : null}</section> : null}
      {step === "review" ? <section className="page"><div className="page-title"><div><h1>ตรวจสอบการจับคู่และยอดวันลา</h1><p>ชื่อที่ไม่ตรงกับระบบต้องเลือกบุคลากรด้วยตนเองก่อนบันทึก</p></div><button className="primary" disabled={!ready || loading} onClick={() => void saveImport()}>{loading ? "กำลังบันทึก..." : `ยืนยันบันทึก ${rows.length} คน`}</button></div><div className={styles.stats}><div><span>ทั้งหมด</span><strong>{rows.length}</strong></div><div><span>พร้อมบันทึก</span><strong>{rows.length - issues.length}</strong></div><div className={issues.length || duplicateEmployeeIds.size ? styles.warning : ""}><span>ต้องตรวจ</span><strong>{issues.length + duplicateEmployeeIds.size}</strong></div><div><span>เปลี่ยนเป็นค่าตอบแทน</span><strong>{compensationCount}</strong></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>ชื่อใน Excel</th><th>บุคลากรในระบบ / อีเมล</th><th>คงเหลือปีเดิม</th><th>เพิ่ม</th><th>เปลี่ยนเป็นค่าตอบแทน</th><th>สะสมสุทธิ</th><th>สถานะ</th></tr></thead><tbody>{rows.map((row, index) => { const employee = employees.find(item => item.id === row.employeeId); const rowIssues = issues.find(item => item.index === index)?.errors ?? []; const duplicate = duplicateEmployeeIds.has(row.employeeId); return <tr key={`${row.sourceRow}-${row.sourceName}`} className={rowIssues.length || duplicate ? styles.problemRow : ""}><td><strong>{row.sourceName}</strong><small>แถว {row.sourceRow}</small></td><td><select value={row.employeeId} onChange={event => setRows(currentRows => currentRows.map((item, itemIndex) => itemIndex === index ? { ...item, employeeId: event.target.value } : item))}><option value="">— เลือกบุคลากร —</option>{employees.map(option => <option key={option.id} value={option.id}>{option.full_name} · {option.personnel_group}</option>)}</select><small>{employee?.email || "ยังไม่มีอีเมล"}</small></td><td>{dayText(row.previousYearBalance)}</td><td>{dayText(row.addedDays)}</td><td>{dayText(row.compensationDays)}</td><td><strong>{dayText(row.netAccumulatedDays)}</strong></td><td>{duplicate ? "จับคู่ซ้ำ" : rowIssues.join(", ") || "พร้อม"}</td></tr>; })}</tbody></table></div>{message ? <div className="message">{message}</div> : null}</section> : null}
      {step === "send" && current ? <section className="page"><div className="page-title"><div><h1>ดูตัวอย่างและส่งอีเมล</h1><p>ตรวจข้อมูลรายคนก่อนยืนยันส่งให้บุคลากรทั้งหมด</p></div><div className="report-actions"><button className="secondary" disabled={Boolean(sending)} onClick={() => void sendEmails("test")}>ส่งอีเมลทดสอบ</button><button className="primary" disabled={Boolean(sending)} onClick={() => void sendEmails("all")}>{sending === "all" ? `กำลังส่ง ${progress.done}/${progress.total}` : `ยืนยันและส่งทั้งหมด (${rows.length})`}</button></div></div><div className="report-layout"><aside className="report-nav">{rows.map((row, index) => <button key={row.id} className={index === selected ? "selected" : ""} onClick={() => setSelected(index)}><strong>{row.snapshotName ?? row.sourceName}</strong><small className={styles.listMeta}>{deliveries[row.id ?? ""]?.status === "sent" ? "ส่งแล้ว" : deliveries[row.id ?? ""]?.status === "failed" ? "ส่งไม่สำเร็จ" : dayText(row.remainingDays)}</small></button>)}</aside><div><article className={`paper ${styles.paper}`}><div className="school">โรงเรียน มอ. วิทยานุสรณ์ สุราษฎร์ธานี</div><h2>แจ้งยอดวันลาสะสม<br />ปีการศึกษา {year}</h2><dl><dt>ชื่อ–สกุล</dt><dd>{current.snapshotName ?? currentEmployee?.full_name ?? current.sourceName}</dd><dt>ตำแหน่ง</dt><dd>{current.snapshotPosition ?? currentEmployee?.position}</dd><dt>อีเมล</dt><dd>{current.snapshotEmail ?? currentEmployee?.email}</dd></dl><div className={styles.leaveGrid}>{[["วันลาคงเหลือจากปีเดิม", current.previousYearBalance], ["วันลาที่ได้รับเพิ่ม", current.addedDays], ["วันลารวม", current.totalDays], ["เปลี่ยนเป็นค่าตอบแทน", current.compensationDays], ["วันลาสะสมสุทธิ", current.netAccumulatedDays], ["วันลาคงเหลือปัจจุบัน", current.remainingDays]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{dayText(Number(value))}</strong></div>)}</div><p className={styles.confidential}>ข้อมูลเฉพาะบุคคล กรุณาอย่าส่งต่อหรือเผยแพร่ให้บุคคลอื่น</p></article><div className="send-panel"><div><strong>{current.snapshotName ?? current.sourceName}</strong><p>{deliveries[current.id ?? ""]?.status === "sent" ? `ส่งล่าสุด ${new Date(deliveries[current.id ?? ""].sent_at ?? deliveries[current.id ?? ""].created_at).toLocaleString("th-TH")}` : deliveries[current.id ?? ""]?.error_message ?? "ยังไม่เคยส่ง"}</p></div><button className="secondary" disabled={Boolean(sending)} onClick={() => void sendEmails("single")}>ส่งอีเมลรายคน</button></div>{sending ? <div className={styles.progress}><strong>กำลังส่งอีเมล กรุณาอย่าปิดหน้านี้</strong><p>ดำเนินการแล้ว {progress.done}/{progress.total} · สำเร็จ {progress.sent} · ไม่สำเร็จ {progress.failed}</p><progress max={progress.total || 1} value={progress.done} /></div> : null}{message ? <div className="message compact">{message}</div> : null}</div></div></section> : null}
    </main></div>;
}

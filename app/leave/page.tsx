"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./leave.module.css";

type Employee = { id: string; email: string };
type Row = { id: string; employeeId: string; sourceRow: number; name: string; email: string; position: string; previous: number; added: number; total: number; compensation: number; net: number; used1: number; used2: number; remaining: number };
type Delivery = { leave_balance_id: string; status: "queued" | "sending" | "sent" | "failed"; sent_at: string | null; created_at: string; error_message: string | null };
type Filter = "all" | "ready" | "pending" | "sent" | "failed";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const day = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(2)} วัน`;
const rowStatus = (row: Row, deliveries: Record<string, Delivery>): Filter => {
  const delivery = deliveries[row.id];
  if (delivery?.status === "sent") return "sent";
  if (delivery?.status === "failed") return "failed";
  return emailPattern.test(row.email) ? "ready" : "pending";
};

export default function LeavePage() {
  const [token, setToken] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery>>({});
  const [permissions, setPermissions] = useState<string[]>([]);
  const [year, setYear] = useState(2569);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [emailDraft, setEmailDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingEmail, setSavingEmail] = useState(false);
  const [sending, setSending] = useState<"test" | "single" | "all" | "retry" | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, sent: 0, failed: 0 });
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function initialize() {
      await Promise.resolve();
      const saved = window.localStorage.getItem("psu_admin_token");
      setToken(saved);
      if (saved) await load(saved, 2569); else setLoading(false);
    }
    void initialize();
  }, []);

  async function load(accessToken: string, academicYear: number) {
    setLoading(true); setMessage("");
    try {
      const response = await fetch(`/api/leave?year=${academicYear}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "โหลดข้อมูลไม่สำเร็จ");
      const employees = new Map(((data.employees ?? []) as Employee[]).map(employee => [employee.id, employee]));
      const loaded: Row[] = (data.rows ?? []).map((item: Record<string, unknown>) => {
        const employee = employees.get(String(item.employee_id));
        return { id: String(item.id), employeeId: String(item.employee_id), sourceRow: Number(item.source_row), name: String(item.snapshot_full_name), email: employee?.email || String(item.snapshot_email || ""), position: String(item.snapshot_position || ""), previous: Number(item.previous_year_balance), added: Number(item.added_days), total: Number(item.total_days), compensation: Number(item.compensation_days), net: Number(item.net_accumulated_days), used1: Number(item.used_current_term_1), used2: Number(item.used_current_term_2), remaining: Number(item.remaining_days) };
      });
      const latest: Record<string, Delivery> = {};
      for (const delivery of (data.deliveries ?? []) as Delivery[]) if (!latest[delivery.leave_balance_id]) latest[delivery.leave_balance_id] = delivery;
      setRows(loaded); setDeliveries(latest); setPermissions(data.permissions ?? []);
      setSelectedId(current => loaded.some(row => row.id === current) ? current : loaded[0]?.id ?? "");
    } catch (error) { setMessage(error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"); }
    finally { setLoading(false); }
  }

  const statusOf = (row: Row) => rowStatus(row, deliveries);

  const counts = useMemo(() => rows.reduce<Record<Filter, number>>((value, row) => {
    value.all += 1;
    const status: Filter = rowStatus(row, deliveries);
    value[status] += 1; return value;
  }, { all: 0, ready: 0, pending: 0, sent: 0, failed: 0 }), [rows, deliveries]);
  const visible = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("th");
    return rows.filter(row => (filter === "all" || rowStatus(row, deliveries) === filter) && (!text || [row.name, row.email, row.position].some(value => value.toLocaleLowerCase("th").includes(text))));
  }, [rows, deliveries, filter, query]);
  const selected = rows.find(row => row.id === selectedId) ?? visible[0] ?? rows[0];

  useEffect(() => {
    async function syncEmail() { await Promise.resolve(); setEmailDraft(selected?.email ?? ""); }
    void syncEmail();
  }, [selected?.id, selected?.email]);

  async function saveEmail() {
    if (!token || !selected) return;
    setSavingEmail(true); setMessage("");
    try {
      const response = await fetch("/api/leave/employees", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: selected.employeeId, email: emailDraft }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "บันทึกอีเมลไม่สำเร็จ");
      setRows(current => current.map(row => row.employeeId === selected.employeeId ? { ...row, email: data.employee.email } : row));
      setMessage(`บันทึกอีเมลของ ${selected.name} แล้ว`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "บันทึกอีเมลไม่สำเร็จ"); }
    finally { setSavingEmail(false); }
  }

  async function send(mode: "test" | "single" | "all" | "retry") {
    if (!token || !selected) return;
    const targets = mode === "test" || mode === "single" ? [selected] : rows.filter(row => mode === "retry" ? statusOf(row) === "failed" && emailPattern.test(row.email) : statusOf(row) === "ready");
    if (!targets.length) { setMessage(mode === "retry" ? "ไม่มีรายการที่ต้องลองส่งใหม่" : "ไม่มีรายการที่พร้อมส่ง"); return; }
    const question = mode === "test" ? `ส่งอีเมลทดสอบโดยใช้ข้อมูลของ ${selected.name}?` : mode === "single" ? `ยืนยันส่งข้อมูลวันลาให้ ${selected.name}?` : mode === "retry" ? `ลองส่งใหม่ ${targets.length} รายการ?` : `ยืนยันส่งเฉพาะผู้ที่พร้อม ${targets.length} คน?`;
    if (!window.confirm(question)) return;
    setSending(mode); setProgress({ done: 0, total: targets.length, sent: 0, failed: 0 }); setMessage("");
    let sent = 0; let failed = 0; const requestId = crypto.randomUUID();
    try {
      for (let index = 0; index < targets.length; index += 5) {
        const batch = targets.slice(index, index + 5);
        const response = await fetch("/api/leave/emails", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ requestId, leaveBalanceIds: batch.map(row => row.id), test: mode === "test" }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "ส่งอีเมลไม่สำเร็จ");
        sent += data.results.filter((result: { status: string }) => ["sent", "skipped"].includes(result.status)).length;
        failed += data.results.filter((result: { status: string }) => result.status === "failed").length;
        setProgress({ done: Math.min(index + batch.length, targets.length), total: targets.length, sent, failed });
      }
      setMessage(mode === "test" ? "ส่งอีเมลทดสอบแล้ว" : `ดำเนินการ ${targets.length} คน · สำเร็จ ${sent}${failed ? ` · ไม่สำเร็จ ${failed}` : ""}`);
      await load(token, year);
    } catch (error) { setMessage(error instanceof Error ? error.message : "ส่งอีเมลไม่สำเร็จ"); }
    finally { setSending(null); }
  }

  function signOut() { window.localStorage.removeItem("psu_admin_token"); window.localStorage.removeItem("psu_admin_permissions"); window.location.replace("/"); }
  if (!token && !loading) return <main className={styles.center}><section className={styles.login}><h1>กรุณาเข้าสู่ระบบก่อน</h1><p>ใช้บัญชีผู้ดูแลระบบวันลา</p><Link className="primary" href="/">ไปหน้าเข้าสู่ระบบ</Link></section></main>;

  return <div className={styles.shell}>
    <header className={styles.header}><div className={styles.brand}><div className={styles.logo}>PSU</div><div><strong>ระบบแจ้งวันลา</strong><span>ตรวจสอบข้อมูลก่อนส่งให้บุคลากร</span></div></div><div className={styles.headerActions}><label>ปีการศึกษา <input type="number" value={year} onChange={event => setYear(Number(event.target.value))} onBlur={() => token && void load(token, year)} /></label>{permissions.includes("evaluation") ? <Link className="secondary" href="/">ระบบประเมิน</Link> : null}<button className="secondary" onClick={signOut}>ออกจากระบบ</button></div></header>
    <main className={styles.main}>
      <section className={styles.hero}><div><span>ปีการศึกษา {year}</span><h1>ตรวจสอบความพร้อมก่อนส่งอีเมล</h1><p>เลือกบุคลากร ตรวจรายละเอียด และแก้อีเมลได้ในหน้าเดียว ระบบจะส่งเฉพาะรายการที่พร้อม</p></div><div className={styles.actions}><button className="secondary" disabled={Boolean(sending) || !counts.failed} onClick={() => void send("retry")}>ลองส่งที่ล้มเหลว ({counts.failed})</button><button className="primary" disabled={Boolean(sending) || !counts.ready} onClick={() => void send("all")}>{sending === "all" ? `กำลังส่ง ${progress.done}/${progress.total}` : `ส่งรายการพร้อม (${counts.ready})`}</button></div></section>
      <section className={styles.stats}>{([['all','ทั้งหมด'],['ready','พร้อมส่ง'],['pending','รออีเมล'],['sent','ส่งแล้ว'],['failed','ส่งไม่สำเร็จ']] as Array<[Filter,string]>).map(([key,label]) => <button key={key} className={filter === key ? styles.active : ""} onClick={() => setFilter(key)}><span>{label}</span><strong>{counts[key]}</strong></button>)}</section>
      <section className={styles.toolbar}><label><span>ค้นหาบุคลากร</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ชื่อ อีเมล หรือตำแหน่ง" /></label><div><span>แสดง {visible.length} จาก {rows.length} คน</span><button className="secondary" disabled={loading} onClick={() => token && void load(token, year)}>{loading ? "กำลังโหลด..." : "รีเฟรช"}</button></div></section>
      {message ? <div className={styles.message}>{message}</div> : null}
      {loading ? <div className={styles.empty}>กำลังโหลดข้อมูลวันลา...</div> : !selected ? <div className={styles.empty}>ไม่พบข้อมูล</div> : <section className={styles.workspace}>
        <aside className={styles.people}><div className={styles.listTitle}><strong>รายชื่อบุคลากร</strong><span>{visible.length} คน</span></div>{visible.map(row => { const status = statusOf(row); return <button key={row.id} className={selected.id === row.id ? styles.selected : ""} onClick={() => setSelectedId(row.id)}><span><strong>{row.name}</strong><small>{row.position || "ไม่ระบุตำแหน่ง"}</small></span><em className={styles[status]}>{status === "ready" ? "พร้อม" : status === "pending" ? "รออีเมล" : status === "sent" ? "ส่งแล้ว" : "ผิดพลาด"}</em></button>; })}{!visible.length ? <div className={styles.noResults}>ไม่พบรายชื่อ<br /><button onClick={() => { setQuery(""); setFilter("all"); }}>ล้างตัวกรอง</button></div> : null}</aside>
        <article className={styles.detail}>
          <div className={styles.detailHead}><div><small>ข้อมูลจาก Excel แถว {selected.sourceRow}</small><h2>{selected.name}</h2><p>{selected.position || "ยังไม่ระบุตำแหน่ง"}</p></div><span className={`${styles.badge} ${styles[statusOf(selected)]}`}>{statusOf(selected) === "ready" ? "พร้อมส่ง" : statusOf(selected) === "pending" ? "รอผูกอีเมล" : statusOf(selected) === "sent" ? "ส่งแล้ว" : "ส่งไม่สำเร็จ"}</span></div>
          <section className={styles.emailCard}><div><h3>อีเมลผู้รับ</h3><p>แก้ไขแล้วบันทึกกลับไปยังข้อมูลบุคลากรได้ทันที</p></div><div className={styles.emailForm}><input type="email" value={emailDraft} onChange={event => setEmailDraft(event.target.value)} placeholder="name@psuwitsurat.ac.th" /><button className="secondary" disabled={savingEmail || !emailPattern.test(emailDraft) || emailDraft === selected.email} onClick={() => void saveEmail()}>{savingEmail ? "กำลังบันทึก..." : "บันทึกอีเมล"}</button></div>{!emailPattern.test(selected.email) ? <strong className={styles.warning}>ยังส่งไม่ได้ — กรุณาผูกอีเมลก่อน</strong> : null}</section>
          <div className={styles.highlights}><div><span>คงเหลือปัจจุบัน</span><strong>{day(selected.remaining)}</strong></div><div><span>เปลี่ยนเป็นค่าตอบแทน</span><strong>{day(selected.compensation)}</strong></div><div><span>สะสมสุทธิ</span><strong>{day(selected.net)}</strong></div></div>
          <section className={styles.breakdown}><h3>รายละเอียดการคำนวณ</h3><div>{[["คงเหลือจากปีเดิม",selected.previous],["ได้รับเพิ่ม",selected.added],["วันลารวม",selected.total],["ใช้ภาคเรียนที่ 1",selected.used1],["ใช้ภาคเรียนที่ 2",selected.used2],["คงเหลือปัจจุบัน",selected.remaining]].map(([label,value]) => <div key={String(label)}><span>{label}</span><strong>{day(Number(value))}</strong></div>)}</div></section>
          <div className={styles.sendPanel}><div><strong>{deliveries[selected.id]?.status === "sent" ? "ส่งอีเมลแล้ว" : deliveries[selected.id]?.status === "failed" ? "ครั้งล่าสุดส่งไม่สำเร็จ" : "ยังไม่เคยส่ง"}</strong><p>{deliveries[selected.id]?.status === "sent" ? new Date(deliveries[selected.id].sent_at || deliveries[selected.id].created_at).toLocaleString("th-TH") : deliveries[selected.id]?.error_message || "แนะนำให้ส่งทดสอบก่อนส่งจริง"}</p></div><div className={styles.actions}><button className="secondary" disabled={Boolean(sending)} onClick={() => void send("test")}>ส่งทดสอบ</button><button className="primary" disabled={Boolean(sending) || !emailPattern.test(selected.email)} onClick={() => void send("single")}>{sending === "single" ? "กำลังส่ง..." : "ส่งให้คนนี้"}</button></div></div>
          {sending ? <div className={styles.progress}><strong>กำลังส่ง กรุณาอย่าปิดหน้านี้</strong><span>{progress.done}/{progress.total} · สำเร็จ {progress.sent} · ไม่สำเร็จ {progress.failed}</span><progress max={progress.total || 1} value={progress.done} /></div> : null}
        </article>
      </section>}
    </main>
  </div>;
}

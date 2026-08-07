import nodemailer from "nodemailer";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function emailConfig() {
  const email = required("GOOGLE_WORKSPACE_EMAIL").toLowerCase();
  const appPassword = required("GOOGLE_WORKSPACE_APP_PASSWORD").replace(/\s+/g, "");
  return {
    email,
    appPassword,
    fromName: process.env.EMAIL_FROM_NAME?.trim() || "งานบุคลากร โรงเรียน มอ. วิทยานุสรณ์ สุราษฎร์ธานี",
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || email,
  };
}

export function isEmailConfigured() {
  return Boolean(process.env.GOOGLE_WORKSPACE_EMAIL?.trim() && process.env.GOOGLE_WORKSPACE_APP_PASSWORD?.trim());
}

export function workspaceTransporter() {
  const config = emailConfig();
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: config.email, pass: config.appPassword },
    pool: true,
    maxConnections: 1,
    maxMessages: 20,
  });
  return { transporter, config };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

export function personnelEmailHtml(fullName: string, academicYear: number) {
  const safeName = escapeHtml(fullName);
  return `<!doctype html><html lang="th"><body style="margin:0;background:#f4f6f4;font-family:Arial,'Noto Sans Thai',sans-serif;color:#1c2a21"><div style="max-width:620px;margin:0 auto;padding:28px 16px"><div style="background:#fff;border:1px solid #dfe7e1;border-radius:12px;padding:28px"><h1 style="font-size:20px;margin:0 0 18px">แจ้งผลการประเมินและการปรับขึ้นเงินเดือน</h1><p>เรียน ${safeName}</p><p>งานบุคลากรขอแจ้งผลการประเมินผลการปฏิบัติงานและการปรับขึ้นเงินเดือน ปีการศึกษา ${academicYear} โดยมีรายละเอียดตามเอกสาร PDF ที่แนบมากับอีเมลฉบับนี้</p><p style="background:#fff4e5;border-left:4px solid #c77c00;padding:12px 14px"><strong>เอกสารลับเฉพาะบุคคล</strong><br>กรุณาอย่าส่งต่อหรือเผยแพร่เอกสารแนบให้บุคคลอื่น</p><p>หากมีข้อสงสัย กรุณาติดต่อกลับที่งานบุคลากรของโรงเรียน</p><p style="margin-top:26px">ขอแสดงความนับถือ<br><strong>งานบุคลากร<br>โรงเรียน มอ. วิทยานุสรณ์ สุราษฎร์ธานี</strong></p></div></div></body></html>`;
}

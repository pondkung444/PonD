function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

const days = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(2);

export type LeaveEmailData = {
  fullName: string; position: string; academicYear: number; asOfDate: string;
  previousYearBalance: number; addedDays: number; totalDays: number; compensationDays: number;
  netAccumulatedDays: number; usedCurrentTerm1: number; usedCurrentTerm2: number; remainingDays: number;
};

export function leaveEmailHtml(data: LeaveEmailData) {
  const rows = [
    ["วันลาคงเหลือจากปีการศึกษาก่อน", data.previousYearBalance],
    ["วันลาที่ได้รับเพิ่ม", data.addedDays],
    ["วันลารวมก่อนเปลี่ยนเป็นค่าตอบแทน", data.totalDays],
    ["วันลาที่โรงเรียนขอเปลี่ยนเป็นค่าตอบแทน", data.compensationDays],
    ["วันลาสะสมสุทธิ ณ วันที่แจ้ง", data.netAccumulatedDays],
    ["ใช้วันลา ภาคเรียนที่ 1", data.usedCurrentTerm1],
    ["ใช้วันลา ภาคเรียนที่ 2", data.usedCurrentTerm2],
    ["วันลาคงเหลือ", data.remainingDays],
  ];
  const table = rows.map(([label, value]) => `<tr><td style="padding:10px;border-bottom:1px solid #e2e8e4">${label}</td><td style="padding:10px;border-bottom:1px solid #e2e8e4;text-align:right;font-weight:700">${days(Number(value))} วัน</td></tr>`).join("");
  return `<!doctype html><html lang="th"><body style="margin:0;background:#f4f6f4;font-family:Arial,'Noto Sans Thai',sans-serif;color:#1c2a21"><div style="max-width:640px;margin:0 auto;padding:28px 16px"><div style="background:#fff;border:1px solid #dfe7e1;border-radius:12px;padding:28px"><h1 style="font-size:20px;margin:0 0 18px">แจ้งยอดวันลาสะสม ปีการศึกษา ${data.academicYear}</h1><p>เรียน ${escapeHtml(data.fullName)}</p><p>${escapeHtml(data.position)}</p><p>งานบุคคลขอแจ้งยอดวันลาสะสมและวันลาที่โรงเรียนขอเปลี่ยนเป็นค่าตอบแทน โดยมีรายละเอียดดังนี้</p><table style="width:100%;border-collapse:collapse;margin:20px 0">${table}</table><p style="background:#fff4e5;border-left:4px solid #c77c00;padding:12px 14px"><strong>ข้อมูลเฉพาะบุคคล</strong><br>กรุณาอย่าส่งต่อหรือเผยแพร่ข้อมูลนี้ให้บุคคลอื่น</p><p>หากมีข้อสงสัย กรุณาติดต่อกลับที่งานบุคคล</p><p style="margin-top:26px">ขอแสดงความนับถือ<br><strong>งานบุคคล<br>ส่วนงานบริหารโรงเรียน มอ. วิทยานุสรณ์ สุราษฎร์ธานี</strong></p></div></div></body></html>`;
}

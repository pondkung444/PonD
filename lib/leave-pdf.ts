import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type LeavePdfData = { fullName: string; position: string; academicYear: number; asOfDate: string; previousYearBalance: number; addedDays: number; totalDays: number; compensationDays: number; netAccumulatedDays: number; usedCurrentTerm1: number; usedCurrentTerm2: number; remainingDays: number };
const A4 = { width: 595.28, height: 841.89 };
const days = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(2);
const thaiDate = (value: string) => new Intl.DateTimeFormat("th-TH", { dateStyle: "long" }).format(new Date(`${value}T00:00:00`));
const fit = (font: PDFFont, text: string, max: number, size: number) => { while (size > 9 && font.widthOfTextAtSize(text, size) > max) size -= 0.5; return size; };

export async function createLeaveBalancePdf(data: LeavePdfData) {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([readFile(path.join(process.cwd(), "public/fonts/THSarabunNew.ttf")), readFile(path.join(process.cwd(), "public/fonts/THSarabunNew-Bold.ttf"))]);
  const [regular, bold] = await Promise.all([pdf.embedFont(regularBytes, { subset: true }), pdf.embedFont(boldBytes, { subset: true })]);
  const page = pdf.addPage([A4.width, A4.height]); const left = 58; const right = A4.width - 58; const green = rgb(0.09, 0.33, 0.23); const orange = rgb(0.72, 0.39, 0.04); const ink = rgb(0.10, 0.14, 0.12); const line = rgb(0.82, 0.86, 0.83);
  const center = (text: string, y: number, font = regular, size = 14, color = ink) => page.drawText(text, { x: (A4.width - font.widthOfTextAtSize(text, size)) / 2, y, font, size, color });
  const rightText = (text: string, y: number, font = regular, size = 12) => page.drawText(text, { x: right - font.widthOfTextAtSize(text, size), y, font, size, color: ink });
  page.drawText("โรงเรียน มอ. วิทยานุสรณ์ สุราษฎร์ธานี", { x: left, y: 770, font: bold, size: 17, color: green });
  page.drawText("งานบุคคล · หนังสือแจ้งยอดวันลา", { x: left, y: 748, font: regular, size: 12, color: ink });
  page.drawText("ลับ", { x: right - bold.widthOfTextAtSize("ลับ", 16), y: 770, font: bold, size: 16, color: rgb(0.70, 0.08, 0.05) });
  page.drawLine({ start: { x: left, y: 730 }, end: { x: right, y: 730 }, thickness: 1.2, color: green });
  center(`แจ้งยอดวันลาสะสม ปีการศึกษา ${data.academicYear}`, 688, bold, 18, green); center("และวันที่ลาเปลี่ยนเป็นค่าตอบแทน", 663, bold, 15, ink); rightText(`วันที่แจ้ง ${thaiDate(data.asOfDate)}`, 625, regular, 11);
  page.drawText("เรียน", { x: left, y: 590, font: regular, size: 13, color: ink }); page.drawText(data.fullName, { x: left + 38, y: 590, font: bold, size: fit(bold, data.fullName, 300, 13), color: ink });
  page.drawText(`ตำแหน่ง ${data.position || "ไม่ระบุ"}`, { x: left, y: 568, font: regular, size: 12, color: ink });
  page.drawText("งานบุคคลขอแจ้งรายละเอียดวันลาของท่านตามข้อมูล ณ วันที่แจ้ง ดังนี้", { x: left, y: 535, font: regular, size: 13, color: ink });
  const rows: Array<[string, number]> = [["วันลาคงเหลือจากปีการศึกษาก่อน", data.previousYearBalance], ["วันลาที่ได้รับเพิ่ม", data.addedDays], ["วันลารวม", data.totalDays], ["วันลาที่เปลี่ยนเป็นค่าตอบแทน", data.compensationDays], ["วันลาสะสมสุทธิ", data.netAccumulatedDays], ["ใช้วันลา ภาคเรียนที่ 1", data.usedCurrentTerm1], ["ใช้วันลา ภาคเรียนที่ 2", data.usedCurrentTerm2], ["วันลาคงเหลือปัจจุบัน", data.remainingDays]];
  const x = left; const yTop = 500; const width = right - left; const rowH = 30; page.drawRectangle({ x, y: yTop - rows.length * rowH, width, height: rows.length * rowH, borderColor: line, borderWidth: 1 });
  rows.forEach(([label, value], index) => { const y = yTop - (index + 1) * rowH; if (index % 2 === 0) page.drawRectangle({ x: x + 1, y: y + 1, width: width - 2, height: rowH - 2, color: rgb(0.97, 0.98, 0.97) }); page.drawText(label, { x: x + 14, y: y + 9, font: regular, size: 12, color: ink }); const valueText = `${days(value)} วัน`; page.drawText(valueText, { x: right - 14 - bold.widthOfTextAtSize(valueText, 12), y: y + 9, font: bold, size: 12, color: index === 3 ? orange : ink }); });
  const highlightY = 225; page.drawRectangle({ x, y: highlightY, width, height: 55, color: rgb(0.91, 0.96, 0.93), borderColor: green, borderWidth: 1 }); page.drawText("ยอดที่ควรตรวจสอบ", { x: x + 14, y: highlightY + 33, font: bold, size: 12, color: green }); page.drawText(`คงเหลือปัจจุบัน ${days(data.remainingDays)} วัน`, { x: x + 14, y: highlightY + 13, font: bold, size: 14, color: green }); page.drawText(`เปลี่ยนเป็นค่าตอบแทน ${days(data.compensationDays)} วัน`, { x: right - 14 - bold.widthOfTextAtSize(`เปลี่ยนเป็นค่าตอบแทน ${days(data.compensationDays)} วัน`, 12), y: highlightY + 16, font: bold, size: 12, color: orange });
  page.drawText("เอกสารนี้มีข้อมูลเฉพาะบุคคล กรุณาเก็บรักษาและอย่าส่งต่อหรือเผยแพร่", { x, y: 170, font: bold, size: 12, color: rgb(0.62, 0.18, 0.12) }); center("หากมีข้อสงสัย กรุณาติดต่อ งานบุคคล โรงเรียน มอ. วิทยานุสรณ์ สุราษฎร์ธานี", 130, regular, 11, ink); center("ลับ", 42, bold, 16, rgb(0.70, 0.08, 0.05));
  pdf.setTitle(`แจ้งยอดวันลา - ${data.fullName}`); pdf.setAuthor("งานบุคคล โรงเรียน มอ. วิทยานุสรณ์ สุราษฎร์ธานี"); pdf.setSubject(`ยอดวันลา ปีการศึกษา ${data.academicYear}`);
  return pdf.save();
}

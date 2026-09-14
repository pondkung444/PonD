import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type PersonnelReportData = {
  academicYear: number;
  fullName: string;
  position: string;
  nationalId: string;
  bankAccount: string;
  evaluationScore: number | null;
  oldSalary: number;
  raisePercent: number | null;
  salaryIncrease: number | null;
  currentSalary: number | null;
  comments: string[];
  note: string;
  issuedAt?: Date;
};

const A4 = { width: 595.28, height: 841.89 };
const black = rgb(0, 0, 0);
const confidentialRed = rgb(0.75, 0, 0);
let assetBytesPromise: Promise<{ regularBytes: Buffer; boldBytes: Buffer; logoBytes: Buffer }> | null = null;

function money(value: number) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(value);
}

function thaiDate(value: Date) {
  const months = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  return `${value.getDate()} ${months[value.getMonth()]} ${value.getFullYear() + 543}`;
}

function centeredX(font: PDFFont, text: string, size: number, width = A4.width) {
  return (width - font.widthOfTextAtSize(text, size)) / 2;
}

function drawCentered(page: PDFPage, font: PDFFont, text: string, y: number, size: number, color = black) {
  page.drawText(text, { x: centeredX(font, text, size), y, size, font, color });
}

function drawRight(page: PDFPage, font: PDFFont, text: string, right: number, y: number, size: number) {
  page.drawText(text, { x: right - font.widthOfTextAtSize(text, size), y, size, font, color: black });
}

function fitSize(font: PDFFont, text: string, maxWidth: number, preferred: number, minimum = 11) {
  let size = preferred;
  while (size > minimum && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return size;
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function drawField(page: PDFPage, regular: PDFFont, bold: PDFFont, label: string, value: string, y: number) {
  const labelX = 70;
  const valueX = 325;
  const labelSize = fitSize(bold, label, valueX - labelX - 8, 10, 8);
  page.drawText(label, { x: labelX, y, size: labelSize, font: bold, color: black });
  const safe = value.trim() || "-";
  const size = fitSize(regular, safe, 198, 10);
  page.drawText(safe, { x: valueX, y, size, font: regular, color: black });
}

function drawSalaryTable(page: PDFPage, regular: PDFFont, bold: PDFFont, values: string[]) {
  const x = 70;
  const y = 293;
  const width = 455;
  const headerHeight = 66;
  const valueHeight = 39;
  const colWidth = width / 4;
  page.drawRectangle({ x, y, width, height: headerHeight + valueHeight, borderColor: black, borderWidth: 0.8 });
  page.drawLine({ start: { x, y: y + valueHeight }, end: { x: x + width, y: y + valueHeight }, thickness: 0.8, color: black });
  for (let index = 1; index < 4; index += 1) {
    const lineX = x + colWidth * index;
    page.drawLine({ start: { x: lineX, y }, end: { x: lineX, y: y + headerHeight + valueHeight }, thickness: 0.8, color: black });
  }
  const headers = [
    ["เงินเดือนเดิม", "(บาท)"],
    ["ปรับขึ้นเงินเดือน", "(ร้อยละที่เพิ่มขึ้น)"],
    ["จำนวนเงินที่ได้เพิ่ม", "(บาท)"],
    ["เงินเดือนปัจจุบัน", "(บาท)"],
  ];
  headers.forEach((lines, index) => {
    lines.forEach((line, lineIndex) => {
      const size = lineIndex === 0 ? 8.5 : 8;
      const center = x + colWidth * index + colWidth / 2;
      page.drawText(line, { x: center - bold.widthOfTextAtSize(line, size) / 2, y: y + valueHeight + 38 - lineIndex * 18, size, font: bold, color: black });
    });
    const value = values[index];
    const size = fitSize(bold, value, colWidth - 8, 10);
    const center = x + colWidth * index + colWidth / 2;
    page.drawText(value, { x: center - bold.widthOfTextAtSize(value, size) / 2, y: y + 14, size, font: bold, color: black });
  });
}

async function loadAssets(pdf: PDFDocument) {
  if (!assetBytesPromise) {
    const root = process.cwd();
    assetBytesPromise = Promise.all([
      readFile(path.join(root, "public", "fonts", "THSarabunNew.ttf")),
      readFile(path.join(root, "public", "fonts", "THSarabunNew-Bold.ttf")),
      readFile(path.join(root, "public", "school-logo.png")),
    ]).then(([regularBytes, boldBytes, logoBytes]) => ({ regularBytes, boldBytes, logoBytes }));
  }
  const { regularBytes, boldBytes, logoBytes } = await assetBytesPromise;
  const [regular, bold, logo] = await Promise.all([
    pdf.embedFont(regularBytes, { subset: true }),
    pdf.embedFont(boldBytes, { subset: true }),
    pdf.embedPng(logoBytes),
  ]);
  return { regular, bold, logo };
}

function drawHeader(page: PDFPage, regular: PDFFont, bold: PDFFont, logo: PDFImage) {
  page.drawImage(logo, { x: 70, y: 705, width: 78, height: 78 });
  const headerLines = [
    "โรงเรียน มอ. วิทยานุสรณ์ สุราษฎร์ธานี",
    "31 หมู่ที่ 6 ซอยพิเศษ ถนนสุราษฎร์ธานี - นาสาร ตำบลขุนทะเล",
    "อำเภอเมืองสุราษฎร์ธานี จังหวัดสุราษฎร์ธานี 84000",
    "โทรศัพท์ 084-5579229",
  ];
  headerLines.forEach((line, index) => page.drawText(line, { x: 166, y: 769 - index * 15, size: 10, font: regular, color: black }));
  drawCentered(page, bold, "ลับ", 680, 16, confidentialRed);
  drawCentered(page, bold, "หนังสือแจ้งผลการประเมินผลการปฏิบัติงานและการปรับขึ้นเงินเดือน", 650, 12.5);
}

function drawCommentsAndNote(page: PDFPage, regular: PDFFont, comments: string[], note: string) {
  const present = comments.map(value => value.trim()).filter(Boolean);
  let y = 265;
  if (present.length) {
    page.drawText("ข้อเสนอแนะ :", { x: 70, y, size: 11, font: regular, color: black });
    y -= 25;
    present.forEach((comment, index) => {
      const lines = wrapText(regular, comment, 10, 420);
      page.drawText(`${index + 1}.`, { x: 88, y, size: 10, font: regular, color: black });
      lines.forEach((line, lineIndex) => {
        page.drawText(line, { x: 108, y: y - lineIndex * 14, size: 10, font: regular, color: black });
      });
      y -= Math.max(1, lines.length) * 14 + 7;
    });
  }
  const presentNote = note.trim();
  if (!presentNote) return;
  page.drawText("หมายเหตุ :", { x: 70, y, size: 11, font: regular, color: black });
  const lines = wrapText(regular, presentNote, 10, 420);
  lines.forEach((line, lineIndex) => {
    page.drawText(line, { x: 108, y: y - 21 - lineIndex * 14, size: 10, font: regular, color: black });
  });
}

export async function createPersonnelReportPdf(data: PersonnelReportData) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const page = pdf.addPage([A4.width, A4.height]);
  const { regular, bold, logo } = await loadAssets(pdf);
  const issuedAt = data.issuedAt ?? new Date();

  pdf.setTitle(`หนังสือแจ้งผลประเมิน - ${data.fullName}`);
  pdf.setAuthor("โรงเรียน มอ. วิทยานุสรณ์ สุราษฎร์ธานี");
  pdf.setSubject(`ผลการประเมินและการปรับขึ้นเงินเดือน ปีการศึกษา ${data.academicYear}`);
  pdf.setCreationDate(issuedAt);

  drawHeader(page, regular, bold, logo);
  drawCentered(page, bold, `ปีการศึกษา ${data.academicYear}`, 628, 12.5);
  drawRight(page, regular, `วันที่/Date: ${thaiDate(issuedAt)}`, 525, 576, 10);
  drawField(page, regular, bold, "เลขประจำตัวประชาชน/ผู้เสียภาษี/ID number :", data.nationalId, 530);
  drawField(page, regular, bold, "ชื่อ - สกุล/Name-Surname :", data.fullName, 507);
  drawField(page, regular, bold, "ตำแหน่ง/Position :", data.position, 484);
  drawField(page, regular, bold, "เข้าบัญชีธนาคารไทยพาณิชย์ เลขที่/Bank Account No. :", data.bankAccount, 461);
  page.drawText("ผลประเมินการปฏิบัติงานบุคลากร :", { x: 70, y: 435, size: 10, font: bold, color: black });
  page.drawText(`ตั้งแต่วันที่ 1 พฤษภาคม ${data.academicYear} - 30 เมษายน ${data.academicYear + 1}`, { x: 325, y: 435, size: 10, font: regular, color: black });
  const score = data.evaluationScore === null ? "-" : data.evaluationScore.toFixed(2);
  page.drawText(`ผลประเมิน(%) ${score}`, { x: 325, y: 414, size: 10, font: regular, color: black });
  drawSalaryTable(page, regular, bold, [money(data.oldSalary), data.raisePercent === null ? "-" : data.raisePercent.toFixed(2), data.salaryIncrease === null ? "-" : money(data.salaryIncrease), data.currentSalary === null ? "-" : money(data.currentSalary)]);
  drawCommentsAndNote(page, regular, data.comments, data.note);
  drawCentered(page, bold, "ลับ", 18, 16, confidentialRed);

  return pdf.save();
}

import fs from "node:fs/promises";
import { createPersonnelReportPdf } from "../lib/report-pdf.ts";

const outputDir = "tmp/pdfs";
await fs.mkdir(outputDir, { recursive: true });
const base = {
  academicYear: 2568,
  fullName: "นายทดสอบ ระบบ",
  position: "เจ้าหน้าที่ทดสอบ",
  nationalId: "1-2345-67890-12-3",
  bankAccount: "123-4-56789-0",
  evaluationScore: 90,
  oldSalary: 20000,
  raisePercent: 4,
  salaryIncrease: 800,
  currentSalary: 20800,
  comments: [],
  issuedAt: new Date("2026-08-11T00:00:00.000Z"),
};
await fs.writeFile(`${outputDir}/without-note.pdf`, await createPersonnelReportPdf({ ...base, note: "" }));
await fs.writeFile(`${outputDir}/with-note.pdf`, await createPersonnelReportPdf({ ...base, note: "ต้องปฏิบัติงานไม่น้อยกว่า 8 เดือนนับจากวันเข้าปฏิบัติงานจนถึงวันที่ 30 เมษายนของปีถัดไป หากปฏิบัติงานไม่ครบจะพิจารณาในปีถัดไป (นับวันที่ 1 พฤษภาคม 2568 - 30 เมษายน 2569)" }));
await fs.writeFile(`${outputDir}/with-comments-and-note.pdf`, await createPersonnelReportPdf({
  ...base,
  comments: Array.from({ length: 5 }, (_, index) => `ข้อเสนอแนะลำดับที่ ${index + 1} สำหรับตรวจสอบข้อความยาวในรายงานว่าจัดวางได้ครบถ้วนและไม่ทับส่วนท้ายของเอกสาร`),
  note: "หมายเหตุข้อความยาวสำหรับตรวจสอบพื้นที่ท้ายหน้า เมื่อบุคลากรมีทั้งข้อเสนอแนะครบห้าข้อและมีหมายเหตุพร้อมกัน",
}));
await fs.writeFile(`${outputDir}/without-salary-adjustment.pdf`, await createPersonnelReportPdf({
  ...base,
  fullName: "นางสาวปรีดา ชัยพัฒน์",
  oldSalary: 9000,
  raisePercent: null,
  salaryIncrease: null,
  currentSalary: null,
  note: "การปรับขึ้นเงินเดือนต้องปฏิบัติงานไม่น้อยกว่า 8 เดือน",
}));

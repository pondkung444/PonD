import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ระบบแจ้งผลประเมินบุคลากร",
  description: "นำเข้าข้อมูล ตรวจผลประเมิน สร้างรายงาน และเตรียมส่งอีเมลรายบุคคล",
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="th"><body>{children}</body></html>;
}

import process from "node:process";
import { createInterface } from "node:readline/promises";

const email = process.argv[2]?.trim().toLowerCase();
const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!email || !baseUrl || !serviceKey) throw new Error("ข้อมูลบัญชีหรือ Supabase ไม่ครบ");

const prompt = createInterface({ input: process.stdin, output: process.stdout });
const password = await prompt.question("Password: ");
prompt.close();
if (password.length < 8) throw new Error("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};
const usersResponse = await fetch(`${baseUrl}/auth/v1/admin/users?per_page=1000`, { headers });
if (!usersResponse.ok) throw new Error(`อ่านบัญชีไม่สำเร็จ: ${usersResponse.status}`);
const usersPayload = await usersResponse.json();
const existing = usersPayload.users?.find(user => user.email?.toLowerCase() === email);
const body = JSON.stringify({ email, password, email_confirm: true, app_metadata: { permissions: ["leave"] } });
const response = await fetch(existing ? `${baseUrl}/auth/v1/admin/users/${existing.id}` : `${baseUrl}/auth/v1/admin/users`, {
  method: existing ? "PUT" : "POST",
  headers,
  body,
});
if (!response.ok) throw new Error(`สร้างบัญชีไม่สำเร็จ: ${response.status} ${await response.text()}`);
const user = await response.json();
console.log(JSON.stringify({ id: user.id, email: user.email, confirmed: Boolean(user.email_confirmed_at), permissions: user.app_metadata?.permissions }, null, 2));

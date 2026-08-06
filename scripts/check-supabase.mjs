import fs from "node:fs";

function loadEnv(path) {
  const env = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) continue;
    const i = clean.indexOf("=");
    if (i > 0) env[clean.slice(0, i)] = clean.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnv(new URL("../.env.local", import.meta.url));
const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = required.filter((key) => !env[key]);
if (missing.length) {
  console.log(JSON.stringify({ ready: false, missing }));
  process.exit(1);
}

const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
let host = "invalid";
try { host = new URL(baseUrl).host; } catch {}
const health = await fetch(`${baseUrl}/auth/v1/health`);
const response = await fetch(`${baseUrl}/rest/v1/`, {
  headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  },
});
const employees = await fetch(`${baseUrl}/rest/v1/employees?select=id&limit=1`, {
  headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY },
});
const keyType = env.SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_secret_") ? "secret" : env.SUPABASE_SERVICE_ROLE_KEY.startsWith("eyJ") ? "service_role_jwt" : "unknown";
console.log(JSON.stringify({ ready: response.ok, host, health: health.status, status: response.status, keyType, employeesTable: employees.status }));
process.exit(response.ok ? 0 : 2);

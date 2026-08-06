import fs from "node:fs";
function load(path){const out={};for(const line of fs.readFileSync(path,"utf8").split(/\r?\n/)){const s=line.trim();if(!s||s.startsWith("#"))continue;const i=s.indexOf("=");if(i>0)out[s.slice(0,i)]=s.slice(i+1).trim();}return out;}
const env=load(new URL("../.env.local",import.meta.url));
const base=env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/,"");
const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Prefer:"count=exact"};
async function get(path){const r=await fetch(`${base}/rest/v1/${path}`,{headers});if(!r.ok)throw new Error(`${path}: ${r.status}`);return {rows:await r.json(),range:r.headers.get("content-range")};}
const employees=await get("employees?select=id,email,national_id,bank_account");
const cycles=await get("evaluation_cycles?select=id,academic_year&academic_year=eq.2568");
const evaluations=await get("evaluations?select=id,cycle_id");
const counts=new Map();for(const row of employees.rows){const email=String(row.email||"").toLowerCase();if(email)counts.set(email,(counts.get(email)||0)+1);}
const duplicateEmailGroups=[...counts.values()].filter(n=>n>1).length;
console.log(JSON.stringify({employees:employees.rows.length,cycles2568:cycles.rows.length,evaluations:evaluations.rows.length,duplicateEmailGroups,missingNationalId:employees.rows.filter(r=>!r.national_id).length,missingBankAccount:employees.rows.filter(r=>!r.bank_account).length}));

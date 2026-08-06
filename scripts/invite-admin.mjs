import fs from "node:fs";
function load(path){const out={};for(const line of fs.readFileSync(path,"utf8").split(/\r?\n/)){const s=line.trim();if(!s||s.startsWith("#"))continue;const i=s.indexOf("=");if(i>0)out[s.slice(0,i)]=s.slice(i+1).trim();}return out;}
const env=load(new URL("../.env.local",import.meta.url));
const base=env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/,"");
const secret=env.SUPABASE_SERVICE_ROLE_KEY;
const email="panuwat.pond@gmail.com";
const headers={apikey:secret,Authorization:`Bearer ${secret}`,"Content-Type":"application/json"};
const usersResponse=await fetch(`${base}/auth/v1/admin/users?page=1&per_page=1000`,{headers});
if(!usersResponse.ok)throw new Error(`Unable to check users (${usersResponse.status})`);
const usersBody=await usersResponse.json();
const users=Array.isArray(usersBody)?usersBody:(usersBody.users||[]);
const existing=users.find(user=>String(user.email).toLowerCase()===email);
if(existing){console.log(JSON.stringify({status:"already-exists",email,confirmed:Boolean(existing.email_confirmed_at)}));process.exit(0);}
const response=await fetch(`${base}/auth/v1/invite`,{method:"POST",headers,body:JSON.stringify({email,data:{role:"admin"}})});
if(!response.ok)throw new Error(`Invite failed (${response.status})`);
const user=await response.json();
console.log(JSON.stringify({status:"invited",email:user.email||email,confirmed:Boolean(user.email_confirmed_at)}));

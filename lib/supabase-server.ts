const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function requireEnv() {
  if (!baseUrl || !anonKey || !serviceKey) {
    throw new Error("Supabase environment variables are incomplete");
  }
  return { baseUrl, anonKey, serviceKey };
}

export type AppPermission = "evaluation" | "leave";

export async function requireAdmin(request: Request, requiredPermission: AppPermission = "evaluation") {
  const { baseUrl, anonKey, serviceKey } = requireEnv();
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;

  const userResponse = await fetch(`${baseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
    cache: "no-store",
  });
  if (!userResponse.ok) return null;
  const user = (await userResponse.json()) as { email?: string };
  if (!user.email) return null;

  const adminResponse = await fetch(
    `${baseUrl}/rest/v1/app_admins?select=email,permissions&email=eq.${encodeURIComponent(user.email.toLowerCase())}&active=eq.true&limit=1`,
    { headers: serviceHeaders(serviceKey), cache: "no-store" },
  );
  if (!adminResponse.ok) return null;
  const admins = (await adminResponse.json()) as Array<{ email: string; permissions: AppPermission[] }>;
  const admin = admins[0];
  return admin?.permissions?.includes(requiredPermission)
    ? { email: user.email.toLowerCase(), permissions: admin.permissions }
    : null;
}

export function supabaseConfig() {
  const { baseUrl, serviceKey } = requireEnv();
  return { baseUrl, headers: serviceHeaders(serviceKey) };
}

function serviceHeaders(serviceKey: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

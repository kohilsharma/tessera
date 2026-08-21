import { clearToken, getToken, setToken } from "../auth/token";
import { queryClient } from "../queryClient";

export type HealthResponse = {
  status: "ok" | "error";
  db: "ok" | "error";
  timestamp: string;
};

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/v1/health");
  if (!res.ok) throw new Error(await parseErrorMessage(res, `Health check failed: ${res.status}`));
  return res.json();
}

// Mirrors the role split in backend/src/entities/User.ts: admin is assigned, so
// it is a role a user can hold but never one they can register as. Exported as
// values, not just types, so anything rendering per-role reads the list from here
// instead of re-listing the three roles.
export const REGISTRABLE_ROLES = ["student", "investor"] as const;
export const USER_ROLES = [...REGISTRABLE_ROLES, "admin"] as const;
export type RegistrableRole = (typeof REGISTRABLE_ROLES)[number];
export type UserRole = (typeof USER_ROLES)[number];
export type User = { id: string; email: string; role: UserRole };
export type AuthResponse = { token: string; user: User };

async function postForToken(path: string, body: unknown, fallback: string): Promise<AuthResponse> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, fallback));
  const data: AuthResponse = await res.json();
  setToken(data.token);
  // The cache is keyed by nothing but the query key, so ["me"] and the dashboards
  // would otherwise survive into the next identity: logging in as a second user
  // without reloading would read the first user's role and route by it.
  queryClient.clear();
  return data;
}

export function register(input: {
  email: string;
  password: string;
  role: RegistrableRole;
}): Promise<AuthResponse> {
  return postForToken("/api/v1/auth/register", input, "Registration failed");
}

export function login(input: { email: string; password: string }): Promise<AuthResponse> {
  return postForToken("/api/v1/auth/login", input, "Login failed");
}

export function logout(): void {
  clearToken();
  queryClient.clear();
}

// Attaches the bearer token and, on a 401 (missing, expired, or pointing at a
// deleted user), drops it and sends the user to /login — there is no refresh
// flow to recover a session silently (ADR-0013).
// ponytail: hard navigation, because this runs outside the React tree and has no
// router access; swap for in-SPA <Navigate> once an auth context makes the token
// reactive and RequireAuth can see it change.
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  // new Headers(), not object spread: spreading a Headers instance yields {} and
  // would silently drop a caller's headers.
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    window.location.assign("/login");
  }
  return res;
}

export async function getMe(): Promise<User> {
  const res = await authFetch("/api/v1/auth/me");
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not load current user"));
  return res.json();
}

// ADR-0004: distinct shapes per role, not one endpoint with a lens flag — mirrors
// backend/src/routes/dashboard.ts. studyCollections/watchlist are placeholders
// until #19/#20 add the corpus and owned Briefs these will surface.
// Named *DashboardData, not *Dashboard: the components of that name live in
// src/pages/, and a file importing both a type and its component would collide.
export type StudentDashboardData = { role: "student"; studyCollections: unknown[] };
export type InvestorDashboardData = { role: "investor"; watchlist: unknown[] };
export type AdminDashboardData = { role: "admin"; userCounts: Record<UserRole, number> };

async function getDashboard<T>(path: string): Promise<T> {
  const res = await authFetch(path);
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not load this dashboard"));
  return res.json();
}

export function getStudentDashboard(): Promise<StudentDashboardData> {
  return getDashboard("/api/v1/dashboard/student");
}

export function getInvestorDashboard(): Promise<InvestorDashboardData> {
  return getDashboard("/api/v1/dashboard/investor");
}

export function getAdminDashboard(): Promise<AdminDashboardData> {
  return getDashboard("/api/v1/dashboard/admin");
}

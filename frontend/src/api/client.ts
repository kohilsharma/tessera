import { clearToken, getToken, setToken } from "../auth/token";

export type HealthResponse = {
  status: "ok" | "error";
  db: "ok" | "error";
  timestamp: string;
};

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/v1/health");
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

export type Role = "student" | "investor";
export type User = { id: string; email: string; role: Role | "admin" };
export type AuthResponse = { token: string; user: User };

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export async function register(input: { email: string; password: string; role: Role }): Promise<AuthResponse> {
  const res = await fetch("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Registration failed"));
  const data: AuthResponse = await res.json();
  setToken(data.token);
  return data;
}

export async function login(input: { email: string; password: string }): Promise<AuthResponse> {
  const res = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Login failed"));
  const data: AuthResponse = await res.json();
  setToken(data.token);
  return data;
}

export function logout(): void {
  clearToken();
}

// Wraps fetch for authenticated calls: attaches the bearer token and, on a 401
// (missing/expired/invalid token), clears it and bounces the user to /login —
// the app has no refresh flow to silently recover a session (ADR-0013).
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
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

import { clearToken, getToken, setToken } from "../auth/token";
import { queryClient } from "../queryClient";

export type HealthResponse = {
  status: "ok" | "error";
  db: "ok" | "error";
  timestamp: string;
};

async function parseErrorMessage(res: Response, whenUnreadable: string): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : whenUnreadable;
  } catch {
    return whenUnreadable;
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

async function postForToken(path: string, body: unknown, errorMessage: string): Promise<AuthResponse> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, errorMessage));
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
// backend/src/routes/dashboard.ts.
// Named *DashboardData, not *Dashboard: the components of that name live in
// src/pages/, and a file importing both a type and its component would collide.
export type StudentDashboardData = {
  role: "student";
  studyCollections: { id: string; title: string; category: StoryCategory }[];
};
export type InvestorDashboardData = { role: "investor"; watchlist: unknown[] };
export type AdminDashboardData = { role: "admin"; userCounts: Record<UserRole, number> };

async function getJson<T>(path: string, errorMessage: string): Promise<T> {
  const res = await authFetch(path);
  if (!res.ok) throw new Error(await parseErrorMessage(res, errorMessage));
  return res.json();
}

export function getStudentDashboard(): Promise<StudentDashboardData> {
  return getJson("/api/v1/dashboard/student", "Could not load this dashboard");
}

export function getInvestorDashboard(): Promise<InvestorDashboardData> {
  return getJson("/api/v1/dashboard/investor", "Could not load this dashboard");
}

export function getAdminDashboard(): Promise<AdminDashboardData> {
  return getJson("/api/v1/dashboard/admin", "Could not load this dashboard");
}

// #19: mirrors backend/src/entities/Story.ts's constrained vocabulary.
export const STORY_CATEGORIES = [
  "politics",
  "business",
  "technology",
  "science",
  "health",
  "world",
  "sports",
  "entertainment",
] as const;
export type StoryCategory = (typeof STORY_CATEGORIES)[number];

export function isStoryCategory(value: string): value is StoryCategory {
  return (STORY_CATEGORIES as readonly string[]).includes(value);
}

export type ListEnvelope<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number };

export type StorySummary = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  category: StoryCategory;
  firstSeenAt: string;
  lastSeenAt: string;
  articleCount: number;
};

export type ArticleSummary = {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  analysisTextType: string;
  publisher: { id: string; name: string; domain: string };
};

export type StoryDetail = StorySummary & { articles: ArticleSummary[] };

export type ArticleDetail = {
  id: string;
  title: string;
  url: string;
  // null when the Article's Analysis Text Mode is not ours to redistribute
  // (ADR-0018) — the body is held for analysis but never served.
  analysisText: string | null;
  analysisTextType: string;
  publishedAt: string;
  publisher: { id: string; name: string; domain: string };
  story: { id: string; slug: string; title: string };
};

export type StorySortField = "firstSeenAt" | "title";

export type StoryListParams = {
  page?: number;
  pageSize?: number;
  category?: StoryCategory;
  dateFrom?: string;
  dateTo?: string;
  sort?: `${StorySortField}:asc` | `${StorySortField}:desc`;
};

// Mirrors backend/src/lib/listQuery.ts's shared filter+sort+pagination contract.
export function getStories(params: StoryListParams = {}): Promise<ListEnvelope<StorySummary>> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const suffix = query.toString();
  return getJson(`/api/v1/stories${suffix ? `?${suffix}` : ""}`, "Could not load Stories");
}

export function getStory(id: string): Promise<StoryDetail> {
  return getJson(`/api/v1/stories/${id}`, "Could not load this Story");
}

export function getArticle(id: string): Promise<ArticleDetail> {
  return getJson(`/api/v1/articles/${id}`, "Could not load this Article");
}

// #20: mirrors backend/src/entities/IntelligenceBrief.ts + routes/briefs.ts.
export const DEFAULT_ARTICLE_CAPACITY_LIMIT = 20;

export type BriefSummary = {
  id: string;
  title: string;
  note: string | null;
  category: StoryCategory;
  articleCapacityLimit: number;
  coverImageKey: string | null;
  coverImageUrl: string | null;
  ownerId: string;
  articleCount: number;
  createdAt: string;
  updatedAt: string;
};

export type BriefDetail = BriefSummary & { articles: ArticleSummary[] };

export type BriefSortField = "createdAt" | "updatedAt" | "title";

export type BriefListParams = {
  page?: number;
  pageSize?: number;
  category?: StoryCategory;
  dateFrom?: string;
  dateTo?: string;
  sort?: `${BriefSortField}:asc` | `${BriefSortField}:desc`;
};

export type BriefInput = {
  title: string;
  note?: string | null;
  category: StoryCategory;
  articleCapacityLimit?: number;
};

async function sendJson<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  errorMessage: string,
): Promise<T> {
  const res = await authFetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, errorMessage));
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function getBriefs(params: BriefListParams = {}): Promise<ListEnvelope<BriefSummary>> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const suffix = query.toString();
  return getJson(`/api/v1/briefs${suffix ? `?${suffix}` : ""}`, "Could not load Briefs");
}

export function getBrief(id: string): Promise<BriefDetail> {
  return getJson(`/api/v1/briefs/${id}`, "Could not load this Brief");
}

export function createBrief(input: BriefInput): Promise<BriefSummary> {
  return sendJson("POST", "/api/v1/briefs", input, "Could not create this Brief");
}

export function updateBrief(id: string, input: Partial<BriefInput>): Promise<BriefSummary> {
  return sendJson("PATCH", `/api/v1/briefs/${id}`, input, "Could not update this Brief");
}

export function deleteBrief(id: string): Promise<void> {
  return sendJson("DELETE", `/api/v1/briefs/${id}`, undefined, "Could not delete this Brief");
}

export function attachArticleToBrief(briefId: string, articleId: string): Promise<ArticleSummary> {
  return sendJson("POST", `/api/v1/briefs/${briefId}/articles`, { articleId }, "Could not attach this Article");
}

export function detachArticleFromBrief(briefId: string, articleId: string): Promise<void> {
  return sendJson("DELETE", `/api/v1/briefs/${briefId}/articles/${articleId}`, undefined, "Could not remove this Article");
}

// #21: multipart, so this bypasses sendJson's JSON body/Content-Type entirely
// (the browser sets the multipart boundary on its own when given a FormData).
export async function uploadBriefCoverImage(briefId: string, file: File): Promise<BriefSummary> {
  const body = new FormData();
  body.set("coverImage", file);
  const res = await authFetch(`/api/v1/briefs/${briefId}/cover-image`, { method: "POST", body });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not upload this cover image"));
  return res.json();
}

// The cover image is owner-only, so it comes back from a guarded endpoint that
// needs the bearer token — which an <img src> can't send. Callers fetch the
// bytes here and point the <img> at an object URL instead (see BriefDetail).
export async function fetchBriefCoverImage(coverImageUrl: string): Promise<Blob> {
  const res = await authFetch(coverImageUrl);
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not load this cover image"));
  return res.blob();
}

import { clearToken, getToken, setToken } from "../auth/token";
import { queryClient } from "../queryClient";
import { applyTheme, cancelThemeTransition, readModeHint, transitionTheme, writeModeHint, type ColorMode } from "../theme";

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
// The half of DESIGN.md §3 a reader controls: the role fixes the theme, the
// account carries which of its two modes to wear (#75). The vocabulary itself
// lives in ../theme, beside the code that acts on it.
export type User = { id: string; email: string; role: UserRole; colorMode: ColorMode };
export type AuthResponse = { token: string; user: User };

async function postForToken(path: string, body: unknown, errorMessage: string, animate = false): Promise<AuthResponse> {
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
  // The answer *is* ["me"] — the same User getMe returns — so seeding it spares
  // ThemeSync, IdentityMenu and DashboardRedirect a round trip they each wait on.
  // Account.tsx writes the same key from the same shape after a mode change.
  queryClient.setQueryData(["me"], data.user);
  // Repainted here, at the one seam a session begins, rather than waiting for
  // ThemeSync's refetch: this is the whole "switching accounts visibly switches
  // products" of #75, and the answer already carries both halves of the theme.
  writeModeHint(data.user.colorMode);
  (animate ? transitionTheme : applyTheme)(data.user.role, data.user.colorMode);
  // What loads underneath the sign-in sweep (#78), so the dashboard it resolves
  // onto is already populated. Not awaited, and prefetchQuery swallows its own
  // rejection: the dashboard's useQuery is what reads this, and a failure here
  // must leave it to fetch and report on mount like any other.
  void queryClient.prefetchQuery({
    queryKey: ["dashboard", data.user.role],
    queryFn: DASHBOARD_QUERIES[data.user.role],
  });
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
  return postForToken("/api/v1/auth/login", input, "Login failed", true);
}

export function logout(): void {
  clearToken();
  queryClient.clear();
  cancelThemeTransition();
  // Back to the signed-out theme immediately. The mode hint is kept: it is a
  // fact about this device, and flipping the login page to light behind a reader
  // who chose dark reads as a bug rather than as a sign-out.
  applyTheme(null, readModeHint());
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

// The only field of their own account a reader may set (#75). Returns the whole
// user, so the ["me"] cache the theme reads from can be written from the answer.
export function updateColorMode(colorMode: ColorMode): Promise<User> {
  return sendJson("PATCH", "/api/v1/auth/me", { colorMode }, "Could not save your appearance");
}

// ADR-0004: distinct shapes per role, not one endpoint with a lens flag — mirrors
// backend/src/routes/dashboard.ts.
// Named *DashboardData, not *Dashboard: the components of that name live in
// src/pages/, and a file importing both a type and its component would collide.
export type StudentDashboardData = {
  role: "student";
  studyCollections: { id: string; title: string; category: StoryCategory }[];
  flashcards: StudySummary;
};
export type Sector = { category: StoryCategory; storyCount: number; articleCount: number };
// #56: a Story an Investor can read comparatively — two or more Publishers' accepted,
// citable reporting, which is what the analysis endpoint needs before it will write
// anything. No article count: the members counted for eligibility are a subset of the
// accepted members `/stories` counts, and one word for two facts would be a defect.
export type ComparableStory = {
  id: string;
  title: string;
  category: StoryCategory;
  publisherCount: number;
  lastSeenAt: string;
};
export type InvestorDashboardData = {
  role: "investor";
  sectors: Sector[];
  comparableStories: ComparableStory[];
};

export type ConnectorKind = "gdelt_gkg" | "gdelt_doc" | "rss" | "readability";
export type ConnectorSummary = {
  id: string;
  name: string;
  kind: ConnectorKind;
  endpoint: string;
  enabled: boolean;
};
// #40: mirrors backend/src/entities/Publisher.ts. CONTEXT.md "Terms Class" — the
// per-Publisher rights vocabulary deciding whether text may be served.
export const TERMS_CLASSES = ["open_metadata", "syndicated_excerpt", "internal_only", "licensed"] as const;
export type TermsClass = (typeof TERMS_CLASSES)[number];
export type PublisherSummary = {
  id: string;
  name: string;
  domain: string;
  termsClass: TermsClass;
  articleCount: number;
};

// #39: mirrors backend/src/entities/IngestionRun.ts. CONTEXT.md "IngestionRun" —
// one invocation of one connector, read from Postgres rather than the queue, so
// this panel renders with the worker down (ADR-0024).
export type IngestionRunStatus = "running" | "succeeded" | "failed";
export type IngestionRunSummary = {
  id: string;
  connectorId: string;
  connectorName: string;
  status: IngestionRunStatus;
  startedAt: string;
  completedAt: string | null;
  discovered: number;
  inserted: number;
  enriched: number;
  duplicate: number;
  rejectedByPolicy: number;
  failed: number;
  errorSummary: string | null;
};

// #49: mirrors backend/src/entities/ClusteringRun.ts. CONTEXT.md "Clustering Run"
// — one invocation of the clustering pass, read from Postgres rather than the
// queue, so this register renders with the worker down (ADR-0026).
export type ClusteringRunSummary = {
  id: string;
  // The same three-value vocabulary as an IngestionRun's, deliberately shared
  // rather than restated: both are "a pass that is in flight, finished, or failed".
  status: IngestionRunStatus;
  startedAt: string;
  completedAt: string | null;
  embedded: number;
  considered: number;
  assigned: number;
  // #50: ADR-0026's review band. Its own counter beside assigned and unclustered,
  // because a proposal is neither — it is waiting on an Admin.
  heldForReview: number;
  seeded: number;
  unclustered: number;
  storiesCreated: number;
  errorSummary: string | null;
};

// #66: mirrors backend/src/entities/EntityResolutionRun.ts. CONTEXT.md "Entity
// Resolution Run" — one pass that promoted surface names into Entities and rebuilt
// their cited co-occurrence edges, read from Postgres for the reason the two run
// histories above it are, so this register renders with the worker down.
export type EntityResolutionRunSummary = {
  id: string;
  // The same three-value vocabulary again, shared rather than restated.
  status: IngestionRunStatus;
  startedAt: string;
  completedAt: string | null;
  annotationsRead: number;
  articlesRead: number;
  considered: number;
  promoted: number;
  belowFloor: number;
  demoted: number;
  edgesBuilt: number;
  // #67: what the pass did about names that look like each other — pairs it merged
  // itself above the automatic bar, and pairs it held for review beneath it. Both count
  // pairs, so neither belongs to the `promoted + belowFloor = considered` ledger.
  merged: number;
  proposed: number;
  errorSummary: string | null;
};

// #57: mirrors backend/src/entities/PromptTemplate.ts. CONTEXT.md "PromptTemplate" —
// the versioned prompt + generation params an Admin tunes to shape what every reader
// gets. Four knobs, and deliberately no fifth: the citation validation layer lives
// below the prompt in backend code and is not addressable from this surface (ADR-0021).
// `surfacedClaimTypes` is drawn from CORE_CLAIM_TYPES below, which the analysis register
// already reads — the run's own Lens claim is never optional, so it is not listed.
export type PromptParams = {
  tone: string;
  claimCount: { min: number; max: number };
  lensEmphasis: string;
  surfacedClaimTypes: CoreClaimType[];
};

export type PromptTemplateSummary = {
  id: string;
  version: string;
  params: PromptParams;
  isCurrent: boolean;
  createdAt: string;
};

export type AdminDashboardData = {
  role: "admin";
  userCounts: Record<UserRole, number>;
  connectors: ConnectorSummary[];
  ingestionRuns: IngestionRunSummary[];
  clusteringRuns: ClusteringRunSummary[];
  entityResolutionRuns: EntityResolutionRunSummary[];
  promptClaimCountRange: { min: number; max: number };
  promptTemplates: PromptTemplateSummary[];
  publishers: PublisherSummary[];
};

// Every list endpoint takes the same optional filter/sort/page params, so they
// serialise the same way: skip undefined, stringify the rest.
function toQueryString(params: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

async function getJson<T>(path: string, errorMessage: string): Promise<T> {
  const res = await authFetch(path);
  if (!res.ok) throw new Error(await parseErrorMessage(res, errorMessage));
  return res.json();
}

// `null` for a 404 rather than an error, where the caller has an emptiness to draw and a
// failure would be the wrong treatment for it: a record that is gone is not a request that
// broke. Only 404 — every other status is still an error, so a 500 never reads as "nothing
// here". Kept beside `getJson` because it is the same one fetch layer, one branch wider.
async function getJsonOrNull<T>(path: string, errorMessage: string): Promise<T | null> {
  const res = await authFetch(path);
  if (res.status === 404) return null;
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

// Keyed exactly as the three dashboard pages key their own query, so what login
// prefetches is the entry those pages then read rather than a second copy of it.
// Referenced from postForToken above, which cannot run before this is evaluated.
const DASHBOARD_QUERIES: Record<UserRole, () => Promise<unknown>> = {
  student: getStudentDashboard,
  investor: getInvestorDashboard,
  admin: getAdminDashboard,
};

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

// CONTEXT.md "Analysis Text Mode" — mirrors backend/src/entities/Article.ts's
// ANALYSIS_TEXT_MODES, same as STORY_CATEGORIES mirrors the Story vocabulary.
export type AnalysisTextMode =
  | "metadata_only"
  | "feed_excerpt"
  | "api_content"
  | "licensed_full_text"
  | "manual_fixture";

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
  analysisTextMode: AnalysisTextMode;
  publisher: { id: string; name: string; domain: string };
};

export type StoryDetail = StorySummary & { articles: ArticleSummary[] };

export type ArticleDetail = {
  id: string;
  title: string;
  url: string;
  // null where this Publisher's Terms Class does not clear its text for serving
  // (ADR-0032) — the body is still held for analysis, just not shown. Since the
  // default class became `licensed` this is the exception rather than the rule.
  analysisText: string | null;
  analysisTextMode: AnalysisTextMode;
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
  return getJson(`/api/v1/stories${toQueryString(params)}`, "Could not load Stories");
}

export function getStory(id: string): Promise<StoryDetail> {
  return getJson(`/api/v1/stories/${id}`, "Could not load this Story");
}

// CONTEXT.md "Timeline" — mirrors backend/src/timeline/buildTimeline.ts. A *computed*
// read view: nothing here is generated, so it is a plain fetch on render, unlike the
// analysis on the same record.
export type TimelineGranularity = "hour" | "day" | "week";

// `storyId` is on every point because the seam is shared: a Story's timeline knows
// whose points these are, and the search timeline (#65) groups by it into lanes.
export type TimelinePoint = ArticleSummary & { storyId: string | null };

export type TimelineEvent =
  | { kind: "evidence_frozen"; id: string; at: string; articleCount: number }
  | { kind: "analysis_completed"; id: string; at: string; lens: GenerationLens };

export type Timeline = {
  from: string | null;
  to: string | null;
  granularity: TimelineGranularity;
  points: TimelinePoint[];
  events: TimelineEvent[];
  volume: { periodStart: string; count: number }[];
};

export function getStoryTimeline(id: string): Promise<Timeline> {
  return getJson(`/api/v1/stories/${id}/timeline`, "Could not load this Story's timeline");
}

export function getArticle(id: string): Promise<ArticleDetail> {
  return getJson(`/api/v1/articles/${id}`, "Could not load this Article");
}

// #22: mirrors backend/src/routes/search.ts's hybrid (FTS + vector, RRF) search.
export type SearchSortField = "relevance" | "publishedAt";

// No analysisText: body text is served only by the Article detail endpoint, so a
// result links through to it rather than carrying it. That is one read path per
// body, which is what keeps the Terms Class check in one place (ADR-0032).
export type SearchResult = ArticleSummary & {
  story: { id: string; slug: string; title: string };
  score: number;
};

export type SearchParams = {
  q: string;
  page?: number;
  pageSize?: number;
  category?: StoryCategory;
  dateFrom?: string;
  dateTo?: string;
  sort?: `${SearchSortField}:asc` | `${SearchSortField}:desc`;
};

export function search(params: SearchParams): Promise<ListEnvelope<SearchResult>> {
  return getJson(`/api/v1/search${toQueryString(params)}`, "Could not run this search");
}

// #65: the same query's matches on one time axis, grouped into a lane per Story. Mirrors
// backend/src/routes/search.ts — the axis is the timeline seam's, and relevance is the
// search endpoint's, so both surfaces agree about what matched.
export type SearchTimelineLane = {
  // The same Story projection a result row carries, so both readings of a search name a
  // Story the one way.
  story: { id: string; slug: string; title: string };
  // Index-aligned with `volume` on the timeline itself: a lane is bucketed against the
  // shared axis, never its own span, which is what makes parallel coverage read as
  // parallel rather than as two charts.
  volume: number[];
};

export type SearchTimelineResult = Timeline & {
  lanes: SearchTimelineLane[];
  // Every match the query has, which can be more than one axis carries — the endpoint
  // takes the most relevant up to its cap, and this is how the reader is told so.
  total: number;
};

// No page, no pageSize, no sort: a timeline is a set, and its order is time. The endpoint
// accepts all three so a URL switched over from /search never dead-ends, and pins the axis
// to relevance itself, so leaving them off here cannot read differently from carrying them.
export type SearchTimelineParams = Pick<SearchParams, "q" | "category" | "dateFrom" | "dateTo">;

export function searchTimeline(params: SearchTimelineParams): Promise<SearchTimelineResult> {
  return getJson(
    `/api/v1/search/timeline${toQueryString(params)}`,
    "Could not lay this search out on a timeline",
  );
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
  // #55: the GenerationRun this Brief froze, or null for one assembled by hand. The
  // claims themselves come with the record, not with a summary.
  generationRunId: string | null;
  ownerId: string;
  articleCount: number;
  createdAt: string;
  updatedAt: string;
};

// The saved analysis arrives whole with the Brief: the same frozen claims, evidence
// and citations Story detail renders, read back from the run the Brief pins (#55).
export type BriefDetail = BriefSummary & { articles: ArticleSummary[]; analysis: Analysis | null };

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
  return getJson(`/api/v1/briefs${toQueryString(params)}`, "Could not load Briefs");
}

export function getBrief(id: string): Promise<BriefDetail> {
  return getJson(`/api/v1/briefs/${id}`, "Could not load this Brief");
}

export function createBrief(input: BriefInput): Promise<BriefSummary> {
  return sendJson("POST", "/api/v1/briefs", input, "Could not create this Brief");
}

// #55: the same endpoint, one field. What comes back is a Brief the caller owns, its
// title and category pre-filled from the Story and the analysis' own evidence pinned
// — so saving an analysis is creating a Brief, which is why an Admin cannot do it.
export function saveAnalysisToBrief(generationRunId: string): Promise<BriefSummary> {
  return sendJson("POST", "/api/v1/briefs", { generationRunId }, "Could not save this analysis");
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

// The set the upload endpoint accepts, spelled once for the two file inputs that
// hint it (the Brief form and the Brief record page). The gate is the server's
// byte-signature sniff (backend/src/lib/imageValidation.ts) — this is the file
// picker's filter, not the rule.
export const COVER_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

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


// #39, #42: the Admin ingestion surface. Both are Admin-only server-side
// (backend/src/routes/ingestion.ts) — the console is only ever rendered for an
// Admin, so the client does not re-check what the API enforces.
//
// The run command is an enqueue, so what comes back is an acknowledgement and not
// a run: the IngestionRun appears in the dashboard payload once the worker has
// executed it (ADR-0024 — history is read from Postgres, never the queue).
export type IngestionRunAccepted = { connectorId: string; status: "accepted" };

export function runIngestionConnector(connectorId: string): Promise<IngestionRunAccepted> {
  return sendJson("POST", `/api/v1/ingestion/connectors/${connectorId}/run`, undefined, "Could not run this connector");
}

export function setConnectorEnabled(connectorId: string, enabled: boolean): Promise<ConnectorSummary> {
  return sendJson("PATCH", `/api/v1/ingestion/connectors/${connectorId}`, { enabled }, "Could not update this connector");
}

// #49: the Admin clustering trigger, an enqueue for the same reason the ingestion
// one is — the worker executes the pass, and the ClusteringRun appears in the
// dashboard payload once it has. No id in the path: clustering is one pass over the
// whole corpus, so there is nothing to name.
export type ClusteringRunAccepted = { status: "accepted" };

export function runClustering(): Promise<ClusteringRunAccepted> {
  return sendJson("POST", "/api/v1/clustering/runs", undefined, "Could not run clustering");
}

// #66: the Admin resolution trigger, an enqueue for the same reason the two above it
// are. `ClusteringRunAccepted` reused rather than a third identical alias: every
// accepted enqueue on this surface answers the same one thing.
export function runEntityResolution(): Promise<ClusteringRunAccepted> {
  return sendJson("POST", "/api/v1/graph/resolution-runs", undefined, "Could not run entity resolution");
}

// #50: the review queue. CONTEXT.md "Story Assignment" — a proposal in the band
// beneath the auto-accept threshold, invisible to every reader until an Admin
// decides it. A row is the Article, the Story proposed for it, and the score behind
// the proposal, which is the whole of what a decision rests on.
export type PendingAssignment = ArticleSummary & {
  // Nullable because the column is: nothing in the schema ties a score to the
  // decision beside it, so the console states an absent one rather than crashing on
  // it (backend/src/entities/Article.ts).
  score: number | null;
  proposedStory: { id: string; slug: string; title: string; category: StoryCategory };
};

export type AssignmentDecision = "accept" | "reject";
export type DecidedAssignment = { articleId: string; storyId: string; decision: AssignmentDecision };

export function getPendingAssignments(): Promise<ListEnvelope<PendingAssignment>> {
  return getJson("/api/v1/clustering/pending", "Could not load the review queue");
}

export function decidePendingAssignment(
  articleId: string,
  decision: AssignmentDecision,
): Promise<DecidedAssignment> {
  return sendJson("PATCH", `/api/v1/clustering/pending/${articleId}`, { decision }, "Could not record this decision");
}

// #67: the merge review queue. CONTEXT.md "Merge proposal" — a candidate merge in the
// band beneath the automatic bar, which changes nothing until an Admin decides it. A row
// is both surface names, the kind they share, and the reporting behind each side, which
// is the whole of what the decision rests on.
//
// One `kind` on the proposal rather than one per side: candidate pairs are same-kind by
// construction, so two identical values would only invite a reader to compare them.
//
// The three kinds that promote (ADR-0028 — a Theme is never an Entity), mirroring
// PROMOTABLE_KINDS in backend/src/graph/config.ts. A labelled vocabulary rather than a
// bare string, because it is displayed.
export const ENTITY_KINDS = ["person", "organization", "location"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

// CONTEXT.md's own words for the three promotable kinds. Not "place" for `location`:
// the glossary fixes these terms for code, docs and conversation alike, and a label that
// renames one of them on screen makes the reader's word and the codebase's word differ.
export const ENTITY_KIND_LABELS: Record<EntityKind, string> = {
  person: "person",
  organization: "organization",
  location: "location",
};

export type MergeProposalSide = {
  id: string;
  kind: EntityKind;
  // The surface form GDELT reported, not the fold the similarity was measured over.
  canonicalName: string;
  articleCount: number;
  // A sample, not the side's whole reporting: enough to recognise which name this is.
  // `story` is the membership label the graph seam attaches, never a filter: reporting a
  // reader can open as a record, against reporting they can only open at its Publisher.
  articles: {
    id: string;
    title: string;
    url: string;
    publishedAt: string;
    story: { id: string; slug: string; title: string } | null;
  }[];
};

export type MergeProposal = {
  id: string;
  similarity: number;
  kind: EntityKind;
  survivor: MergeProposalSide;
  merged: MergeProposalSide;
};

export type MergeProposalDecision = "accept" | "refuse";
export type DecidedMergeProposal = {
  proposalId: string;
  decision: MergeProposalDecision;
  survivorEntityId: string;
  mergedEntityId: string;
};

// The corpus rides with the queue, as it rides with both reader surfaces: this list reads
// the firehose through the graph's seam, and AGENTS.md exempts that seam on the condition
// that a surface drawing it says so.
export function getMergeProposals(): Promise<ListEnvelope<MergeProposal> & { retainedDays: number }> {
  return getJson("/api/v1/graph/merge-proposals", "Could not load the merge review queue");
}

export function decideMergeProposal(
  proposalId: string,
  decision: MergeProposalDecision,
): Promise<DecidedMergeProposal> {
  return sendJson(
    "PATCH",
    `/api/v1/graph/merge-proposals/${proposalId}`,
    { decision },
    "Could not record this decision",
  );
}

// #68: the bounded global graph, mirroring backend/src/graph/loadGraphView.ts. Every
// reader role reads this one — ADR-0021's role features are elsewhere, and a
// co-occurrence weighted differently per role would be evidence about the reader
// rather than about the reporting.
//
// The endpoint takes no parameters on purpose: the node and edge bounds are the
// server's, so there is nothing here to pass and nothing a caller could widen.
export type GraphNode = { id: string; kind: EntityKind; canonicalName: string; articleCount: number };

// The pair as stored — ordered by id, one row per pair — with the number of Articles
// that reported both names together as its weight.
export type GraphEdge = { entityAId: string; entityBId: string; weight: number };

export type GraphView = {
  // The two rules the page has to state in the reader's own language: the rolling window
  // this corpus is kept for, and how much reporting a name needs before it is in the
  // graph at all. Read from the backend rather than restated here, so the page cannot
  // drift from the pass that built what it is drawing.
  retainedDays: number;
  promotionFloor: number;
  // The whole working set, against `nodes.length` — what lets the page say it is showing
  // part of the graph instead of implying it is showing all of it.
  entityCount: number;
  articleCount: number;
  from: string | null;
  to: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export function getGraphView(): Promise<GraphView> {
  return getJson("/api/v1/graph", "Could not load the knowledge graph");
}

// #69: one Entity's neighbourhood, reached by clicking a name in the global view. The
// same node and edge bounds as above, applied by the same read path server-side, so the
// two pictures cannot disagree about what is in the graph.
export type EntityProfile = {
  id: string;
  kind: EntityKind;
  canonicalName: string;
  // The other surface names a merge folded into this one, normalized — what an alias is
  // remembered as (backend/src/entities/EntityAlias.ts), so the page says so rather than
  // implying these were reported this way.
  aliases: string[];
  articleCount: number;
  from: string | null;
  to: string | null;
};

// A Theme this name is reported under, with how much of its reporting carries it. Never
// a node (ADR-0028) — the head of the list, so the page states the count beside each.
export type ThemeFacet = { theme: string; articleCount: number };

export type Neighbourhood = {
  retainedDays: number;
  promotionFloor: number;
  // How far out the picture reaches, stated because a reader cannot see a hop count in
  // a layout. Fixed server-side: one hop is what "neighbourhood" means.
  depth: number;
  focus: EntityProfile;
  // The facet in force, echoed back, and the vocabulary to choose from — computed over
  // the focus's whole reporting rather than the filtered slice, so switching facets is
  // never a dead end.
  theme: string | null;
  themes: ThemeFacet[];
  // Neighbours the focus has, against `nodes.length - 1` drawn: the same "part of, not
  // all of" the global view states with `entityCount`.
  neighbourCount: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

// The reporting one edge was observed in — the citation invariant made openable. Metadata
// only, whatever a Publisher's Terms Class allows: a body is served from the Article
// record alone, which is the one place that class is consulted (ADR-0032). `story` is null
// while an Article's Story membership is not accepted, so the link is offered only where
// it resolves.
export type EdgeCitation = ArticleSummary & { story: { id: string; slug: string; title: string } | null };

// `weight` is the edge's whole weight, which may exceed the citations returned — the page
// states both rather than implying the list is all of it.
export type EdgeCitations = { weight: number; citations: EdgeCitation[] };

export function getEntityNeighbourhood(entityId: string, theme?: string | null): Promise<Neighbourhood> {
  return getJson(
    `/api/v1/graph/entities/${entityId}${toQueryString({ theme: theme ?? undefined })}`,
    "Could not load this Entity's neighbourhood",
  );
}

// `null` where the graph holds no edge for the pair. The endpoint 404s that rather than
// answering an empty list, because an empty list would assert a co-mention that was never
// reported — but a drawer is only ever opened on a line the page just drew, so the reader's
// case is an edge the hourly pass rolled away between the two requests. That is an absence,
// not a failed request, and the page states it as one.
export function getEdgeCitations(
  entityId: string,
  otherEntityId: string,
  theme?: string | null,
): Promise<EdgeCitations | null> {
  return getJsonOrNull(
    `/api/v1/graph/entities/${entityId}/edges/${otherEntityId}${toQueryString({ theme: theme ?? undefined })}`,
    "Could not load the reporting behind this connection",
  );
}

// #53: the flagship. Mirrors backend/src/entities/GenerationRun.ts and
// AnalysisClaim.ts. CONTEXT.md "Lens" — one role-specific claim type per
// generation, derived from the caller's role, so a Student and an Investor get
// different data from the same frozen evidence (ADR-0004).
export const GENERATION_LENSES = ["student_context", "investor_implication"] as const;
export type GenerationLens = (typeof GENERATION_LENSES)[number];

// A Lens named as itself: the Admin's select over the whole vocabulary (#53) and the
// timeline's record of which one a past run was written under (#64) name it the same
// way, so one map holds both. The analysis register's own labels are *claim group*
// headings ("Context"), not this — a heading over a Student's claims is not the name
// of the Lens they were written under, and collapsing the two would flatten a
// reader-facing distinction into a shared constant.
export const LENS_LABELS: Record<GenerationLens, string> = {
  student_context: "Student context",
  investor_implication: "Investor implication",
};

export const CORE_CLAIM_TYPES = ["consensus", "source_specific", "contradiction"] as const;
export type CoreClaimType = (typeof CORE_CLAIM_TYPES)[number];
export type ClaimType = CoreClaimType | GenerationLens;

// A row of the frozen EvidenceSet: the stable id a claim cites and the Article it
// resolves to. `excerpt` is null where the Publisher's Terms Class does not clear
// that text for serving (#40) — the analysis still rests on it. Since ADR-0032 that
// is the exception: a citation normally opens onto the words the claim came from.
export type EvidenceRow = {
  evidenceId: string;
  articleId: string;
  title: string;
  url: string;
  publishedAt: string;
  publisher: { id: string; name: string; domain: string };
  sourceRank: number;
  selectionReason: "earliest_reporting" | "latest_reporting" | "centroid_rank";
  excerpt: string | null;
};

export type CitationRelationship = "supports" | "contradicts";
export type CitationSide = { relationship: CitationRelationship; citations: string[] };
export type AnalysisClaim = {
  id: string;
  claimType: ClaimType;
  text: string;
  citations: string[];
  citationSides: CitationSide[] | null;
};

// A failed run is a 200 carrying `status: "failed"`, not an HTTP error: it is the
// honest answer to "what is the analysis of this Story", and the reader is shown a
// stated unavailable state rather than a partial one (ADR-0010).
export type GenerationFailureCode =
  | "provider_error"
  | "unparseable_output"
  | "schema_violation"
  | "invalid_citations"
  | "below_claim_floor"
  | "content_changed";

export type Analysis = {
  id: string;
  storyId: string | null;
  lens: GenerationLens;
  promptVersion: string;
  status: "completed" | "failed";
  failureCode: GenerationFailureCode | null;
  articleCount: number;
  distinctPublisherCount: number;
  evidence: EvidenceRow[];
  claims: AnalysisClaim[];
  completedAt: string;
};

// What the Story endpoint answers: the analysis, plus whether this request paid for
// it. A Brief serves the same analysis without that flag — a saved analysis was
// always paid for once, by whoever asked first.
export type StoryAnalysis = Analysis & {
  // True when this analysis already existed for the same evidence, Lens and prompt
  // version — the wait and the cost were paid once (ADR-0027).
  reused: boolean;
};

// Synchronous: one request selects and freezes the evidence, calls the model,
// validates the citations and answers with the finished run.
//
// `lens` is only for an Admin, who belongs to neither reading audience and so has to
// name one; the backend refuses a Lens from a Student or an Investor, whose own role
// decides it (ADR-0027).
export function requestStoryAnalysis(storyId: string, lens?: GenerationLens): Promise<StoryAnalysis> {
  return sendJson(
    "POST",
    `/api/v1/stories/${storyId}/analysis`,
    lens ? { lens } : {},
    "Could not analyse this Story",
  );
}

// #52: the merge. Unlike the run trigger this is not an enqueue — the Stories are
// one Story by the time it answers, so what comes back is what it did.
export type StoryMerge = { survivorStoryId: string; mergedStoryId: string; movedArticles: number };

export function mergeStories(survivorStoryId: string, mergedStoryId: string): Promise<StoryMerge> {
  return sendJson(
    "POST",
    "/api/v1/clustering/merges",
    { survivorStoryId, mergedStoryId },
    "Could not merge these Stories",
  );
}


// #57: create, then activate. Creating one changes nothing about what is generated;
// the current prompt version is part of the reuse key. Activation is the only mutation —
// a version is superseded by making another current, never switched off.
export function createPromptTemplate(input: {
  version: string;
  params: PromptParams;
}): Promise<PromptTemplateSummary> {
  return sendJson("POST", "/api/v1/prompt-templates", input, "Could not create this prompt version");
}

export function setPromptTemplateCurrent(id: string): Promise<PromptTemplateSummary> {
  return sendJson(
    "PATCH",
    `/api/v1/prompt-templates/${id}`,
    { isCurrent: true },
    "Could not make this prompt version current",
  );
}



// #58: the Student's flashcards (ADR-0021). A card is a question in front of an
// AnalysisClaim, so its answer and citations are the claim's own — the same cited
// claims the analysis register renders, read back through the frozen EvidenceSet
// (backend/src/flashcards/deck.ts). Nothing here can carry an uncited answer.
export type FlashcardCitation = {
  evidenceId: string;
  articleId: string;
  title: string;
  publisherName: string;
};

export type Flashcard = {
  id: string;
  question: string;
  answer: string;
  claimType: ClaimType;
  citations: FlashcardCitation[];
  storyId: string | null;
  storyTitle: string;
  generationRunId: string | null;
  // SM-2's state, as the backend advances it. Shown rather than hidden: a reader
  // deciding how hard a card was is entitled to know it comes back in six days.
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
  dueAt: string;
  lastReviewedAt: string | null;
};

// The study session: what is due now, and both counts — a Student with no cards has a
// deck to make, and a Student with nothing due is finished for today. `nextDueAt` is
// what lets the second of those say when.
export type StudySummary = {
  dueCount: number;
  totalCount: number;
  nextDueAt: string | null;
};

export type StudyDeck = StudySummary & {
  items: Flashcard[];
  cards?: Flashcard[];
};

export type FlashcardDeck = {
  generationRunId: string;
  storyId: string;
  storyTitle: string;
  cards: Flashcard[];
};

// SM-2 grades 0–5; these are the four a person can tell apart. The numbers are the
// algorithm's (backend/src/flashcards/sm2.ts) — 3 is the pass mark, so "Again" is the
// only one that lapses the card.
export type ReviewGrade = 0 | 1 | 2 | 3 | 4 | 5;

export const REVIEW_GRADES = [
  { grade: 0, label: "Again" },
  { grade: 3, label: "Hard" },
  { grade: 4, label: "Good" },
  { grade: 5, label: "Easy" },
] as const satisfies readonly { grade: ReviewGrade; label: string }[];

// Making a deck is a mutation for the same reason requesting an analysis is: it may
// cost money (one model call writes the questions) and it creates rows a Student owns.
// Asking twice is safe — cards already made keep their schedule.
export function makeFlashcards(generationRunId: string): Promise<FlashcardDeck> {
  return sendJson("POST", "/api/v1/flashcards", { generationRunId }, "Could not make flashcards");
}

export function getStudyDeck(): Promise<StudyDeck> {
  return getJson("/api/v1/flashcards", "Could not load your flashcards");
}

export function reviewFlashcard(id: string, grade: ReviewGrade): Promise<Flashcard> {
  return sendJson("POST", `/api/v1/flashcards/${id}/reviews`, { grade }, "Could not record this review");
}

export type AllFlashcards = {
  cards: Flashcard[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function getAllFlashcards(options: { page?: number; pageSize?: number; status?: "all" | "due" | "upcoming"; q?: string } = {}): Promise<AllFlashcards> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) if (value !== undefined && value !== "") params.set(key, String(value));
  return getJson(`/api/v1/flashcards/all${params.size ? `?${params}` : ""}`, "Could not load your flashcards");
}

export function generateFlashcardsFromSearch(input: { q: string; count: 5 | 10 | 20; answerLength: "one_word" | "one_line" | "full" }): Promise<{ cards: Flashcard[] }> {
  return sendJson("POST", "/api/v1/flashcards/search", input, "Could not generate flashcards");
}

export function updateFlashcard(id: string, input: { question?: string; answer?: string }): Promise<Flashcard> {
  return sendJson("PATCH", `/api/v1/flashcards/${id}`, input, "Could not update flashcard");
}

export async function deleteFlashcard(id: string): Promise<void> {
  const res = await authFetch(`/api/v1/flashcards/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not delete flashcard"));
}

export function getFlashcardHistory(id: string): Promise<{ items: { grade: number; reviewedAt: string }[] }> {
  return getJson(`/api/v1/flashcards/${id}/history`, "Could not load study history");
}

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
  // null when the Article's Analysis Text Mode is not ours to redistribute
  // (ADR-0018) — the body is held for analysis but never served.
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

// No analysisText: body text is served only by the Article detail endpoint
// (ADR-0018), so a result links through to it rather than carrying it.
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

// #53: the flagship. Mirrors backend/src/entities/GenerationRun.ts and
// AnalysisClaim.ts. CONTEXT.md "Lens" — one role-specific claim type per
// generation, derived from the caller's role, so a Student and an Investor get
// different data from the same frozen evidence (ADR-0004).
export const GENERATION_LENSES = ["student_context", "investor_implication"] as const;
export type GenerationLens = (typeof GENERATION_LENSES)[number];

export const CORE_CLAIM_TYPES = ["consensus", "source_specific", "contradiction"] as const;
export type CoreClaimType = (typeof CORE_CLAIM_TYPES)[number];
export type ClaimType = CoreClaimType | GenerationLens;

// A row of the frozen EvidenceSet: the stable id a claim cites and the Article it
// resolves to. `excerpt` is null where the Publisher's Terms Class does not clear
// that text for serving (#40) — the analysis still rests on it.
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
  storyId: string;
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
  storyId: string;
  storyTitle: string;
  generationRunId: string;
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

import { AppDataSource } from "../data-source";
import { Article } from "../entities/Article";
import { ClusteringRun } from "../entities/ClusteringRun";
import { Story } from "../entities/Story";
import type { StoryAssignmentStatus } from "../entities/Article";
import type { EmbeddingProvider } from "../embeddings/EmbeddingProvider";
import { toVectorLiteral } from "../embeddings/pgvector";
import { invalidateComparableStoriesCache } from "../generation/evidence";
import { ACCEPTED_ASSIGNMENT, PENDING_ASSIGNMENT, acceptedCentroid } from "../lib/storyMembership";
import type { SynthesisProvider } from "../synthesis";
import {
  CLUSTERABLE_TEXT_MODES,
  DEFAULT_STORY_CATEGORY,
  EMBED_BATCH_SIZE,
  RECENCY_WINDOW_HOURS,
  REVIEW_THRESHOLD,
  SIMILARITY_THRESHOLD,
} from "./config";
import { nameNewStory, storySlug } from "./naming";

export type ClusteringDeps = { embedder: EmbeddingProvider; namer: SynthesisProvider };

type Candidate = {
  id: string;
  title: string;
  publisherId: string;
  publishedAt: Date;
  vector: number[];
};

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

function parseVector(literal: string): number[] {
  return JSON.parse(literal) as number[];
}

// #50: a proposal is a judgement about the text that scored it. Enrichment nulls the
// vector when it writes new text (ADR-0026), so a pending assignment on a
// null-vector Article describes text Tessera no longer holds — void it, and this
// same run rescores the Article from what it holds now.
//
// Not only cosmetic: candidates are Articles with no storyId, so without this a
// re-enriched proposal would never be reconsidered at all. It would sit in the
// review queue forever, showing a reviewer a score for a body that has been replaced.
async function voidProposalsAwaitingReEmbedding(): Promise<void> {
  await AppDataSource.query(
    `UPDATE "articles" SET "storyId" = NULL, "storyAssignmentStatus" = NULL, "storyAssignmentScore" = NULL
     WHERE "storyAssignmentStatus" = $1 AND "embedding" IS NULL`,
    [PENDING_ASSIGNMENT],
  );
}

// ADR-0026: a null vector means needs embedding. Drain the whole eligible
// backlog each run, but keep provider calls bounded by the request batch size.
async function embedEligibleArticles(embedder: EmbeddingProvider): Promise<number> {
  const pending = await AppDataSource.getRepository(Article)
    .createQueryBuilder("article")
    .select(["article.id", "article.title", "article.analysisText", "article.analysisTextMode"])
    .where(`article.embedding IS NULL`)
    .andWhere(`article."analysisTextMode" IN (:...modes)`, { modes: CLUSTERABLE_TEXT_MODES })
    .orderBy(`article."publishedAt"`, "DESC")
    .getMany();

  let embedded = 0;
  for (let start = 0; start < pending.length; start += EMBED_BATCH_SIZE) {
    const batch = pending.slice(start, start + EMBED_BATCH_SIZE);
    const vectors = await embedder.embedBatch(
      batch.map((article) => `${article.title}\n${article.analysisText ?? ""}`),
      "passage",
    );
    for (const [index, article] of batch.entries()) {
      const [, affected]: [unknown[], number] = await AppDataSource.query(
        `UPDATE "articles" SET "embedding" = $1::vector
         WHERE "id" = $2 AND "embedding" IS NULL AND "analysisTextMode" = $3`,
        [toVectorLiteral(vectors[index]), article.id, article.analysisTextMode],
      );
      embedded += affected;
    }
  }
  return embedded;
}

// Recompute every Story, including curated Stories. A Story whose members all
// lost their vectors must also lose its stale centroid.
//
// Accepted members only (#50): a pending assignment carries this Story's id, but it
// is a proposal about the Story, not part of what the Story is. Letting one into
// the mean would let a borderline guess move the centroid that scores the next
// candidate — a guess quietly deciding the run's later decisions.
async function recomputeStoryCentroids(): Promise<void> {
  await AppDataSource.query(`UPDATE "stories" s SET "embedding" = ${acceptedCentroid("s")}`);
}

async function loadCandidates(): Promise<Candidate[]> {
  const rows: { id: string; title: string; publisherId: string; publishedAt: Date; vector: string }[] =
    await AppDataSource.query(
      `SELECT "id", "title", "publisherId", "publishedAt", "embedding"::text AS vector
       FROM "articles"
       WHERE "storyId" IS NULL AND "embedding" IS NOT NULL AND "analysisTextMode" = ANY($1::varchar[])
       ORDER BY "publishedAt" DESC, "id" ASC`,
      [CLUSTERABLE_TEXT_MODES],
    );
  return rows.map((row) => ({ ...row, vector: parseVector(row.vector) }));
}

async function curatedStoryIds(): Promise<string[]> {
  const rows: { storyId: string }[] = await AppDataSource.query(
    `SELECT DISTINCT "storyId" FROM "articles" WHERE "analysisTextMode" = 'manual_fixture' AND "storyId" IS NOT NULL`,
  );
  return rows.map((row) => row.storyId);
}

// #50: a pairing an Admin has rejected is not a candidate again. Read once for the
// whole run rather than per Article — the table holds one row per human decision,
// so it is the smallest thing this job loads.
async function rejectedStoriesByArticle(): Promise<Map<string, string[]>> {
  const rows: { articleId: string; storyId: string }[] = await AppDataSource.query(
    `SELECT "articleId", "storyId" FROM "rejected_story_assignments"`,
  );
  const byArticle = new Map<string, string[]>();
  for (const row of rows) {
    byArticle.set(row.articleId, [...(byArticle.get(row.articleId) ?? []), row.storyId]);
  }
  return byArticle;
}

// ADR-0026's band, read top down: above the threshold membership is a fact, in the
// band beneath it a proposal for an Admin, below both nothing at all — the Article
// stays Unclustered and is reconsidered next run.
function outcomeFor(similarity: number): StoryAssignmentStatus | null {
  if (similarity >= SIMILARITY_THRESHOLD) return ACCEPTED_ASSIGNMENT;
  if (similarity >= REVIEW_THRESHOLD) return PENDING_ASSIGNMENT;
  return null;
}

type NearestStory = { id: string; similarity: number; vector: number[] };

async function nearestStory(
  vector: number[],
  seenSince: Date,
  excludedStoryIds: string[],
): Promise<NearestStory | null> {
  const rows: { id: string; similarity: string; vector: string }[] = await AppDataSource.query(
    `SELECT "id", 1 - ("embedding" <=> $1::vector) AS similarity, "embedding"::text AS vector
     FROM "stories"
     WHERE "embedding" IS NOT NULL AND "lastSeenAt" >= $2 AND NOT ("id" = ANY($3::uuid[]))
     ORDER BY "embedding" <=> $1::vector
     LIMIT 1`,
    [toVectorLiteral(vector), seenSince, excludedStoryIds],
  );
  return rows.length === 0
    ? null
    : { id: rows[0].id, similarity: Number(rows[0].similarity), vector: parseVector(rows[0].vector) };
}

// The one writer of a Story Assignment onto an existing Story, for both outcomes the
// band produces: an accepted assignment, which grows the Story, and a proposal held for
// review, which does not touch it at all (#50). One function because the expensive
// half — revalidating that the vectors scored are still the vectors stored — is
// identical, and a second copy of it is a second chance to get the locking wrong.
async function assignToStory(
  candidate: Candidate,
  story: NearestStory,
  status: StoryAssignmentStatus,
): Promise<boolean> {
  const { id: storyId, similarity: score, vector: storyVector } = story;
  return AppDataSource.transaction(async (manager) => {
    // Lock and revalidate the exact vectors used for scoring. Enrichment may run
    // beside clustering and NULL a vector after candidates/centroids were read;
    // membership must never commit from that stale snapshot.
    const candidateRows = await manager.query(
      `SELECT "id" FROM "articles"
       WHERE "id" = $1 AND "storyId" IS NULL AND "embedding" = $2::vector
       FOR UPDATE`,
      [candidate.id, toVectorLiteral(candidate.vector)],
    );
    if (candidateRows.length === 0) return false;

    // Lock members before comparing the stored centroid with their current mean,
    // so enrichment cannot invalidate it between validation and assignment.
    await manager.query(
      `SELECT "id" FROM "articles" WHERE "storyId" = $1 ORDER BY "id" FOR UPDATE`,
      [storyId],
    );
    const storyRows = await manager.query(
      `SELECT s."id" FROM "stories" s
       WHERE s."id" = $1
         AND s."embedding" = $2::vector
         AND s."embedding" = ${acceptedCentroid("s")}
       FOR UPDATE`,
      [storyId, toVectorLiteral(storyVector)],
    );
    if (storyRows.length === 0) return false;

    await manager.getRepository(Article).update(
      { id: candidate.id },
      { storyId, storyAssignmentStatus: status, storyAssignmentScore: score },
    );
    // A proposal changes nothing about the Story: not its centroid, and not its
    // span — which is what the recency gate reads, so a borderline guess must not
    // be able to keep a dormant Story alive for the next run.
    if (status !== ACCEPTED_ASSIGNMENT) return true;
    await manager.query(
      `UPDATE "stories" s
       SET "firstSeenAt" = LEAST(s."firstSeenAt", $2),
           "lastSeenAt" = GREATEST(s."lastSeenAt", $2),
           "embedding" = ${acceptedCentroid("s")}
       WHERE s."id" = $1`,
      [storyId, candidate.publishedAt],
    );
    return true;
  });
}

function medoidOf(group: Candidate[]): Candidate {
  let best = group[0];
  let bestTotal = -Infinity;
  for (const member of group) {
    const total = group.reduce(
      (sum, other) => (other === member ? sum : sum + cosineSimilarity(member.vector, other.vector)),
      0,
    );
    if (total > bestTotal || (total === bestTotal && member.id < best.id)) {
      best = member;
      bestTotal = total;
    }
  }
  return best;
}

class GroupNotCorroborated extends Error {}

// What a committed Story hands back so it can be named (#51) outside the
// transaction: who to name it after if the model does not answer, and the
// headlines that are the only thing the model is shown.
type SeededStory = { id: string; medoidId: string; headlines: string[]; members: number };

async function seedStory(group: Candidate[]): Promise<SeededStory | null> {
  try {
    return await AppDataSource.transaction(async (manager) => {
      // Lock and revalidate the would-be members before deriving the medoid.
      // Enrichment can NULL a vector while the pairwise pass is in memory; an
      // Article that no longer joins must not name or score the surviving Story.
      const current: Candidate[] = [];
      for (const member of [...group].sort((a, b) => a.id.localeCompare(b.id))) {
        const rows: { publisherId: string }[] = await manager.query(
          `SELECT "publisherId" FROM "articles"
           WHERE "id" = $1 AND "storyId" IS NULL AND "embedding" = $2::vector
           FOR UPDATE`,
          [member.id, toVectorLiteral(member.vector)],
        );
        if (rows[0]?.publisherId === member.publisherId) current.push(member);
      }
      if (
        current.length !== group.length ||
        current.length < 2 ||
        new Set(current.map((member) => member.publisherId)).size < 2
      ) {
        throw new GroupNotCorroborated();
      }

      const medoid = medoidOf(current);
      const story = await manager.getRepository(Story).save({
        slug: storySlug(medoid.title, medoid.id),
        title: medoid.title,
        summary: null,
        category: DEFAULT_STORY_CATEGORY,
        firstSeenAt: medoid.publishedAt,
        lastSeenAt: medoid.publishedAt,
      });

      const attached: Candidate[] = [];
      for (const member of current) {
        const [, affected]: [unknown[], number] = await manager.query(
          `UPDATE "articles"
           SET "storyId" = $1, "storyAssignmentStatus" = 'auto_accepted', "storyAssignmentScore" = $2
           WHERE "id" = $3 AND "storyId" IS NULL
           RETURNING "id"`,
          [story.id, cosineSimilarity(member.vector, medoid.vector), member.id],
        );
        if (affected === 1) attached.push(member);
      }
      if (attached.length < 2 || new Set(attached.map((member) => member.publisherId)).size < 2) {
        throw new GroupNotCorroborated();
      }

      const times = attached.map((member) => new Date(member.publishedAt).getTime());
      await manager.query(`UPDATE "stories" SET "firstSeenAt" = $2, "lastSeenAt" = $3 WHERE "id" = $1`, [
        story.id,
        new Date(Math.min(...times)),
        new Date(Math.max(...times)),
      ]);
      return {
        id: story.id,
        medoidId: medoid.id,
        // Medoid first: it is the cluster's centre, and a deterministic order keeps
        // the prompt — and so the Mock's answer — reproducible.
        headlines: [medoid.title, ...attached.filter((member) => member.id !== medoid.id).map((m) => m.title)],
        members: attached.length,
      };
    });
  } catch (err) {
    if (err instanceof GroupNotCorroborated) return null;
    throw err;
  }
}

async function seedStories(
  candidates: Candidate[],
  namer: SynthesisProvider,
  tally: { seeded: number; storiesCreated: number },
): Promise<void> {
  const placed = new Set<string>();

  // ponytail: greedy maximal cliques are O(n³) in the worst case. Replace this
  // with an indexed graph/clique pass only if the hourly eligible backlog makes
  // this measurable; the simple pass keeps mutual matching explicit today.
  for (const seed of candidates) {
    if (placed.has(seed.id)) continue;
    const corroborator = candidates.find(
      (other) =>
        other.id !== seed.id &&
        !placed.has(other.id) &&
        other.publisherId !== seed.publisherId &&
        cosineSimilarity(seed.vector, other.vector) >= SIMILARITY_THRESHOLD,
    );
    if (!corroborator) continue;

    const group = [seed, corroborator];
    for (const other of candidates) {
      if (group.some((member) => member.id === other.id) || placed.has(other.id)) continue;
      if (group.every((member) => cosineSimilarity(member.vector, other.vector) >= SIMILARITY_THRESHOLD)) {
        group.push(other);
      }
    }

    const seeded = await seedStory(group);
    if (!seeded) continue;
    tally.seeded += seeded.members;
    tally.storiesCreated += 1;
    // Exactly here, and nowhere else: one call for one Story that did not exist a
    // moment ago. Not per Article, not per run, and never for an existing Story.
    //
    // ponytail: serial and uncached — a run's wall clock grows by up to
    // STORY_NAMING_TIMEOUT_MS per new Story. Batch the names into one call, or add
    // AGENTS.md's content_hash cache, only once a run seeds enough Stories at once
    // for that to be measurable.
    await nameNewStory(namer, seeded);
    for (const member of group) placed.add(member.id);
  }
}

export async function runClustering(deps: ClusteringDeps): Promise<ClusteringRun> {
  const runs = AppDataSource.getRepository(ClusteringRun);
  const run = await runs.save({ status: "running" as const, startedAt: new Date() });
  let embedded = 0;
  let considered = 0;
  let assigned = 0;
  let heldForReview = 0;
  const tally = { seeded: 0, storiesCreated: 0 };
  const ledger = () => ({
    embedded,
    considered,
    assigned,
    heldForReview,
    seeded: tally.seeded,
    unclustered: considered - assigned - heldForReview - tally.seeded,
    storiesCreated: tally.storiesCreated,
  });

  try {
    await voidProposalsAwaitingReEmbedding();
    embedded = await embedEligibleArticles(deps.embedder);
    await recomputeStoryCentroids();

    const candidates = await loadCandidates();
    considered = candidates.length;
    const excludedStoryIds = await curatedStoryIds();
    const rejected = await rejectedStoriesByArticle();
    const seenSince = new Date(Date.now() - RECENCY_WINDOW_HOURS * 60 * 60 * 1000);
    const unassigned: Candidate[] = [];

    // ponytail: two round trips per candidate. Move scoring into one set query if
    // an hourly pass becomes slow; correctness does not need that complexity now.
    for (const candidate of candidates) {
      const nearest = await nearestStory(candidate.vector, seenSince, [
        ...excludedStoryIds,
        ...(rejected.get(candidate.id) ?? []),
      ]);
      const outcome = nearest && outcomeFor(nearest.similarity);
      if (
        nearest &&
        outcome &&
        (await assignToStory(candidate, nearest, outcome))
      ) {
        if (outcome === ACCEPTED_ASSIGNMENT) assigned += 1;
        else heldForReview += 1;
      } else {
        // Only Articles that matched nothing at all go on to seed: an Article held
        // for review is already claimed by a proposal, and seeding it into a second
        // Story would put it in two at once.
        unassigned.push(candidate);
      }
    }

    await seedStories(unassigned, deps.namer, tally);
    if (assigned + tally.seeded > 0) await recomputeStoryCentroids();

    await runs.update(
      { id: run.id },
      { status: "succeeded", completedAt: new Date(), ...ledger(), errorSummary: null },
    );
  } catch (err) {
    await runs.update(
      { id: run.id },
      {
        status: "failed",
        completedAt: new Date(),
        ...ledger(),
        errorSummary: err instanceof Error ? err.message : String(err),
      },
    );
  }

  const result = await runs.findOneByOrFail({ id: run.id });
  await invalidateComparableStoriesCache();
  return result;
}

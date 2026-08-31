import { AppDataSource } from "../data-source";
import { Article } from "../entities/Article";
import { ClusteringRun } from "../entities/ClusteringRun";
import { Story } from "../entities/Story";
import type { EmbeddingProvider } from "../embeddings/EmbeddingProvider";
import { toVectorLiteral } from "../embeddings/pgvector";
import {
  CLUSTERABLE_TEXT_MODES,
  DEFAULT_STORY_CATEGORY,
  EMBED_BATCH_SIZE,
  RECENCY_WINDOW_HOURS,
  SIMILARITY_THRESHOLD,
} from "./config";

export type ClusteringDeps = { embedder: EmbeddingProvider };

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
async function recomputeStoryCentroids(): Promise<void> {
  await AppDataSource.query(`
    UPDATE "stories" s
    SET "embedding" = (
      SELECT avg(a."embedding") FROM "articles" a WHERE a."storyId" = s."id" AND a."embedding" IS NOT NULL
    )
  `);
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

async function nearestStory(
  vector: number[],
  seenSince: Date,
  excludedStoryIds: string[],
): Promise<{ id: string; similarity: number; vector: number[] } | null> {
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

async function assignToStory(
  candidate: Candidate,
  storyId: string,
  storyVector: number[],
  score: number,
): Promise<boolean> {
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
    await manager.query(`SELECT "id" FROM "articles" WHERE "storyId" = $1 FOR UPDATE`, [storyId]);
    const storyRows = await manager.query(
      `SELECT s."id" FROM "stories" s
       WHERE s."id" = $1
         AND s."embedding" = $2::vector
         AND s."embedding" = (
           SELECT avg(a."embedding") FROM "articles" a
           WHERE a."storyId" = s."id" AND a."embedding" IS NOT NULL
         )
       FOR UPDATE`,
      [storyId, toVectorLiteral(storyVector)],
    );
    if (storyRows.length === 0) return false;

    await manager.getRepository(Article).update(
      { id: candidate.id },
      { storyId, storyAssignmentStatus: "auto_accepted", storyAssignmentScore: score },
    );
    await manager.query(
      `UPDATE "stories" s
       SET "firstSeenAt" = LEAST(s."firstSeenAt", $2),
           "lastSeenAt" = GREATEST(s."lastSeenAt", $2),
           "embedding" = (
             SELECT avg(a."embedding") FROM "articles" a
             WHERE a."storyId" = s."id" AND a."embedding" IS NOT NULL
           )
       WHERE s."id" = $1`,
      [storyId, candidate.publishedAt],
    );
    return true;
  });
}

function storySlug(title: string, medoidId: string): string {
  const stem = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${stem || "story"}-${medoidId.slice(0, 8)}`;
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

async function seedStory(group: Candidate[]): Promise<number> {
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
      return attached.length;
    });
  } catch (err) {
    if (err instanceof GroupNotCorroborated) return 0;
    throw err;
  }
}

async function seedStories(candidates: Candidate[], tally: { seeded: number; storiesCreated: number }): Promise<void> {
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
    if (seeded === 0) continue;
    tally.seeded += seeded;
    tally.storiesCreated += 1;
    for (const member of group) placed.add(member.id);
  }
}

export async function runClustering(deps: ClusteringDeps): Promise<ClusteringRun> {
  const runs = AppDataSource.getRepository(ClusteringRun);
  const run = await runs.save({ status: "running" as const, startedAt: new Date() });
  let embedded = 0;
  let considered = 0;
  let assigned = 0;
  const tally = { seeded: 0, storiesCreated: 0 };

  try {
    embedded = await embedEligibleArticles(deps.embedder);
    await recomputeStoryCentroids();

    const candidates = await loadCandidates();
    considered = candidates.length;
    const excludedStoryIds = await curatedStoryIds();
    const seenSince = new Date(Date.now() - RECENCY_WINDOW_HOURS * 60 * 60 * 1000);
    const unassigned: Candidate[] = [];

    // ponytail: two round trips per candidate. Move scoring into one set query if
    // an hourly pass becomes slow; correctness does not need that complexity now.
    for (const candidate of candidates) {
      const nearest = await nearestStory(candidate.vector, seenSince, excludedStoryIds);
      if (
        nearest &&
        nearest.similarity >= SIMILARITY_THRESHOLD &&
        (await assignToStory(candidate, nearest.id, nearest.vector, nearest.similarity))
      ) {
        assigned += 1;
      } else {
        unassigned.push(candidate);
      }
    }

    await seedStories(unassigned, tally);
    if (assigned + tally.seeded > 0) await recomputeStoryCentroids();

    await runs.update(
      { id: run.id },
      {
        status: "succeeded",
        completedAt: new Date(),
        embedded,
        considered,
        assigned,
        seeded: tally.seeded,
        unclustered: considered - assigned - tally.seeded,
        storiesCreated: tally.storiesCreated,
        errorSummary: null,
      },
    );
  } catch (err) {
    await runs.update(
      { id: run.id },
      {
        status: "failed",
        completedAt: new Date(),
        embedded,
        considered,
        assigned,
        seeded: tally.seeded,
        unclustered: considered - assigned - tally.seeded,
        storiesCreated: tally.storiesCreated,
        errorSummary: err instanceof Error ? err.message : String(err),
      },
    );
  }

  return runs.findOneByOrFail({ id: run.id });
}

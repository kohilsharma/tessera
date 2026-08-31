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
  MAX_ARTICLES_PER_RUN,
  RECENCY_WINDOW_HOURS,
  SIMILARITY_THRESHOLD,
} from "./config";

// The one new seam in Phase 3's first ticket, in the same shape as ingestion's
// runConnector: a plain async function taking its dependencies and returning the
// ClusteringRun it persisted. Everything below it — the embedding step, centroid
// recomputation, assignment, seeding — is internal and has no seam of its own, so
// tests survive the pipeline being reorganised.
//
// The injected embedder is what lets the whole pipeline be driven against known
// vectors: similarity is the behaviour under test, and a provider that returns
// deterministic noise (the Mock) cannot state a threshold case either way.
export type ClusteringDeps = { embedder: EmbeddingProvider };

// The Articles this job may consider, in the terms the SQL below needs them.
type Candidate = {
  id: string;
  title: string;
  publisherId: string;
  publishedAt: Date;
  vector: number[];
};

// Cosine similarity, for the pairwise comparisons that seed a Story. Assignment
// against a centroid is a `<=>` in Postgres — an indexed nearest-neighbour lookup —
// but a group of candidates is an all-pairs question over vectors already in
// memory, and shipping n² casts to the database to answer it would be slower and
// no clearer.
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  // A zero vector has no direction, so it is similar to nothing rather than
  // infinitely similar to everything.
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

// pgvector's text output is a JSON array of numbers, so no parser of our own.
function parseVector(literal: string): number[] {
  return JSON.parse(literal) as number[];
}

// ADR-0026: embedding is the clustering job's own input step. A null vector means
// exactly one thing — needs embedding — because enrichment nulls it when it writes
// new text (ingestion/runConnector.ts).
//
// Freshest first, like ingestion's extraction backlog: a run is capped, so what it
// spends its provider requests on should be the reporting most likely to matter.
async function embedEligibleArticles(embedder: EmbeddingProvider): Promise<{ embedded: number; capped: boolean }> {
  const found = await AppDataSource.getRepository(Article)
    .createQueryBuilder("article")
    .select(["article.id", "article.title", "article.analysisText", "article.analysisTextMode"])
    .where(`article.embedding IS NULL`)
    .andWhere(`article."analysisTextMode" IN (:...modes)`, { modes: CLUSTERABLE_TEXT_MODES })
    .orderBy(`article."publishedAt"`, "DESC")
    // One past the cap, so "there is more waiting" is a fact this run read rather
    // than an inference from a full page of results.
    .limit(MAX_ARTICLES_PER_RUN + 1)
    .getMany();
  const pending = found.slice(0, MAX_ARTICLES_PER_RUN);

  let embedded = 0;
  for (let start = 0; start < pending.length; start += EMBED_BATCH_SIZE) {
    const batch = pending.slice(start, start + EMBED_BATCH_SIZE);
    // One request per batch, not per Article: hosted limits count requests
    // (ADR-0025), so this is what decides whether a backlog drains in a run or in
    // a day. Same title + text composition the seed embeds with, so a fixture and
    // an ingested Article sit in the same space.
    const vectors = await embedder.embedBatch(
      batch.map((article) => `${article.title}\n${article.analysisText ?? ""}`),
      "passage",
    );
    for (const [index, article] of batch.entries()) {
      // Conditioned on the rung it was embedded at, and on the vector still being
      // absent: an enrichment that raised this Article's text while the batch was
      // in flight has already nulled the vector, and writing a vector for the old
      // text over it would strand the new text unembedded. The next run picks it
      // up instead.
      //
      // TypeORM's postgres driver answers an UPDATE with `[rows, affectedCount]`,
      // which is the only thing here that says whether the guard held.
      const [, affected]: [unknown[], number] = await AppDataSource.query(
        `UPDATE "articles" SET "embedding" = $1::vector
         WHERE "id" = $2 AND "embedding" IS NULL AND "analysisTextMode" = $3`,
        [toVectorLiteral(vectors[index]), article.id, article.analysisTextMode],
      );
      embedded += affected;
    }
  }

  return { embedded, capped: found.length > MAX_ARTICLES_PER_RUN };
}

// ADR-0026: every Story carries a centroid recomputed from its members, including
// curated ones — the Curated Corpus is closed to changes in *membership*, not to
// having a centroid. One statement rather than a read-modify-write per Story:
// pgvector's own `avg` is what makes the mean a database operation.
//
// Every Story, not only those with vector-bearing members: a Story whose members'
// vectors were all cleared by enrichment must *lose* its centroid, or it keeps
// matching candidates against text Tessera no longer holds. The subquery answers
// NULL for exactly that case.
async function recomputeStoryCentroids(): Promise<void> {
  await AppDataSource.query(`
    UPDATE "stories" s
    SET "embedding" = (
      SELECT avg(a."embedding") FROM "articles" a WHERE a."storyId" = s."id" AND a."embedding" IS NOT NULL
    )
  `);
}

// The Articles this run will try to place: eligible, embedded, and not yet in a
// Story. An Article that matches nothing stays here and is reconsidered next run
// (ADR-0026), which is why nothing marks a candidate as tried.
async function loadCandidates(): Promise<{ candidates: Candidate[]; capped: boolean }> {
  const rows: { id: string; title: string; publisherId: string; publishedAt: Date; vector: string }[] =
    await AppDataSource.query(
      `SELECT "id", "title", "publisherId", "publishedAt", "embedding"::text AS vector
       FROM "articles"
       WHERE "storyId" IS NULL AND "embedding" IS NOT NULL AND "analysisTextMode" = ANY($1::varchar[])
       ORDER BY "publishedAt" DESC, "id" ASC
       LIMIT $2`,
      [CLUSTERABLE_TEXT_MODES, MAX_ARTICLES_PER_RUN + 1],
    );
  return {
    candidates: rows.slice(0, MAX_ARTICLES_PER_RUN).map((row) => ({
      id: row.id,
      title: row.title,
      publisherId: row.publisherId,
      publishedAt: row.publishedAt,
      vector: parseVector(row.vector),
    })),
    capped: rows.length > MAX_ARTICLES_PER_RUN,
  };
}

// ADR-0026 closes the Curated Corpus from both directions: its Articles are never
// clustered (they are `manual_fixture`, which is not a clusterable rung) and its
// Stories never accept a live Article. A fixture Story is exactly one that holds a
// fixture Article, read once per run rather than as a subquery per candidate.
async function curatedStoryIds(): Promise<string[]> {
  const rows: { storyId: string }[] = await AppDataSource.query(
    `SELECT DISTINCT "storyId" FROM "articles" WHERE "analysisTextMode" = 'manual_fixture' AND "storyId" IS NOT NULL`,
  );
  return rows.map((row) => row.storyId);
}

// One knob, with time as a gate (ADR-0026): the nearest live Story centroid, where
// "live" means last seen inside the recency window — a dormant Story is not a
// candidate at any similarity. `<=>` is cosine distance, so similarity is 1 minus
// it.
async function nearestStory(
  vector: number[],
  seenSince: Date,
  excludedStoryIds: string[],
): Promise<{ id: string; similarity: number } | null> {
  const rows: { id: string; similarity: string }[] = await AppDataSource.query(
    `SELECT "id", 1 - ("embedding" <=> $1::vector) AS similarity
     FROM "stories"
     WHERE "embedding" IS NOT NULL AND "lastSeenAt" >= $2 AND NOT ("id" = ANY($3::uuid[]))
     ORDER BY "embedding" <=> $1::vector
     LIMIT 1`,
    [toVectorLiteral(vector), seenSince, excludedStoryIds],
  );
  return rows.length === 0 ? null : { id: rows[0].id, similarity: Number(rows[0].similarity) };
}

// Membership and the Story's own span move together, so they move in one
// transaction: `firstSeenAt`/`lastSeenAt` are the read model browse sorts by and
// the gate above reads, and a Story holding an Article it does not span is a Story
// that can go dormant with fresh reporting in it.
// The `storyId IS NULL` guard is what makes the assignment idempotent: only the
// writer that still sees the Article unclustered counts it.
async function assignToStory(articleId: string, storyId: string, publishedAt: Date): Promise<boolean> {
  return AppDataSource.transaction(async (manager) => {
    const assigned = await manager
      .getRepository(Article)
      .createQueryBuilder()
      .update()
      .set({ storyId })
      .where(`"id" = :articleId AND "storyId" IS NULL`, { articleId })
      .execute();
    if (assigned.affected !== 1) return false;
    await manager.query(
      `UPDATE "stories"
       SET "firstSeenAt" = LEAST("firstSeenAt", $2), "lastSeenAt" = GREATEST("lastSeenAt", $2)
       WHERE "id" = $1`,
      [storyId, publishedAt],
    );
    return true;
  });
}

// A URL-safe slug, unique without a retry loop: the medoid's own id supplies the
// suffix, and an Article is the medoid of at most one Story.
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

// The member most central to the group — the one whose total similarity to the
// others is highest. ADR-0026 makes its title the new Story's name, deliberately
// as the *fallback* path: #51's model call replaces the naming step on machinery
// that already works. Ties break on id so a run is reproducible.
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

// ADR-0026: no singleton Stories. A new Story needs at least two mutually-matching
// Articles from at least two distinct Publishers — one outlet repeating itself is
// not corroboration, and a Story of one has nothing to synthesise comparatively
// (ADR-0010's two-publisher minimum, satisfied here by construction).
//
// The rule is structural rather than checked: the Story and its members are one
// transaction, and a group that ends up with fewer than two attached members from
// two Publishers takes the Story down with it. Only a member that was still
// Unclustered when the update ran counts, so a Story can never be published holding
// less corroboration than it claims.
//
// ponytail: the group is a star around its seed — every member matches the seed,
// which for the minimum case of two *is* mutual matching, since cosine is
// symmetric. For a larger group two outer members can both match the seed without
// matching each other. The ceiling is a slightly wider first Story than a clique
// would give; the upgrade path is connected components over the same pairwise
// scores, and the centroid recomputed next run is what pulls membership back
// toward the middle either way.
class GroupNotCorroborated extends Error {}

async function seedStory(group: Candidate[]): Promise<number> {
  try {
    return await AppDataSource.transaction(async (manager) => {
      const medoid = medoidOf(group);
      const story = await manager.getRepository(Story).save({
        slug: storySlug(medoid.title, medoid.id),
        title: medoid.title,
        // Nothing has synthesised this Story yet, and a summary made of one member's
        // text would be a claim nobody generated (ADR-0002).
        summary: null,
        category: DEFAULT_STORY_CATEGORY,
        // Replaced below by the span of the members that actually attached.
        firstSeenAt: medoid.publishedAt,
        lastSeenAt: medoid.publishedAt,
      });

      const attached: Candidate[] = [];
      for (const member of group) {
        const claimed = await manager
          .getRepository(Article)
          .createQueryBuilder()
          .update()
          .set({ storyId: story.id })
          .where(`"id" = :id AND "storyId" IS NULL`, { id: member.id })
          .execute();
        if (claimed.affected === 1) attached.push(member);
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
    // Not a fault: the group simply was not corroboration, and the transaction took
    // the Story and its part-assignments with it.
    if (err instanceof GroupNotCorroborated) return 0;
    throw err;
  }
}

// The seeding pass. Counts are reported into a caller-owned tally rather than
// returned, so a throw part-way through leaves the run's ledger describing what was
// actually committed — the Stories already seeded stay seeded, and saying otherwise
// would be a balanced sum that disagrees with the database.
async function seedStories(candidates: Candidate[], tally: { seeded: number; storiesCreated: number }): Promise<void> {
  const placed = new Set<string>();

  for (const seed of candidates) {
    if (placed.has(seed.id)) continue;
    const group = [
      seed,
      ...candidates.filter(
        (other) =>
          other.id !== seed.id &&
          !placed.has(other.id) &&
          cosineSimilarity(seed.vector, other.vector) >= SIMILARITY_THRESHOLD,
      ),
    ];
    // Not corroborated yet: the seed stays Unclustered and is reconsidered every
    // run, so the second outlet to report the same event is what creates the Story
    // rather than a threshold nudge.
    if (group.length < 2) continue;
    if (new Set(group.map((member) => member.publisherId)).size < 2) continue;

    const seeded = await seedStory(group);
    if (seeded === 0) continue;
    tally.seeded += seeded;
    tally.storiesCreated += 1;
    // Everything in the group is now accounted for: attached to this Story, or
    // already in another one, which is the only way the claim can have failed.
    for (const member of group) placed.add(member.id);
  }
}

// ADR-0026's hourly pass, end to end. Every Article it considered ends in exactly
// one of assigned / seeded / unclustered, which is what makes the persisted
// ClusteringRun's ledger sum to `considered` — including when the run fails
// part-way, where everything it did not reach is still Unclustered, because that
// is where it was left.
export async function runClustering(deps: ClusteringDeps): Promise<ClusteringRun> {
  const runs = AppDataSource.getRepository(ClusteringRun);
  const run = await runs.save({ status: "running" as const, startedAt: new Date() });

  const notes: string[] = [];
  let embedded = 0;
  let considered = 0;
  let assigned = 0;
  // Owned here rather than returned by the seeding pass, so a throw mid-seed still
  // leaves the ledger describing the Stories that were committed.
  const tally = { seeded: 0, storiesCreated: 0 };

  try {
    const embedding = await embedEligibleArticles(deps.embedder);
    embedded = embedding.embedded;
    if (embedding.capped) {
      notes.push(`hit the ${MAX_ARTICLES_PER_RUN}-article embedding cap: more Articles are waiting for a vector`);
    }

    // Before assignment, so a Story whose members were embedded a moment ago is a
    // candidate this run rather than next.
    await recomputeStoryCentroids();

    const pool = await loadCandidates();
    considered = pool.candidates.length;
    if (pool.capped) {
      notes.push(`hit the ${MAX_ARTICLES_PER_RUN}-article assignment cap: more Articles are waiting to be clustered`);
    }

    const excludedStoryIds = await curatedStoryIds();
    const seenSince = new Date(Date.now() - RECENCY_WINDOW_HOURS * 60 * 60 * 1000);
    const unassigned: Candidate[] = [];
    // ponytail: two round trips per candidate — the nearest-Story lookup and, where
    // it matches, the assignment. The ceiling is one run's latency at the
    // MAX_ARTICLES_PER_RUN cap; scoring the whole pool in one query against the
    // centroid table is the upgrade if an hourly pass ever runs long.
    for (const candidate of pool.candidates) {
      const nearest = await nearestStory(candidate.vector, seenSince, excludedStoryIds);
      if (nearest && nearest.similarity >= SIMILARITY_THRESHOLD) {
        // The score is read and dropped. ADR-0026 puts `storyAssignmentScore` on
        // `articles`, but nothing reads a score above the threshold: what it is for
        // is ranking the *pending* assignments in the Admin review queue, so the
        // column lands with #50, which is what introduces a band beneath this one.
        if (await assignToStory(candidate.id, nearest.id, candidate.publishedAt)) {
          assigned += 1;
          continue;
        }
      }
      unassigned.push(candidate);
    }

    // ponytail: centroids are not recomputed between assignments inside one run, so
    // a Story gaining five members is scored against the centroid it started the
    // run with. The ceiling is one run's worth of drift, closed by the recompute at
    // the top of the next run; recomputing per assignment is the upgrade if
    // membership within a single run turns out to matter.
    await seedStories(unassigned, tally);

    // Newly seeded Stories and newly grown ones both carry a centroid of their
    // members before this run ends, so nothing has to wait for the next tick to be
    // a complete row.
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
        errorSummary: notes.length > 0 ? notes.join("; ") : null,
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
        errorSummary: [...notes, err instanceof Error ? err.message : String(err)].join("; "),
      },
    );
  }

  return runs.findOneByOrFail({ id: run.id });
}

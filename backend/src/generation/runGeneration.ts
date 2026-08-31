import type { EntityManager } from "typeorm";
import { AppDataSource } from "../data-source";
import { AnalysisClaim, type ClaimType } from "../entities/AnalysisClaim";
import { ClaimEvidence } from "../entities/ClaimEvidence";
import type { AnalysisTextMode } from "../entities/Article";
import {
  GenerationRun,
  type GenerationFailureCode,
  type GenerationLens,
  type GenerationValidationResult,
} from "../entities/GenerationRun";
import { mayServeText, type TermsClass } from "../entities/Publisher";
import type { SelectionReason } from "../entities/EvidenceSetArticle";
import type { SynthesisProvider } from "../synthesis";
import { PROMPT_VERSION, SYNTHESIS_TIMEOUT_MS } from "./config";
import {
  freezeEvidence,
  frozenEvidenceChanged,
  evidenceContentHash,
  selectEvidence,
  type SelectedEvidence,
} from "./evidence";
import { analysisRequest } from "./prompt";
import { validateAnalysis, type ParsedClaim } from "./validate";

// The flagship, as one function: select evidence deterministically, freeze it, ask a
// model for claims about it, refuse anything whose citations do not resolve into what
// was frozen, and persist the whole attempt either way.
//
// Synchronous by decision, not by omission (ADR-0027): one request does the work and
// returns the finished run, so there is no queue, no polling, and no state a reader
// can catch halfway. Clustering's `runClustering` is the queued counterpart; the
// difference is that a reader is waiting for this one.
//
// The provider is injected for the same reason clustering's two are: it is the seam
// the test suite drives real failures through, with no network and no key.

export type GenerationDeps = {
  synth: SynthesisProvider;
  // What answered, as one label: `mock`, or the configured model id (see
  // synthesisProviderLabel). Recorded on the run and part of the reuse key.
  provider: string;
};

export type EvidenceView = {
  evidenceId: string;
  articleId: string;
  title: string;
  url: string;
  publishedAt: Date;
  publisher: { id: string; name: string; domain: string };
  sourceRank: number;
  selectionReason: SelectionReason;
  // The frozen snapshot, or null where the Publisher's Terms Class does not clear
  // that text for serving (#40). Held for analysis, not ours to redistribute.
  excerpt: string | null;
};

export type ClaimView = { id: string; claimType: ClaimType; text: string; citations: string[] };

export type GenerationView = {
  id: string;
  storyId: string;
  lens: GenerationLens;
  promptVersion: string;
  status: "completed" | "failed";
  // A closed vocabulary a reader can be shown. The detail behind it stays in
  // `failureMessage` on the row, which can carry a provider's own error text.
  failureCode: GenerationFailureCode | null;
  articleCount: number;
  distinctPublisherCount: number;
  evidence: EvidenceView[];
  claims: ClaimView[];
  completedAt: Date;
};

export type GenerationOutcome =
  // A Story with no accepted member carrying analysis text. Refused rather than
  // prompted over: there is nothing to cite, so nothing could be valid.
  | { status: "no_evidence" }
  | { status: "produced" | "reused"; view: GenerationView };

// ADR-0027's reuse key, whole: the Story, the Lens, the prompt version, the provider
// that would answer and the evidence hash. A completed run only — asking again after a
// failure must reach the provider, or a bad minute would cache itself.
//
// The provider is in the key because otherwise the first thing a demo does is cache
// itself: a clone with no key persists `[mock synthesis]` claims as a completed run,
// and adding SYNTHESIS_API_KEY would change nothing anybody can see.
//
// ponytail: two readers asking at the same moment both miss this and both pay, since
// nothing locks the Story for the length of a model call. The ceiling is one wasted
// call, not a wrong answer — the later run simply becomes the one reuse finds. An
// advisory lock on (storyId, lens) is the upgrade if that is ever measurable.
async function reusableRunId(
  storyId: string,
  lens: GenerationLens,
  provider: string,
  evidenceHash: string,
): Promise<string | null> {
  const rows: { id: string }[] = await AppDataSource.query(
    `SELECT r."id" FROM "generation_runs" r
       JOIN "evidence_sets" e ON e."id" = r."evidenceSetId"
      WHERE r."storyId" = $1 AND r."lens" = $2 AND r."promptVersion" = $3 AND r."provider" = $4
        AND r."status" = 'completed' AND e."contentHash" = $5
      ORDER BY r."completedAt" DESC
      LIMIT 1`,
    [storyId, lens, PROMPT_VERSION, provider, evidenceHash],
  );
  return rows[0]?.id ?? null;
}

type RunFields = {
  storyId: string;
  evidenceSetId: string;
  lens: GenerationLens;
  provider: string;
  triggeredByUserId: string | null;
  startedAt: Date;
  rawResponse: string | null;
  validationResult: GenerationValidationResult | null;
};

async function insertRun(
  manager: EntityManager,
  fields: RunFields,
  outcome:
    | { status: "completed" }
    | { status: "failed"; failureCode: GenerationFailureCode; failureMessage: string },
): Promise<GenerationRun> {
  return manager.getRepository(GenerationRun).save({
    ...fields,
    promptVersion: PROMPT_VERSION,
    completedAt: new Date(),
    ...outcome,
    ...(outcome.status === "completed" ? { failureCode: null, failureMessage: null } : {}),
  });
}

async function persistClaims(
  manager: EntityManager,
  runId: string,
  claims: ParsedClaim[],
  frozen: SelectedEvidence[],
): Promise<void> {
  const articleByEvidenceId = new Map(frozen.map((row) => [row.evidenceId, row.articleId]));
  for (const [displayOrder, claim] of claims.entries()) {
    const saved = await manager.getRepository(AnalysisClaim).save({
      generationRunId: runId,
      claimType: claim.claimType,
      text: claim.text,
      displayOrder,
    });
    await manager.getRepository(ClaimEvidence).insert(
      // Validation has already resolved every id into the frozen set, so the lookup
      // below cannot miss — the non-null assertion is that guarantee, not a hope.
      claim.citations.map((evidenceId) => ({
        claimId: saved.id,
        evidenceId,
        articleId: articleByEvidenceId.get(evidenceId)!,
      })),
    );
  }
}

export async function runGeneration(
  deps: GenerationDeps,
  request: { storyId: string; lens: GenerationLens; triggeredByUserId: string | null },
): Promise<GenerationOutcome> {
  const { storyId, lens, triggeredByUserId } = request;
  const selected = await selectEvidence(storyId);
  if (selected.length === 0) return { status: "no_evidence" };

  // Reuse is checked before anything is written: an EvidenceSet is only frozen for a
  // run that is actually going to happen.
  //
  // ponytail: reuse is the only thing standing between a reader and an unbounded bill
  // — nothing throttles this endpoint, so a loop over Stories, or one Story whose
  // members ingestion keeps enriching, pays per request. The ceiling is cost, not
  // correctness; a per-user rate limit is the upgrade, and it belongs beside the other
  // operator controls rather than inside the pipeline.
  const reused = await reusableRunId(storyId, lens, deps.provider, evidenceContentHash(selected));
  if (reused) return { status: "reused", view: await loadGenerationView(reused) };

  const evidenceSet = await freezeEvidence(storyId, selected);
  const startedAt = new Date();
  const base: RunFields = {
    storyId,
    evidenceSetId: evidenceSet.id,
    lens,
    provider: deps.provider,
    triggeredByUserId,
    startedAt,
    rawResponse: null,
    validationResult: null,
  };

  let raw: string;
  try {
    raw = await deps.synth.complete({ ...analysisRequest(selected, lens), timeoutMs: SYNTHESIS_TIMEOUT_MS });
  } catch (err) {
    // Includes the timeout: an AbortError arrives here like any other. The message is
    // recorded for an Admin and never returned — it can name hosts and models.
    const run = await insertRun(AppDataSource.manager, base, {
      status: "failed",
      failureCode: "provider_error",
      failureMessage: err instanceof Error ? err.message : String(err),
    });
    return { status: "produced", view: await loadGenerationView(run.id) };
  }

  const validated = validateAnalysis(raw, lens, new Set(selected.map((row) => row.evidenceId)));
  const withAnswer: RunFields = { ...base, rawResponse: raw, validationResult: validated.result };
  if (!validated.ok) {
    const run = await insertRun(AppDataSource.manager, withAnswer, {
      status: "failed",
      failureCode: validated.failureCode,
      failureMessage: validated.failureMessage,
    });
    return { status: "produced", view: await loadGenerationView(run.id) };
  }

  const runId = await AppDataSource.transaction(async (manager) => {
    // v3 §16.5's last check, inside the transaction that would otherwise persist the
    // claims: an Article whose text changed, or which is no longer a member of this
    // Story, while the model was answering makes this analysis a description of
    // something Tessera no longer holds.
    if (await frozenEvidenceChanged(manager, storyId, selected)) {
      const failed = await insertRun(manager, withAnswer, {
        status: "failed",
        failureCode: "content_changed",
        failureMessage: "An Article's text changed, or it left this Story, after its evidence was frozen",
      });
      return failed.id;
    }
    const run = await insertRun(manager, withAnswer, { status: "completed" });
    await persistClaims(manager, run.id, validated.claims, selected);
    return run.id;
  });

  return { status: "produced", view: await loadGenerationView(runId) };
}

type EvidenceRow = {
  evidenceId: string;
  articleId: string;
  title: string;
  url: string;
  publishedAt: Date;
  sourceRank: number;
  selectionReason: SelectionReason;
  includedExcerptSnapshot: string;
  analysisTextMode: AnalysisTextMode;
  publisherId: string;
  publisherName: string;
  publisherDomain: string;
  termsClass: TermsClass;
};

// One reader for both paths — a run just produced and a run being reused — so a
// reused analysis is byte-identical to the one that was generated.
export async function loadGenerationView(runId: string): Promise<GenerationView> {
  const run = await AppDataSource.getRepository(GenerationRun).findOneOrFail({
    where: { id: runId },
    relations: { evidenceSet: true },
  });

  // Ordered by rank, which is the order the evidence ids were assigned in, so A1
  // comes first without sorting `A10` before `A2` the way a lexical sort would.
  const evidence: EvidenceRow[] = await AppDataSource.query(
    `SELECT esa."evidenceId", esa."articleId", esa."sourceRank", esa."selectionReason",
            esa."includedExcerptSnapshot", a."title", a."url", a."publishedAt", a."analysisTextMode",
            p."id" AS "publisherId", p."name" AS "publisherName", p."domain" AS "publisherDomain", p."termsClass"
       FROM "evidence_set_articles" esa
       JOIN "articles" a ON a."id" = esa."articleId"
       JOIN "publishers" p ON p."id" = a."publisherId"
      WHERE esa."evidenceSetId" = $1
      ORDER BY esa."sourceRank" ASC`,
    [run.evidenceSetId],
  );

  // Two things at once. The join to the frozen rows is the invariant holding a second
  // time, at the last point before a reader sees anything: a citation that does not
  // resolve into this run's own EvidenceSet is not rendered, and a claim left with
  // none is not shown at all. Nothing should be able to do that — validation refuses
  // an uncited claim before it is persisted — which is exactly why it is worth being
  // structurally impossible here too.
  //
  // And the citations come back in evidence-rank order rather than by id, so a set of
  // ten does not read `A1, A10, A2`.
  const claims: ClaimView[] = await AppDataSource.query(
    `SELECT c."id", c."claimType", c."text",
            array_agg(ce."evidenceId" ORDER BY esa."sourceRank") AS citations
       FROM "analysis_claims" c
       JOIN "claim_evidence" ce ON ce."claimId" = c."id"
       JOIN "evidence_set_articles" esa
         ON esa."evidenceSetId" = $2 AND esa."evidenceId" = ce."evidenceId"
      WHERE c."generationRunId" = $1
      GROUP BY c."id", c."claimType", c."text", c."displayOrder"
      ORDER BY c."displayOrder" ASC`,
    [runId, run.evidenceSetId],
  );

  return {
    id: run.id,
    storyId: run.storyId,
    lens: run.lens,
    promptVersion: run.promptVersion,
    status: run.status,
    failureCode: run.failureCode,
    articleCount: run.evidenceSet.articleCount,
    distinctPublisherCount: run.evidenceSet.distinctPublisherCount,
    evidence: evidence.map((row) => ({
      evidenceId: row.evidenceId,
      articleId: row.articleId,
      title: row.title,
      url: row.url,
      publishedAt: row.publishedAt,
      sourceRank: row.sourceRank,
      selectionReason: row.selectionReason,
      // Rights are decided at serve time, not at freeze time: the frozen snapshot is
      // what the analysis rests on either way, and whether it may be shown is the
      // Publisher's Terms Class now (#40).
      excerpt: mayServeText(row.termsClass, row.analysisTextMode) ? row.includedExcerptSnapshot : null,
      publisher: { id: row.publisherId, name: row.publisherName, domain: row.publisherDomain },
    })),
    claims,
    completedAt: run.completedAt,
  };
}

import type { EntityManager } from "typeorm";
import { AppDataSource } from "../data-source";
import { AnalysisClaim, type ClaimType } from "../entities/AnalysisClaim";
import { ClaimEvidence, type ClaimEvidenceRelationship } from "../entities/ClaimEvidence";
import { carriesFullPermittedText, type AnalysisTextMode } from "../entities/Article";
import {
  GenerationRun,
  type GenerationFailureCode,
  type GenerationLens,
  type GenerationValidationResult,
} from "../entities/GenerationRun";
import { mayServeText, type TermsClass } from "../entities/Publisher";
import type { SelectionReason } from "../entities/EvidenceSetArticle";
import type { SynthesisProvider } from "../synthesis";
import { MAX_REPAIR_ATTEMPTS, MIN_DISTINCT_PUBLISHERS, PROMPT_VERSION, SYNTHESIS_TIMEOUT_MS } from "./config";
import {
  distinctPublisherCount,
  evidenceDataMode,
  freezeEvidence,
  frozenEvidenceChanged,
  evidenceContentHash,
  selectEvidence,
  type SelectedEvidence,
} from "./evidence";
import { analysisRequest, repairRequest } from "./prompt";
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
  // The provider origin and model that answered. Both are recorded and both take
  // part in reuse because model ids are not globally unique.
  provider: string;
  model: string;
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

export type CitationSide = { relationship: ClaimEvidenceRelationship; citations: string[] };
export type ClaimView = {
  id: string;
  claimType: ClaimType;
  text: string;
  citations: string[];
  // Null for non-contradictions and for generations created before polarity was
  // persisted. New contradiction claims always carry both sides.
  citationSides: CitationSide[] | null;
};

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
  // v3 §16.2's minimum, refused for the same reason and at the same point: after the
  // wire-copy collapse there is one newsroom here, and "how the outlets compared" is
  // not a question one outlet can answer. Nothing is frozen and nothing is paid for.
  | { status: "insufficient_publishers" }
  | { status: "produced" | "reused"; view: GenerationView };

// ADR-0027's reuse key, whole: the Story, the Lens, the prompt version, the provider
// that would answer and the evidence hash. A completed run only — asking again after a
// failure must reach the provider, or a bad minute would cache itself.
//
// The provider is in the key because otherwise the first thing a demo does is cache
// itself: a clone with no key persists `[mock synthesis]` claims as a completed run,
// and adding SYNTHESIS_API_KEY would change nothing anybody can see.
async function reusableRunId(
  storyId: string,
  lens: GenerationLens,
  provider: string,
  model: string,
  evidenceHash: string,
): Promise<string | null> {
  const rows: { id: string }[] = await AppDataSource.query(
    `SELECT r."id" FROM "generation_runs" r
       JOIN "evidence_sets" e ON e."id" = r."evidenceSetId"
      WHERE r."storyId" = $1 AND r."lens" = $2 AND r."promptVersion" = $3
        AND r."provider" = $4 AND r."model" = $5
        AND r."status" = 'completed' AND e."contentHash" = $6
        AND NOT EXISTS (
          SELECT 1 FROM "evidence_set_articles" legacy
           WHERE legacy."evidenceSetId" = e."id" AND legacy."titleSnapshot" IS NULL
        )
      ORDER BY r."completedAt" DESC
      LIMIT 1`,
    [storyId, lens, PROMPT_VERSION, provider, model, evidenceHash],
  );
  return rows[0]?.id ?? null;
}

type RunFields = {
  storyId: string;
  evidenceSetId: string;
  lens: GenerationLens;
  provider: string;
  model: string;
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
      claim.citations.map(({ evidenceId, relationship }) => ({
        claimId: saved.id,
        evidenceId,
        articleId: articleByEvidenceId.get(evidenceId)!,
        relationship,
      })),
    );
  }
}

// ponytail: the app is one native process (ADR-0015), so coalescing in memory
// avoids holding a database connection across a model call. Use a distributed
// request lock if the app is ever horizontally scaled.
const inFlightGenerations = new Map<string, Promise<GenerationOutcome>>();

async function generateOnce(
  deps: GenerationDeps,
  request: { storyId: string; lens: GenerationLens; triggeredByUserId: string | null },
): Promise<GenerationOutcome> {
  const { storyId, lens, triggeredByUserId } = request;
  const selected = await selectEvidence(storyId);
  if (selected.length === 0) return { status: "no_evidence" };
  if (distinctPublisherCount(selected) < MIN_DISTINCT_PUBLISHERS) return { status: "insufficient_publishers" };
  const dataMode = evidenceDataMode(selected);

  // Reuse is checked before anything is written: an EvidenceSet is only frozen for a
  // run that is actually going to happen.
  //
  // ponytail: reuse is the only thing standing between a reader and an unbounded bill
  // — nothing throttles this endpoint, so a loop over Stories, or one Story whose
  // members ingestion keeps enriching, pays per request. The ceiling is cost, not
  // correctness; a per-user rate limit is the upgrade, and it belongs beside the other
  // operator controls rather than inside the pipeline.
  const reused = await reusableRunId(
    storyId,
    lens,
    deps.provider,
    deps.model,
    evidenceContentHash(selected),
  );
  if (reused) return { status: "reused", view: await loadGenerationView(reused) };

  const evidenceSet = await freezeEvidence(storyId, selected);
  const startedAt = new Date();
  const base: RunFields = {
    storyId,
    evidenceSetId: evidenceSet.id,
    lens,
    provider: deps.provider,
    model: deps.model,
    triggeredByUserId,
    startedAt,
    rawResponse: null,
    validationResult: null,
  };

  // ADR-0027's repair loop: the first ask, then up to two more, each re-prompting with
  // the *specific* validation error rather than climbing to a stronger model — there is
  // no dependable stronger rung to climb to (ADR-0025).
  //
  // One deadline across all of them, not one per call: SYNTHESIS_TIMEOUT_MS is the
  // promise made to a reader who is waiting. Each call gets an equal share of the
  // remaining budget, reserving time for both required repairs.
  const deadline = startedAt.getTime() + SYNTHESIS_TIMEOUT_MS;
  const frozenEvidence = new Map(selected.map((row) => [row.evidenceId, row.publisherId]));
  const fullPermittedText = carriesFullPermittedText(dataMode);
  let raw = "";
  let refusal: string | null = null;
  // What the run knows so far, carried across attempts: a provider that throws on a
  // repair must not erase the answer that provoked the repair. That answer and its
  // measurement are the only record a claim was ever returned and dropped, and the
  // input the eval harness reads (ADR-0027).
  let recorded: RunFields = base;
  let accumulatedValidation: GenerationValidationResult | null = null;

  for (let repairAttempts = 0; ; repairAttempts += 1) {
    const ask =
      refusal === null
        ? analysisRequest(selected, lens, dataMode)
        : repairRequest(selected, lens, dataMode, raw, refusal);
    try {
      const attemptsLeft = 1 + MAX_REPAIR_ATTEMPTS - repairAttempts;
      raw = await deps.synth.complete({
        ...ask,
        timeoutMs: Math.max(1, Math.floor((deadline - Date.now()) / attemptsLeft)),
      });
    } catch (err) {
      // Includes the timeout: an AbortError arrives here like any other. The message is
      // recorded for an Admin and never returned — it can name hosts and models. Not
      // repaired: a provider that did not answer has said nothing to correct.
      const run = await insertRun(AppDataSource.manager, recorded, {
        status: "failed",
        failureCode: "provider_error",
        failureMessage: err instanceof Error ? err.message : String(err),
      });
      return { status: "produced", view: await loadGenerationView(run.id) };
    }

    const validated = validateAnalysis(raw, lens, frozenEvidence, { fullPermittedText });
    accumulatedValidation = accumulatedValidation
      ? {
          claimsReturned: accumulatedValidation.claimsReturned + validated.result.claimsReturned,
          claimsAccepted: accumulatedValidation.claimsAccepted + validated.result.claimsAccepted,
          claimsRejected: accumulatedValidation.claimsRejected + validated.result.claimsRejected,
          unknownEvidenceIds: [
            ...new Set([...accumulatedValidation.unknownEvidenceIds, ...validated.result.unknownEvidenceIds]),
          ],
          repairAttempts,
          issues: [...accumulatedValidation.issues, ...validated.result.issues],
        }
      : { ...validated.result, repairAttempts };
    const withAnswer: RunFields = {
      ...base,
      rawResponse: raw,
      validationResult: accumulatedValidation,
    };

    if (!validated.ok) {
      if (repairAttempts < MAX_REPAIR_ATTEMPTS) {
        refusal = validated.failureMessage;
        recorded = withAnswer;
        continue;
      }
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
}

export async function runGeneration(
  deps: GenerationDeps,
  request: { storyId: string; lens: GenerationLens; triggeredByUserId: string | null },
): Promise<GenerationOutcome> {
  const key = JSON.stringify([request.storyId, request.lens, PROMPT_VERSION, deps.provider, deps.model]);
  const inFlight = inFlightGenerations.get(key);
  if (inFlight) {
    const outcome = await inFlight;
    // A refusal is the same refusal for both callers, and has no run to call reused.
    return outcome.status === "produced" ? { status: "reused", view: outcome.view } : outcome;
  }

  const generation = generateOnce(deps, request);
  inFlightGenerations.set(key, generation);
  try {
    return await generation;
  } finally {
    if (inFlightGenerations.get(key) === generation) inFlightGenerations.delete(key);
  }
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
            esa."includedExcerptSnapshot", esa."titleSnapshot" AS "title", esa."urlSnapshot" AS "url",
            esa."publishedAtSnapshot" AS "publishedAt", esa."analysisTextModeSnapshot" AS "analysisTextMode",
            esa."publisherIdSnapshot" AS "publisherId", esa."publisherNameSnapshot" AS "publisherName",
            esa."publisherDomainSnapshot" AS "publisherDomain", p."termsClass"
       FROM "evidence_set_articles" esa
       JOIN "publishers" p ON p."id" = esa."publisherIdSnapshot"
      WHERE esa."evidenceSetId" = $1
      ORDER BY esa."sourceRank" ASC`,
    [run.evidenceSetId],
  );
  if (evidence.length !== run.evidenceSet.articleCount) {
    throw new Error(`GenerationRun ${run.id} has no frozen provenance snapshot`);
  }

  // Two things at once. The join to the frozen rows is the invariant holding a second
  // time, at the last point before a reader sees anything: a citation that does not
  // resolve into this run's own EvidenceSet is not rendered, and a claim left with
  // none is not shown at all. Nothing should be able to do that — validation refuses
  // an uncited claim before it is persisted — which is exactly why it is worth being
  // structurally impossible here too.
  //
  // And the citations come back in evidence-rank order rather than by id, so a set of
  // ten does not read `A1, A10, A2`.
  type ClaimRow = Omit<ClaimView, "citationSides"> & {
    relationships: (ClaimEvidenceRelationship | null)[];
  };
  const claimRows: ClaimRow[] = await AppDataSource.query(
    `SELECT c."id", c."claimType", c."text",
            array_agg(ce."evidenceId" ORDER BY esa."sourceRank") AS citations,
            array_agg(ce."relationship" ORDER BY esa."sourceRank") AS relationships
       FROM "analysis_claims" c
       JOIN "claim_evidence" ce ON ce."claimId" = c."id"
       JOIN "evidence_set_articles" esa
         ON esa."evidenceSetId" = $2 AND esa."evidenceId" = ce."evidenceId"
      WHERE c."generationRunId" = $1
      GROUP BY c."id", c."claimType", c."text", c."displayOrder"
      ORDER BY c."displayOrder" ASC`,
    [runId, run.evidenceSetId],
  );
  const claims: ClaimView[] = claimRows.map(({ relationships, ...claim }) => {
    if (claim.claimType !== "contradiction" || relationships.some((relationship) => relationship === null)) {
      return { ...claim, citationSides: null };
    }
    const citationSides = (["supports", "contradicts"] as const)
      .map((relationship) => ({
        relationship,
        citations: claim.citations.filter((_citation, index) => relationships[index] === relationship),
      }))
      .filter((side) => side.citations.length > 0);
    return { ...claim, citationSides: citationSides.length === 2 ? citationSides : null };
  });

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

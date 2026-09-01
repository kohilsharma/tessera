import { AppDataSource } from "../data-source";
import { CORE_CLAIM_TYPES, type CoreClaimType } from "../entities/AnalysisClaim";
import { DEFAULT_PROMPT_PARAMS, PromptTemplate, type PromptParams } from "../entities/PromptTemplate";
import {
  MAX_REQUESTED_CLAIMS,
  MIN_SURVIVING_CLAIMS,
  PROMPT_VERSION,
  TUNED_TEXT_MAX_LENGTH,
} from "./config";
import { withoutCitationBrackets } from "./evidence";

// ADR-0021's Admin tuning surface, and the boundary that keeps it safe (#57).
//
// Two things live here and nothing else: reading the current PromptTemplate, and
// deciding whether a proposed one may exist. The second is where the guardrail is
// enforceable — validate.ts has no idea this file exists, so the only way tuning could
// reach the citation layer is by asking for parameters that make a publishable answer
// impossible. That is what the bounds below refuse.

export type CurrentTemplate = { version: string; params: PromptParams };

// The shipped template, used when no row is current. CreatePromptTemplates inserts this
// as a row, so on a migrated database this is a definition rather than a code path —
// but the flagship must not be takeable down by a missing configuration row.
const SHIPPED: CurrentTemplate = { version: PROMPT_VERSION, params: DEFAULT_PROMPT_PARAMS };

export async function loadCurrentTemplate(): Promise<CurrentTemplate> {
  const current = await AppDataSource.getRepository(PromptTemplate).findOne({ where: { isCurrent: true } });
  return current ? { version: current.version, params: current.params } : SHIPPED;
}

// A label, not a paragraph: it is recorded on every run, shown beside a past analysis,
// and read back out of the reuse key.
const VERSION_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isVersionLabel(value: unknown): value is string {
  return typeof value === "string" && VERSION_LABEL.test(value);
}

// Tuned text, made safe to concatenate into a prompt: collapsed to one line and with
// brackets neutralised. Newlines would let a tuned clause pose as further instructions,
// and a `[A9]` in it would be read back as an evidence id by MockSynthesisProvider —
// neither is a citation-validation bypass (an id outside the frozen set is refused below
// the prompt), but both would make the prompt lie about its own shape.
function promptSafeClause(text: string): string {
  return withoutCitationBrackets(text.replace(/\s+/g, " ").trim());
}

export type ParsedParams = { ok: true; params: PromptParams } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The one place a tuned prompt is accepted or refused. Every refusal below is a
// parameter that would make validation unsatisfiable — which is the only way "tune
// responses" could become "disable the check that makes cheap models safe" (ADR-0021).
export function parsePromptParams(input: unknown): ParsedParams {
  if (!isRecord(input)) return { ok: false, error: "params must be an object" };
  const { tone, lensEmphasis, claimCount, surfacedClaimTypes } = input;

  if (typeof tone !== "string" || typeof lensEmphasis !== "string") {
    return { ok: false, error: "tone and lensEmphasis must both be strings, and either may be empty" };
  }
  if (tone.length > TUNED_TEXT_MAX_LENGTH || lensEmphasis.length > TUNED_TEXT_MAX_LENGTH) {
    return { ok: false, error: `tone and lensEmphasis are limited to ${TUNED_TEXT_MAX_LENGTH} characters each` };
  }

  if (!isRecord(claimCount) || !Number.isInteger(claimCount.min) || !Number.isInteger(claimCount.max)) {
    return { ok: false, error: "claimCount must be an object with whole-number min and max" };
  }
  const min = claimCount.min as number;
  const max = claimCount.max as number;
  // The floor is validation's own floor. Below it every run would fail on the claim
  // floor no matter what the model returned, so this is not a tuning choice being
  // refused — it is a prompt that could never produce a publishable analysis.
  if (min < MIN_SURVIVING_CLAIMS) {
    return {
      ok: false,
      error: `claimCount.min cannot be below ${MIN_SURVIVING_CLAIMS}: fewer surviving claims than that is refused below the prompt, so every run would fail`,
    };
  }
  if (max > MAX_REQUESTED_CLAIMS) {
    return { ok: false, error: `claimCount.max cannot be above ${MAX_REQUESTED_CLAIMS}` };
  }
  if (min > max) return { ok: false, error: "claimCount.min cannot be above claimCount.max" };

  if (
    !Array.isArray(surfacedClaimTypes) ||
    surfacedClaimTypes.some((claimType) => !(CORE_CLAIM_TYPES as readonly unknown[]).includes(claimType))
  ) {
    return { ok: false, error: `surfacedClaimTypes must be a list drawn from: ${CORE_CLAIM_TYPES.join(", ")}` };
  }
  // Same reasoning as the claim floor: an analysis needs one surviving consensus claim,
  // so a prompt that never asks for one is a prompt whose every run fails.
  if (!surfacedClaimTypes.includes("consensus")) {
    return {
      ok: false,
      error: "surfacedClaimTypes must include consensus: an analysis is refused below the prompt without one",
    };
  }

  return {
    ok: true,
    params: {
      tone: promptSafeClause(tone),
      lensEmphasis: promptSafeClause(lensEmphasis),
      claimCount: { min, max },
      // Deduplicated and in the canonical order, so two spellings of the same tuning
      // produce the same prompt.
      surfacedClaimTypes: CORE_CLAIM_TYPES.filter((claimType) =>
        (surfacedClaimTypes as CoreClaimType[]).includes(claimType),
      ),
    },
  };
}

export type TemplateCreation = { status: "created"; template: PromptTemplate } | { status: "duplicate_version" };

// Created, never current: activation is its own decision (v3 §11.6's create/activate),
// so a version can be staged and read before every reader gets it.
export async function createPromptTemplate(
  version: string,
  params: PromptParams,
  createdByUserId: string | null,
): Promise<TemplateCreation> {
  const templates = AppDataSource.getRepository(PromptTemplate);
  try {
    return { status: "created", template: await templates.save({ version, params, createdByUserId }) };
  } catch (err) {
    // The UNIQUE constraint is what actually decides this, not a prior SELECT: a label
    // must resolve to one set of parameters, and losing a race must not create the row
    // that breaks it.
    if ((err as { code?: string }).code === "23505") return { status: "duplicate_version" };
    throw err;
  }
}

// The one mutation on this table: activation. Clears whatever was current, then sets the
// named row; the partial unique index permits at most one current row.
//
// There is deliberately no deactivation (#57 asks to "set which version is current", and
// nothing else): a table with no current row is a state no acceptance criterion describes,
// and it would leave generation on the shipped fallback below rather than on a version an
// operator chose. Superseding a version means activating another one.
//
// The advisory lock keeps concurrent activations deterministic rather than surfacing a
// unique violation. This is an operator button, not a hot path.
export async function setPromptTemplateCurrent(id: string): Promise<PromptTemplate | null> {
  return AppDataSource.transaction(async (manager) => {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext('prompt_templates.isCurrent'))`);
    const templates = manager.getRepository(PromptTemplate);
    const held = await templates.findOneBy({ id });
    if (!held) return null;
    await templates.update({ isCurrent: true }, { isCurrent: false });
    await templates.update({ id }, { isCurrent: true });
    return { ...held, isCurrent: true };
  });
}

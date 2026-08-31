import { AppDataSource } from "../data-source";
import { GenerationRun } from "../entities/GenerationRun";
import type { UserRole } from "../entities/User";
import { lensForRole } from "./config";
import { isUuid } from "../lib/uuid";

// The rule every door into a past analysis applies, in one place. There are three of
// them now — generating one (routes/generation.ts), saving one into a Brief (#55) and
// making flashcards from one (#58) — and the reason is the same at each: a Lens is
// the reader's role (ADR-0027), so serving a reader claims written under the other
// Lens would be letting them read as somebody else, which is exactly what asking for
// that Lens is refused for. An Admin reaches none of these doors: they have no Lens
// of their own, and own no artefacts (ADR-0004).
//
// A failed run is refused too: it has no claims, and ADR-0010's stated unavailable
// state is where a failure belongs — not inside something a reader keeps.
export async function loadReaderRun(
  generationRunId: unknown,
  role: UserRole,
): Promise<{ ok: true; run: GenerationRun } | { ok: false; error: string }> {
  if (typeof generationRunId !== "string" || !isUuid(generationRunId)) {
    return { ok: false, error: "generationRunId must be a valid analysis id" };
  }
  const run = await AppDataSource.getRepository(GenerationRun).findOne({
    where: { id: generationRunId },
    relations: { story: true },
  });
  if (!run) return { ok: false, error: "generationRunId must reference an existing analysis" };
  if (run.status !== "completed") {
    return { ok: false, error: "Only a completed analysis can be used" };
  }
  if (run.lens !== lensForRole(role)) {
    return { ok: false, error: "This analysis was written for a different Lens than your own" };
  }
  return { ok: true, run };
}

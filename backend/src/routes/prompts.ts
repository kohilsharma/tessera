import { Router } from "express";
import {
  createPromptTemplate,
  isVersionLabel,
  setPromptTemplateCurrent,
  parsePromptParams,
} from "../generation/template";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { isUuid } from "../lib/uuid";

export const promptsRouter = Router();

// ADR-0021's Admin tuning surface (#57): an Admin shapes what every reader gets — tone,
// how many claims, what the Lens weighs, which claim types are asked for — without a
// deploy. What they cannot reach from here is the citation validation layer, which lives
// below the prompt in src/generation/validate.ts and takes no configuration at all.
//
// ADR-0004: a Student or Investor gets 403 on every route here, an anonymous caller 401.
// The list is served on the Admin dashboard payload, which is guarded the same way — so
// there is no GET here: a version is read where it is operated, beside the runs it
// produced.
const adminOnly = [requireAuth, requireRole("admin")] as const;

// Create separately from current-state changes so a version can be staged and read
// before every reader is served under it.
promptsRouter.post(
  "/prompt-templates",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const { version, params } = (req.body ?? {}) as Record<string, unknown>;
    if (!isVersionLabel(version)) {
      res.status(422).json({
        error: "version must be a label of up to 64 letters, digits, dots, dashes or underscores",
      });
      return;
    }
    const parsed = parsePromptParams(params);
    if (!parsed.ok) {
      res.status(422).json({ error: parsed.error });
      return;
    }

    const created = await createPromptTemplate(version, parsed.params, req.user!.id);
    // A version label is how a past run is traced back to the parameters that wrote it,
    // so a second set of parameters under a label already in use is a conflict rather
    // than an update. Tuning again means a new version.
    if (created.status === "duplicate_version") {
      res.status(409).json({ error: `Prompt version "${version}" already exists` });
      return;
    }
    res.status(201).json(created.template);
  }),
);

// Activation or deactivation. PATCH on the version rather than a command route, the
// same shape as a connector's `enabled` (#39). With none current, generation uses the
// shipped prompt; a fresh database still gets that version as a current row.
promptsRouter.patch(
  "/prompt-templates/:id",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const isCurrent = (req.body ?? {}).isCurrent;
    if (typeof isCurrent !== "boolean") {
      res.status(422).json({ error: "isCurrent must be true or false" });
      return;
    }
    if (!isUuid(req.params.id)) {
      res.status(404).json({ error: "Prompt version not found" });
      return;
    }

    const updated = await setPromptTemplateCurrent(req.params.id, isCurrent);
    if (!updated) {
      res.status(404).json({ error: "Prompt version not found" });
      return;
    }
    res.json(updated);
  }),
);

import { randomUUID } from "node:crypto";
import { Response, Router } from "express";
import multer from "multer";
import { AppDataSource } from "../data-source";
import { BriefArticle } from "../entities/BriefArticle";
import { Article } from "../entities/Article";
import { BRIEF_CATEGORIES, DEFAULT_ARTICLE_CAPACITY_LIMIT, IntelligenceBrief } from "../entities/IntelligenceBrief";
import type { StoryCategory } from "../entities/Story";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { toPublicArticle } from "../lib/articleView";
import { IMAGE_MIME_TYPES, sniffImageType } from "../lib/imageValidation";
import { paginate, parseListQuery, toEnvelope } from "../lib/listQuery";
import { isUuid } from "../lib/uuid";
import { LocalDiskFileStorageProvider } from "../storage/LocalDiskFileStorageProvider";
import type { FileStorageProvider } from "../storage/FileStorageProvider";

export const briefsRouter = Router();

const storage: FileStorageProvider = new LocalDiskFileStorageProvider();

// spec v3 §34.4 "Cover image maximum | 2 MB". Client-claimed mimetype is only a
// fast pre-filter here; sniffImageType() checks the real bytes below.
const MAX_COVER_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_COVER_IMAGE_MIME_TYPES = new Set(IMAGE_MIME_TYPES);

const uploadCoverImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_COVER_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_COVER_IMAGE_MIME_TYPES.has(file.mimetype)) {
      cb(new Error("coverImage must be a JPEG, PNG, or WEBP image"));
      return;
    }
    cb(null, true);
  },
});

// Mirrors routes/auth.ts's isUniqueViolation: parseBriefInput mirrors every one
// of the migration's CHECK constraints, so this path is a backstop, not the
// primary gate — but the acceptance criteria calls out "backed by DB
// constraints" explicitly, so a constraint that does fire must still 422.
const PG_CHECK_VIOLATION = "23514";

function isCheckViolation(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string } } | null;
  return (e?.code ?? e?.driverError?.code) === PG_CHECK_VIOLATION;
}

function briefRepo() {
  return AppDataSource.getRepository(IntelligenceBrief);
}

function briefArticleRepo() {
  return AppDataSource.getRepository(BriefArticle);
}

// Shared by every write endpoint below that needs to hand back the Brief's
// current state: re-reads it (rather than reusing the pre-write copy) so the
// response always reflects what the write actually committed.
async function respondWithBrief(res: Response, briefId: string) {
  const updated = await briefRepo().findOneOrFail({ where: { id: briefId } });
  const articleCount = await briefArticleRepo().count({ where: { briefId } });
  res.json(toPublicBrief(updated, articleCount));
}

function toPublicBrief(brief: IntelligenceBrief, articleCount: number) {
  return {
    id: brief.id,
    title: brief.title,
    note: brief.note,
    category: brief.category,
    articleCapacityLimit: brief.articleCapacityLimit,
    coverImageKey: brief.coverImageKey,
    coverImageUrl: brief.coverImageKey ? storage.url(brief.coverImageKey) : null,
    ownerId: brief.ownerId,
    articleCount,
    createdAt: brief.createdAt,
    updatedAt: brief.updatedAt,
  };
}

type BriefInput = { title: string; note: string | null; category: StoryCategory; articleCapacityLimit: number };

// `isCreate` widens which fields are required: create needs title+category (note
// and articleCapacityLimit fall back to defaults), update accepts any subset.
function parseBriefInput(
  body: unknown,
  isCreate: boolean,
): { ok: true; value: Partial<BriefInput> } | { ok: false; error: string } {
  const errors: string[] = [];
  const input = (body ?? {}) as Record<string, unknown>;
  const value: Partial<BriefInput> = {};

  if (isCreate || input.title !== undefined) {
    if (typeof input.title !== "string" || input.title.trim().length === 0) {
      errors.push("title is required");
    } else {
      value.title = input.title;
    }
  }

  if (input.note !== undefined) {
    if (input.note !== null && typeof input.note !== "string") errors.push("note must be a string or null");
    else value.note = input.note as string | null;
  } else if (isCreate) {
    value.note = null;
  }

  if (isCreate || input.category !== undefined) {
    if (typeof input.category !== "string" || !BRIEF_CATEGORIES.includes(input.category as StoryCategory)) {
      errors.push(`category must be one of: ${BRIEF_CATEGORIES.join(", ")}`);
    } else {
      value.category = input.category as StoryCategory;
    }
  }

  if (input.articleCapacityLimit !== undefined) {
    if (typeof input.articleCapacityLimit !== "number" || !Number.isInteger(input.articleCapacityLimit) || input.articleCapacityLimit < 1) {
      errors.push("articleCapacityLimit must be a positive integer");
    } else value.articleCapacityLimit = input.articleCapacityLimit;
  } else if (isCreate) {
    value.articleCapacityLimit = DEFAULT_ARTICLE_CAPACITY_LIMIT;
  }

  if (errors.length > 0) return { ok: false, error: errors.join("; ") };
  return { ok: true, value };
}

// Existence and ownership stay in middleware beside authentication/RBAC, while
// remaining separate so another user's Brief is 403 and a missing Brief is 404.
const requireBriefOwner = asyncHandler(async (req, res, next) => {
  if (!isUuid(req.params.id)) {
    res.status(404).json({ error: "Brief not found" });
    return;
  }
  const brief = await briefRepo().findOne({ where: { id: req.params.id } });
  if (!brief) {
    res.status(404).json({ error: "Brief not found" });
    return;
  }
  if (brief.ownerId !== req.user!.id) {
    res.status(403).json({ error: "You do not have access to this Brief" });
    return;
  }
  res.locals.brief = brief;
  next();
});

briefsRouter.use(requireAuth, requireRole("student", "investor"));
briefsRouter.use("/briefs/:id", requireBriefOwner);

briefsRouter.get(
  "/briefs",
  asyncHandler(async (req, res) => {
    const parsed = parseListQuery(req.query as Record<string, unknown>, {
      allowedSortBy: ["createdAt", "updatedAt", "title"],
      defaultSortBy: "createdAt",
      allowedCategories: BRIEF_CATEGORIES,
    });
    if (!parsed.ok) {
      res.status(422).json({ error: parsed.error });
      return;
    }
    const { page, pageSize, sortBy, sortDir, category, dateFrom, dateTo } = parsed.value;

    const qb = briefRepo()
      .createQueryBuilder("brief")
      .loadRelationCountAndMap("brief.articleCount", "brief.briefArticles")
      .where("brief.ownerId = :ownerId", { ownerId: req.user!.id })
      .orderBy(`brief.${sortBy}`, sortDir === "asc" ? "ASC" : "DESC");

    if (category) qb.andWhere("brief.category = :category", { category });
    if (dateFrom) qb.andWhere(`brief."createdAt" >= :dateFrom`, { dateFrom });
    if (dateTo) qb.andWhere(`brief."createdAt" <= :dateTo`, { dateTo });

    const { items, total } = await paginate(qb, page, pageSize);
    const withCount = items as (IntelligenceBrief & { articleCount?: number })[];
    res.json(toEnvelope(withCount.map((brief) => toPublicBrief(brief, brief.articleCount ?? 0)), page, pageSize, total));
  }),
);

briefsRouter.post(
  "/briefs",
  asyncHandler(async (req, res) => {
    const parsed = parseBriefInput(req.body, true);
    if (!parsed.ok) {
      res.status(422).json({ error: parsed.error });
      return;
    }
    let brief: IntelligenceBrief;
    try {
      brief = await briefRepo().save({ ...(parsed.value as BriefInput), ownerId: req.user!.id });
    } catch (err) {
      if (!isCheckViolation(err)) throw err;
      res.status(422).json({ error: "Brief violates a database constraint" });
      return;
    }
    res.status(201).json(toPublicBrief(brief, 0));
  }),
);

briefsRouter.get(
  "/briefs/:id",
  asyncHandler(async (req, res) => {
    const brief = res.locals.brief as IntelligenceBrief;

    const briefArticles = await briefArticleRepo().find({
      where: { briefId: brief.id },
      relations: { article: { publisher: true } },
      order: { createdAt: "ASC" },
    });

    res.json({
      ...toPublicBrief(brief, briefArticles.length),
      articles: briefArticles.map((ba) => toPublicArticle(ba.article)),
    });
  }),
);

briefsRouter.patch(
  "/briefs/:id",
  asyncHandler(async (req, res) => {
    const brief = res.locals.brief as IntelligenceBrief;

    const parsed = parseBriefInput(req.body, false);
    if (!parsed.ok) {
      res.status(422).json({ error: parsed.error });
      return;
    }

    try {
      const error = await AppDataSource.transaction(async (manager) => {
        const lockedBrief = await manager.getRepository(IntelligenceBrief).findOne({
          where: { id: brief.id },
          lock: { mode: "pessimistic_write" },
        });
        if (!lockedBrief) return "Brief not found";

        if (parsed.value.articleCapacityLimit !== undefined) {
          const attachedCount = await manager.getRepository(BriefArticle).count({ where: { briefId: brief.id } });
          if (parsed.value.articleCapacityLimit < attachedCount) {
            return `articleCapacityLimit cannot be below the ${attachedCount} Article(s) already attached`;
          }
        }

        // TypeORM's update() throws on an empty value object.
        if (Object.keys(parsed.value).length > 0) {
          await manager.getRepository(IntelligenceBrief).update({ id: brief.id }, parsed.value);
        }
        return null;
      });
      if (error) {
        res.status(error === "Brief not found" ? 404 : 422).json({ error });
        return;
      }
    } catch (err) {
      if (!isCheckViolation(err)) throw err;
      res.status(422).json({ error: "Brief violates a database constraint" });
      return;
    }
    await respondWithBrief(res, brief.id);
  }),
);

briefsRouter.post(
  "/briefs/:id/cover-image",
  (req, res, next) => {
    uploadCoverImage.single("coverImage")(req, res, (err: unknown) => {
      if (err) {
        res.status(422).json({ error: err instanceof Error ? err.message : "Invalid coverImage upload" });
        return;
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const brief = res.locals.brief as IntelligenceBrief;
    const file = req.file;
    if (!file) {
      res.status(422).json({ error: "coverImage file is required" });
      return;
    }

    const imageType = sniffImageType(file.buffer);
    if (!imageType) {
      res.status(422).json({ error: "coverImage must be a JPEG, PNG, or WEBP image" });
      return;
    }

    // Server-generated key (spec v3 §20.4 "no user-supplied path"): the
    // client's filename never reaches the filesystem.
    const key = `${brief.id}-${randomUUID()}.${imageType}`;
    await storage.save(key, file.buffer, `image/${imageType}`);
    await briefRepo().update({ id: brief.id }, { coverImageKey: key });

    if (brief.coverImageKey) await storage.delete(brief.coverImageKey);

    await respondWithBrief(res, brief.id);
  }),
);

briefsRouter.delete(
  "/briefs/:id",
  asyncHandler(async (req, res) => {
    const brief = res.locals.brief as IntelligenceBrief;

    await briefRepo().delete({ id: brief.id });
    res.status(204).end();
  }),
);

briefsRouter.post(
  "/briefs/:id/articles",
  asyncHandler(async (req, res) => {
    const brief = res.locals.brief as IntelligenceBrief;

    const articleId = (req.body ?? {}).articleId;
    if (typeof articleId !== "string" || !isUuid(articleId)) {
      res.status(422).json({ error: "articleId must be a valid Article id" });
      return;
    }
    const article = await AppDataSource.getRepository(Article).findOne({
      where: { id: articleId },
      relations: { publisher: true },
    });
    if (!article) {
      res.status(422).json({ error: "articleId must reference an existing Article" });
      return;
    }

    const error = await AppDataSource.transaction(async (manager) => {
      const lockedBrief = await manager.getRepository(IntelligenceBrief).findOne({
        where: { id: brief.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!lockedBrief) return "Brief not found";

      const joins = manager.getRepository(BriefArticle);
      if (await joins.findOne({ where: { briefId: brief.id, articleId } })) {
        return "This Article is already attached to the Brief";
      }
      const attachedCount = await joins.count({ where: { briefId: brief.id } });
      if (attachedCount >= lockedBrief.articleCapacityLimit) {
        return `Brief has reached its capacity of ${lockedBrief.articleCapacityLimit} Article(s)`;
      }
      await joins.save({ briefId: brief.id, articleId });
      return null;
    });
    if (error) {
      res.status(error === "Brief not found" ? 404 : 422).json({ error });
      return;
    }
    res.status(201).json(toPublicArticle(article));
  }),
);

briefsRouter.delete(
  "/briefs/:id/articles/:articleId",
  asyncHandler(async (req, res) => {
    const brief = res.locals.brief as IntelligenceBrief;

    if (!isUuid(req.params.articleId)) {
      res.status(404).json({ error: "Article is not attached to this Brief" });
      return;
    }
    const result = await briefArticleRepo().delete({ briefId: brief.id, articleId: req.params.articleId });
    if (result.affected === 0) {
      res.status(404).json({ error: "Article is not attached to this Brief" });
      return;
    }
    res.status(204).end();
  }),
);

import { Router } from "express";
import { AppDataSource } from "../data-source";
import { Story, STORY_CATEGORIES } from "../entities/Story";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { paginate, parseListQuery, toEnvelope } from "../lib/listQuery";
import { isUuid } from "../lib/uuid";

export const storiesRouter = Router();

function storyRepo() {
  return AppDataSource.getRepository(Story);
}

function toPublicStory(story: Story & { articleCount?: number }) {
  return {
    id: story.id,
    slug: story.slug,
    title: story.title,
    summary: story.summary,
    category: story.category,
    firstSeenAt: story.firstSeenAt,
    lastSeenAt: story.lastSeenAt,
    articleCount: story.articleCount ?? 0,
  };
}

storiesRouter.get(
  "/stories",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = parseListQuery(req.query as Record<string, unknown>, {
      allowedSortBy: ["firstSeenAt", "title"],
      defaultSortBy: "firstSeenAt",
      allowedCategories: STORY_CATEGORIES,
    });
    if (!parsed.ok) {
      res.status(422).json({ error: parsed.error });
      return;
    }
    const { page, pageSize, sortBy, sortDir, category, from, to } = parsed.value;

    const qb = storyRepo()
      .createQueryBuilder("story")
      .loadRelationCountAndMap("story.articleCount", "story.articles")
      .orderBy(`story.${sortBy}`, sortDir === "asc" ? "ASC" : "DESC");

    if (category) qb.andWhere("story.category = :category", { category });
    if (from) qb.andWhere(`story."firstSeenAt" >= :from`, { from });
    if (to) qb.andWhere(`story."firstSeenAt" <= :to`, { to });

    const { items, total } = await paginate(qb, page, pageSize);
    res.json(toEnvelope(items.map(toPublicStory), page, pageSize, total));
  }),
);

storiesRouter.get(
  "/stories/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isUuid(req.params.id)) {
      res.status(404).json({ error: "Story not found" });
      return;
    }

    const story = await storyRepo().findOne({
      where: { id: req.params.id },
      relations: { articles: { publisher: true } },
    });
    if (!story) {
      res.status(404).json({ error: "Story not found" });
      return;
    }

    res.json({
      ...toPublicStory(story),
      articleCount: story.articles.length,
      articles: [...story.articles]
        .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())
        .map((article) => ({
          id: article.id,
          title: article.title,
          url: article.url,
          publishedAt: article.publishedAt,
          analysisTextType: article.analysisTextType,
          publisher: { id: article.publisher.id, name: article.publisher.name, domain: article.publisher.domain },
        })),
    });
  }),
);

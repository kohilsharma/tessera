import { Router } from "express";
import { AppDataSource } from "../data-source";
import { Story, STORY_CATEGORIES } from "../entities/Story";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { toPublicArticle } from "../lib/articleView";
import { paginate, parseListQuery, toEnvelope } from "../lib/listQuery";
import { ACCEPTED_ASSIGNMENT, acceptedMembership } from "../lib/storyMembership";
import { isUuid } from "../lib/uuid";

export const storiesRouter = Router();

function storyRepo() {
  return AppDataSource.getRepository(Story);
}

function toPublicStory(story: Story, articleCount: number) {
  return {
    id: story.id,
    slug: story.slug,
    title: story.title,
    summary: story.summary,
    category: story.category,
    firstSeenAt: story.firstSeenAt,
    lastSeenAt: story.lastSeenAt,
    articleCount,
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
    const { page, pageSize, sortBy, sortDir, category, dateFrom, dateTo } = parsed.value;

    const qb = storyRepo()
      .createQueryBuilder("story")
      // Accepted members only (#50): a pending assignment is invisible to browse,
      // so counting it here would advertise coverage a reader cannot open.
      .loadRelationCountAndMap("story.articleCount", "story.articles", "member", (count) =>
        count.andWhere(acceptedMembership("member")),
      )
      .orderBy(`story.${sortBy}`, sortDir === "asc" ? "ASC" : "DESC");

    if (category) qb.andWhere("story.category = :category", { category });
    // Both bounds test firstSeenAt — a Story is dated by when its coverage began
    // (see Story.firstSeenAt), so the range filters story starts, not overlap.
    if (dateFrom) qb.andWhere(`story."firstSeenAt" >= :dateFrom`, { dateFrom });
    if (dateTo) qb.andWhere(`story."firstSeenAt" <= :dateTo`, { dateTo });

    const { items, total } = await paginate(qb, page, pageSize);
    const withCount = items as (Story & { articleCount?: number })[];
    res.json(
      toEnvelope(
        withCount.map((story) => toPublicStory(story, story.articleCount ?? 0)),
        page,
        pageSize,
        total,
      ),
    );
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

    // CONTEXT.md "Story Assignment": a proposal held for review carries this
    // Story's id but is not part of it until an Admin says so, so it is filtered
    // out of both the list and the count a reader sees.
    const members = story.articles.filter((article) => article.storyAssignmentStatus === ACCEPTED_ASSIGNMENT);
    res.json({
      ...toPublicStory(story, members.length),
      articles: members
        .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())
        .map(toPublicArticle),
    });
  }),
);

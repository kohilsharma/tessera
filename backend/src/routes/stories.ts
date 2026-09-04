import { Router } from "express";
import { AppDataSource } from "../data-source";
import { Article } from "../entities/Article";
import { EvidenceSet } from "../entities/EvidenceSet";
import { GenerationRun } from "../entities/GenerationRun";
import { Story, STORY_CATEGORIES } from "../entities/Story";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { toPublicArticle } from "../lib/articleView";
import { paginate, parseListQuery, toEnvelope } from "../lib/listQuery";
import { ACCEPTED_ASSIGNMENT, acceptedMembership } from "../lib/storyMembership";
import { isUuid } from "../lib/uuid";
import { buildTimeline, toTimelineEvents } from "../timeline/buildTimeline";
import { buildCoverageSpectrum, type CoverageSpectrum } from "../lib/coverageSpectrum";
import { loadStoryMarket } from "../market/storyMarket";

export const storiesRouter = Router();

function storyRepo() {
  return AppDataSource.getRepository(Story);
}

function toPublicStory(story: Story, articleCount: number, coverageSpectrum: CoverageSpectrum) {
  return {
    id: story.id,
    slug: story.slug,
    title: story.title,
    summary: story.summary,
    category: story.category,
    firstSeenAt: story.firstSeenAt,
    lastSeenAt: story.lastSeenAt,
    articleCount,
    coverageSpectrum,
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
    const articleRows = withCount.length
      ? await AppDataSource.getRepository(Article).find({
          where: withCount.map((story) => ({ storyId: story.id, storyAssignmentStatus: ACCEPTED_ASSIGNMENT })),
          relations: { publisher: true },
        })
      : [];
    const spectrumByStory = new Map<string, CoverageSpectrum>();
    for (const story of withCount) {
      spectrumByStory.set(story.id, buildCoverageSpectrum(articleRows.filter((article) => article.storyId === story.id)));
    }
    res.json(
      toEnvelope(
        withCount.map((story) => toPublicStory(story, story.articleCount ?? 0, spectrumByStory.get(story.id)!)),
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
    const market = req.user?.role === "investor" ? await loadStoryMarket(story.id) : undefined;
    res.json({
      ...toPublicStory(story, members.length, buildCoverageSpectrum(members)),
      articles: members
        .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())
        .map(toPublicArticle),
      ...(market ? { market: market.market, marketStatus: market.status, marketTotal: market.total } : {}),
    });
  }),
);

// The Story's timeline: its accepted reporting ordered over time, with the analytical
// events that happened to it on the same axis (#64). Its own endpoint rather than a
// field on Story detail, because it is a different question about the same record —
// and because the register that draws it owns its own request, and so its own four UI
// states, exactly as the Admin console's registers do.
//
// Every reader may read it: it is the corpus' own history, and it carries no body text
// and no claims.
storiesRouter.get(
  "/stories/:id/timeline",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isUuid(req.params.id)) {
      res.status(404).json({ error: "Story not found" });
      return;
    }
    const story = await storyRepo().findOne({ where: { id: req.params.id } });
    if (!story) {
      res.status(404).json({ error: "Story not found" });
      return;
    }

    // Accepted members only, by the one predicate every reader surface tests (#50):
    // a proposal is a machine's borderline guess, and a timeline is the record of
    // what this Story *is*, not of what was suggested for it.
    const [articles, evidenceSets, runs] = await Promise.all([
      AppDataSource.getRepository(Article).find({
        where: { storyId: story.id, storyAssignmentStatus: ACCEPTED_ASSIGNMENT },
        relations: { publisher: true },
      }),
      AppDataSource.getRepository(EvidenceSet).find({ where: { storyId: story.id } }),
      // Completed runs only: a failed run produced no analysis, and an axis point for
      // one would put a thing that did not happen on the record's history.
      AppDataSource.getRepository(GenerationRun).find({ where: { storyId: story.id, status: "completed" } }),
    ]);

    res.json(buildTimeline(articles, toTimelineEvents(evidenceSets, runs)));
  }),
);

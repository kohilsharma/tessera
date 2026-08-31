import { AppDataSource } from "../data-source";
import { STORY_CATEGORIES, type StoryCategory } from "../entities/Story";
import type { SynthesisProvider } from "../synthesis";
import { STORY_NAMING_TIMEOUT_MS } from "./config";

// #51: the one non-deterministic step in clustering. Re-running a run reproduces
// membership — the vectors, thresholds and gates are all deterministic — but not
// titles: a model names each *new* Story once, and it may answer differently the
// next time a comparable cluster forms. Naming never runs for a Story that
// already exists, so nothing an operator is looking at is renamed underneath them.
//
// It is also the one step allowed to fail quietly. A cluster with a medoid title
// is a worse-labelled Story, not a broken one, so every failure path lands back
// on the medoid title and the default category rather than failing the run.

export type StoryName = { title: string; category: StoryCategory };

// Only headlines go to the provider. Article bodies are internal-only (ADR-0018),
// and their two documented exceptions — embeddings and synthesis evidence text —
// do not cover naming, which does not need them. Eight of them: past that a
// cluster's extra headlines restate the same event and only cost tokens.
const MAX_HEADLINES = 8;

// Two numbers on purpose. The prompt asks for 90 characters; naming *accepts* up
// to this, because refusing a good 95-character title in favour of the medoid's
// makes the Story worse to serve a rule nobody reads.
const ASKED_TITLE_LENGTH = 90;
const MAX_TITLE_LENGTH = 120;

const SYSTEM = "You name clusters of news reporting for a news analysis system. Answer with a JSON object only.";

export function storySlug(title: string, medoidId: string): string {
  const stem = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  // The medoid's id keeps the slug unique whatever the model answers, and no two
  // Stories share a medoid Article.
  return `${stem || "story"}-${medoidId.slice(0, 8)}`;
}

function promptFor(headlines: string[]): string {
  return [
    "These headlines all report the same event:",
    ...headlines.slice(0, MAX_HEADLINES).map((headline) => `- ${headline}`),
    "",
    'Answer with {"title": string, "category": string}.',
    `title: a neutral headline naming the event itself, at most ${ASKED_TITLE_LENGTH} characters, ` +
      "no publisher name and no opinion.",
    `category: exactly one of ${STORY_CATEGORIES.join(", ")}.`,
  ].join("\n");
}

function parseName(answer: string): StoryName | null {
  // Cheap models fence their JSON even when asked for an object, so take the
  // outermost braces rather than trusting the whole response to parse.
  const object = answer.match(/\{[\s\S]*\}/)?.[0];
  if (!object) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(object);
  } catch {
    return null;
  }
  const { title, category } = (parsed ?? {}) as { title?: unknown; category?: unknown };
  const trimmed = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
  if (trimmed === "" || trimmed.length > MAX_TITLE_LENGTH) return null;
  // The vocabulary is closed (Story.category's CHECK constraint). An invented
  // category is not repaired into a neighbour: ADR-0026 fixes the fallback for an
  // off-enum answer as the medoid title, so the whole answer goes back and a Story
  // is never half a model's judgement and half ours. This is the one place ADR-0003's
  // repair loop does not apply — there is a correct answer to fall back to.
  const named = typeof category === "string" ? category.trim().toLowerCase() : "";
  if (!(STORY_CATEGORIES as readonly string[]).includes(named)) return null;
  return { title: trimmed, category: named as StoryCategory };
}

// One call per newly created Story, made after its transaction has committed: a
// model call inside the seeding transaction would hold row locks on every member
// for the length of a network round trip.
export async function nameNewStory(
  namer: SynthesisProvider,
  story: { id: string; medoidId: string; headlines: string[] },
): Promise<StoryName | null> {
  try {
    const answer = await namer.complete({
      task: "story_name",
      system: SYSTEM,
      prompt: promptFor(story.headlines),
      json: true,
      maxTokens: 200,
      timeoutMs: STORY_NAMING_TIMEOUT_MS,
    });
    const named = parseName(answer);
    if (!named) {
      console.warn(`[clustering] story ${story.id} keeps its medoid title: unusable naming answer`);
      return null;
    }
    await AppDataSource.query(`UPDATE "stories" SET "title" = $2, "slug" = $3, "category" = $4 WHERE "id" = $1`, [
      story.id,
      named.title,
      storySlug(named.title, story.medoidId),
      named.category,
    ]);
    return named;
  } catch (err) {
    // Includes the timeout above: an AbortError arrives here like any other.
    console.warn(
      `[clustering] story ${story.id} keeps its medoid title: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

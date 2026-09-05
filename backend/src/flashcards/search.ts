import { AppDataSource } from "../data-source";
import { Article } from "../entities/Article";
import { In } from "typeorm";
import { createHash } from "node:crypto";
import type { SynthesisProvider } from "../synthesis";
import { evidenceFromArticles, freezeEvidenceWith } from "../generation/evidence";
import { Flashcard } from "../entities/Flashcard";
import { FlashcardCitation } from "../entities/FlashcardCitation";
import { hybridSearchArticleIds } from "../lib/hybridSearch";
import { createEmbeddingProvider } from "../embeddings";
import { parseModelObject } from "../lib/modelJson";

export const CARD_COUNTS = [5, 10, 20] as const;
export const ANSWER_LENGTHS = ["one_word", "one_line", "full"] as const;
export type AnswerLength = (typeof ANSWER_LENGTHS)[number];

function trimAnswer(text: string, length: AnswerLength): string {
  if (length === "one_word") return text.trim().split(/\s+/)[0] ?? text;
  if (length === "one_line") return text.split(/[\n.!?]/)[0].trim();
  return text;
}

function parseCards(raw: string, ids: string[], answers: string[], length: AnswerLength) {
  const parsed = parseModelObject(raw);
  const rows: unknown[] = Array.isArray(parsed?.cards) ? (parsed.cards as unknown[]) : [];
  return ids.flatMap((id, i) => {
    const card = (rows[i] ?? {}) as { question?: unknown; answer?: unknown; citations?: unknown };
    const citations = Array.isArray(card.citations) ? [...new Set(card.citations.map(String).filter((citation) => ids.includes(citation)))] : [];
    const question = typeof card.question === "string" ? card.question.trim() : "";
    const answer = typeof card.answer === "string" ? card.answer.trim() : "";
    // A card the model wrote but cited nothing for is dropped, not pinned to the row it
    // happened to sit beside: `generation/validate.ts` refuses an uncited claim, and
    // inventing the citation here would be the same claim through another door. The
    // untouched row is a different thing — its question, answer and citation are all
    // ours, and all three name the one evidence row.
    if (!citations.length && (question || answer)) return [];
    return [{
      question: question || `What does source ${id} report?`,
      answer: trimAnswer(answer || answers[i], length),
      citations: citations.length ? citations : [id],
    }];
  });
}

export async function generateSearchDeck(
  provider: SynthesisProvider,
  ownerId: string,
  query: string,
  count: number,
  answerLength: AnswerLength,
) {
  const { hits } = await hybridSearchArticleIds(query, { page: 1, pageSize: count, sortBy: "relevance", sortDir: "desc" }, createEmbeddingProvider());
  const found = hits.length ? await AppDataSource.getRepository(Article).find({ where: { id: In(hits.map((hit) => hit.id)) }, relations: { publisher: true, story: true } }) : [];
  const byId = new Map(found.map((article) => [article.id, article]));
  const articles = hits.map((hit) => byId.get(hit.id)).filter((article): article is Article => article != null);
  if (!articles.length) return [];
  const selected = evidenceFromArticles(articles, "centroid_rank");
  const answers = selected.map((row) => row.excerpt);
  const prompt = selected.map((row) => `[${row.evidenceId}] ${row.title}: ${row.excerpt}`).join("\n") + `\nAnswer length: ${answerLength}`;
  const contentHash = createHash("sha256").update(prompt).update(`\0${count}\0${answerLength}`).digest("hex");
  const [cached]: { response: string }[] = await AppDataSource.query(`SELECT "response" FROM "flashcard_generation_cache" WHERE "contentHash" = $1`, [contentHash]);
  const raw = cached?.response ?? await provider.complete({
    task: "flashcard_cards", json: true, maxTokens: count * 100,
    system: "Write concise study flashcards. Every card must cite one or more evidence ids.", prompt,
  });
  if (!cached) await AppDataSource.query(`INSERT INTO "flashcard_generation_cache" ("contentHash", "response") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [contentHash, raw]);
  const cards = parseCards(raw, selected.map((row) => row.evidenceId), answers, answerLength);
  return AppDataSource.transaction(async (manager) => {
    const evidenceSet = await freezeEvidenceWith(manager, null, selected);
    const saved: Flashcard[] = [];
    for (const card of cards.slice(0, count)) {
      const savedCard = await manager.getRepository(Flashcard).save({ ownerId, generationRunId: null, claimId: null, evidenceSetId: evidenceSet.id, question: card.question, answer: card.answer, dueAt: new Date() });
      await manager.getRepository(FlashcardCitation).insert(card.citations.map((evidenceId) => ({ flashcardId: savedCard.id, evidenceId, articleId: selected.find((row) => row.evidenceId === evidenceId)!.articleId })));
      saved.push(savedCard);
    }
    return saved.map((card) => card.id);
  });
}

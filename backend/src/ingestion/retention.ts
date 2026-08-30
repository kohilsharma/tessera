import { AppDataSource } from "../data-source";
import { Article } from "../entities/Article";
import type { ConnectorKind } from "../entities/IngestionConnector";

// #45. The GKG firehose is unbounded — one window every 15 minutes, forever, at
// ~656 rows and ~68 annotation occurrences each — so what it leaves behind ages
// out on a rolling window and disk use has a ceiling.
//
// Bounded on when the row was *stored*, not on `publishedAt`: the ceiling is on
// ingest volume, which is what actually consumes disk, and a document GDELT
// reports with an old timestamp would otherwise be inserted, pruned, and inserted
// again by the next window that carries it.
export const GKG_RETENTION_DAYS = 7;

// Deliberately narrow: only rows a GKG connector discovered *and* that nothing has
// since enriched with text. ADR-0024's ladder makes that second half one column —
// anything above `metadata_only` is reporting Tessera acquired rather than
// firehose metadata, so a GKG row an RSS feed later gave an excerpt to outlives
// the window, and an RSS-discovered Article is never touched at all.
//
// GKG Annotations go with the Article (ON DELETE CASCADE, migration 1755750000000)
// and are the bulk of the bytes.
//
// ponytail: one unbatched DELETE per tick, no LIMIT. The ceiling is a first pass
// over a backlog — a database restored from a week-old dump deletes everything at
// once and holds the locks while it does. Deleting in batches, or by
// `createdAt`-ordered slices, is the upgrade if a pass ever takes long enough to
// notice; each subsequent tick only ever covers a window's worth of rows.
export async function pruneExpiredGkgArticles(): Promise<number> {
  const cutoff = new Date(Date.now() - GKG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const pruned = await AppDataSource.getRepository(Article)
    .createQueryBuilder()
    .delete()
    .where(`"createdAt" < :cutoff`, { cutoff })
    .andWhere(`"analysisTextMode" = 'metadata_only'`)
    // A seeded fixture Article has no discovering connector at all (ADR-0007), so
    // `IN` excludes the curated corpus without a clause of its own. The kind is
    // bound rather than inlined so tsc still checks it against the union.
    .andWhere(`"discoveredByConnectorId" IN (SELECT id FROM ingestion_connectors WHERE kind = :kind)`, {
      kind: "gdelt_gkg" satisfies ConnectorKind,
    })
    // Both references below are ON DELETE CASCADE and this runs unattended every
    // 15 minutes, so without these two clauses retention would one day silently
    // take evidence out of a Story or an Article out of someone's Brief. Nothing
    // clusters or cites a metadata_only row yet — Phase 3 is what will.
    //
    // ponytail: the ceiling is that a clustered or cited row then has no expiry at
    // all, so the firehose's disk bound has a hole in it exactly as wide as what
    // Phase 3 clusters. Refusing to delete is the safe side of that trade; what
    // evidence retention should be is ADR territory for Phase 3, not a default to
    // guess here.
    .andWhere(`"storyId" IS NULL`)
    .andWhere(`NOT EXISTS (SELECT 1 FROM brief_articles WHERE brief_articles."articleId" = "articles"."id")`)
    .execute();
  return pruned.affected ?? 0;
}

import type { GkgAnnotationKind } from "../entities/GkgAnnotation";

export type SeedGraphAnnotation = {
  kind: GkgAnnotationKind;
  surfaceName: string;
};

export type SeedGraphArticle = {
  title: string;
  url: string;
  publisherDomain: string;
  publishedAt: string;
  analysisText: string;
  annotations: SeedGraphAnnotation[];
};

// Five unclustered fixture reports give the production promotion floor real input on a
// clean seed. They stay outside Stories and use manual_fixture so retention cannot remove
// the graph's demo substrate; resolution still runs through the normal seam.
const NAMES: SeedGraphAnnotation[] = [
  { kind: "organization", surfaceName: "Atlas Relay" },
  { kind: "organization", surfaceName: "Cobalt Systems" },
  { kind: "organization", surfaceName: "Lumen Works" },
  { kind: "person", surfaceName: "Mira Sen" },
  { kind: "person", surfaceName: "Jonas Vale" },
  { kind: "person", surfaceName: "Rhea Moss" },
];

export const SEED_GRAPH_ARTICLES: SeedGraphArticle[] = Array.from({ length: 5 }, (_, index) => ({
  title: `Graph demonstration report ${index + 1}`,
  url: `https://tessera.example/graph-fixture/${index + 1}`,
  publisherDomain: "meridianwire.example",
  publishedAt: `2026-08-0${index + 1}T12:00:00.000Z`,
  analysisText: NAMES.map(({ surfaceName }) => surfaceName).join(" reported alongside "),
  annotations: NAMES,
}));

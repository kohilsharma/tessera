import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Article } from "./Article";

// CONTEXT.md "GKG Annotation": one surface-name occurrence of a person,
// organization, location or theme in one Article, exactly as GKG reported it,
// before any resolution. This is the pre-resolution raw material Phase 3.5
// resolves canonical Entities from, and the table its co-occurrence edges are
// built from by self-joining one Article's rows (ADR-0019).
//
// Deliberately not named after GDELT's own `mentions` file, which means an event
// referenced in an article — an entirely different concept (CONTEXT.md).
export const GKG_ANNOTATION_KINDS = ["person", "organization", "location", "theme"] as const;
export type GkgAnnotationKind = (typeof GKG_ANNOTATION_KINDS)[number];

// What GKG reports about a location beyond its surface name: the FeatureID
// Phase 3.5 resolves on, and the coordinates and country a bounded map view
// needs. One nullable JSONB column rather than four columns that three of the
// four kinds would leave null — nothing queries inside it yet, so a column per
// field would be speculation.
export type GkgLocationDetail = {
  featureId: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
};

@Entity("gkg_annotations")
export class GkgAnnotation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Article)
  @JoinColumn({ name: "articleId" })
  article!: Article;

  @Column({ type: "uuid" })
  articleId!: string;

  @Column({ type: "varchar" })
  kind!: GkgAnnotationKind;

  // As GKG reported it: no case folding, normalization, resolution or lossy
  // length bound. The migration hashes this value only for the fixed-size unique
  // occurrence index; the reported value itself remains intact.
  @Column({ type: "text" })
  surfaceName!: string;

  // Character offset into the document body GDELT analysed. The same name at two
  // offsets is two occurrences, which is what makes a co-occurrence self-join
  // over one Article's persons and organizations mean something.
  @Column({ type: "integer" })
  charOffset!: number;

  // Non-null for `location` rows only; GKG reports no gazetteer detail for the
  // other three kinds.
  @Column({ type: "jsonb", nullable: true })
  locationDetail!: GkgLocationDetail | null;
}

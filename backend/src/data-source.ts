import "reflect-metadata";
import { DataSource } from "typeorm";
import "dotenv/config";
import { InitPgvector1755740000000 } from "./migrations/1755740000000-InitPgvector";
import { CreateUsers1755741000000 } from "./migrations/1755741000000-CreateUsers";
import { CreateCorpus1755742000000 } from "./migrations/1755742000000-CreateCorpus";
import { CreateBriefs1755743000000 } from "./migrations/1755743000000-CreateBriefs";
import { AddSearchVectors1755744000000 } from "./migrations/1755744000000-AddSearchVectors";
import { CreateIngestionConnectors1755745000000 } from "./migrations/1755745000000-CreateIngestionConnectors";
import { CreateIngestionRuns1755746000000 } from "./migrations/1755746000000-CreateIngestionRuns";
import { AlignAnalysisTextMode1755747000000 } from "./migrations/1755747000000-AlignAnalysisTextMode";
import { AddPublisherTermsClass1755748000000 } from "./migrations/1755748000000-AddPublisherTermsClass";
import { AddArticleToneAndDedupeIndex1755749000000 } from "./migrations/1755749000000-AddArticleToneAndDedupeIndex";
import { CreateGkgAnnotations1755750000000 } from "./migrations/1755750000000-CreateGkgAnnotations";
import { PreserveGkgAnnotationSurfaceNames1755751000000 } from "./migrations/1755751000000-PreserveGkgAnnotationSurfaceNames";
import { AddArticleExtractionAttemptedAt1755752000000 } from "./migrations/1755752000000-AddArticleExtractionAttemptedAt";
import { AddStoryCentroidAndClusteringRuns1755753000000 } from "./migrations/1755753000000-AddStoryCentroidAndClusteringRuns";
import { AddPendingStoryAssignmentReview1755754000000 } from "./migrations/1755754000000-AddPendingStoryAssignmentReview";
import { CreateGenerationRuns1755755000000 } from "./migrations/1755755000000-CreateGenerationRuns";
import { FixGenerationSnapshotsAndReuse1755756000000 } from "./migrations/1755756000000-FixGenerationSnapshotsAndReuse";
import { AddEvidenceDataModeAndClaimFloor1755757000000 } from "./migrations/1755757000000-AddEvidenceDataModeAndClaimFloor";
import { AddBriefGenerationRun1755758000000 } from "./migrations/1755758000000-AddBriefGenerationRun";
import { AddClaimEvidenceRelationship1755759000000 } from "./migrations/1755759000000-AddClaimEvidenceRelationship";
import { CreatePromptTemplates1755760000000 } from "./migrations/1755760000000-CreatePromptTemplates";
import { CreateFlashcards1755761000000 } from "./migrations/1755761000000-CreateFlashcards";
import { RecordFlashcardReviewsAndCacheQuestions1755762000000 } from "./migrations/1755762000000-RecordFlashcardReviewsAndCacheQuestions";
import { CreateEntityResolution1755763000000 } from "./migrations/1755763000000-CreateEntityResolution";
import { CreateEntityMergeReview1755764000000 } from "./migrations/1755764000000-CreateEntityMergeReview";
import { RequeueFailedExtractionAttempts1755765000000 } from "./migrations/1755765000000-RequeueFailedExtractionAttempts";
import { AddUserColorMode1755766000000 } from "./migrations/1755766000000-AddUserColorMode";
import { RelaxPublisherTermsPolicy1755767000000 } from "./migrations/1755767000000-RelaxPublisherTermsPolicy";
import { RegroundFlashcards1755768000000 } from "./migrations/1755768000000-RegroundFlashcards";
import { AddPublisherLeaning1755769000000 } from "./migrations/1755769000000-AddPublisherLeaning";
import { AddEntityTicker1755770000000 } from "./migrations/1755770000000-AddEntityTicker";
import { User } from "./entities/User";
import { Publisher } from "./entities/Publisher";
import { Story } from "./entities/Story";
import { Article } from "./entities/Article";
import { IntelligenceBrief } from "./entities/IntelligenceBrief";
import { BriefArticle } from "./entities/BriefArticle";
import { IngestionConnector } from "./entities/IngestionConnector";
import { IngestionRun } from "./entities/IngestionRun";
import { GkgAnnotation } from "./entities/GkgAnnotation";
import { ClusteringRun } from "./entities/ClusteringRun";
import { RejectedStoryAssignment } from "./entities/RejectedStoryAssignment";
import { EvidenceSet } from "./entities/EvidenceSet";
import { EvidenceSetArticle } from "./entities/EvidenceSetArticle";
import { GenerationRun } from "./entities/GenerationRun";
import { AnalysisClaim } from "./entities/AnalysisClaim";
import { ClaimEvidence } from "./entities/ClaimEvidence";
import { PromptTemplate } from "./entities/PromptTemplate";
import { Flashcard } from "./entities/Flashcard";
import { FlashcardCitation } from "./entities/FlashcardCitation";
import { Entity } from "./entities/Entity";
import { EntityEdge } from "./entities/EntityEdge";
import { EntityResolutionRun } from "./entities/EntityResolutionRun";
import { EntityAlias } from "./entities/EntityAlias";
import { EntityMergeRefusal } from "./entities/EntityMergeRefusal";
import { EntityMergeProposal } from "./entities/EntityMergeProposal";
import { StoryMergeRecord } from "./entities/StoryMergeRecord";
import { WatchlistItem } from "./entities/WatchlistItem";
import { AddStoryRolePanels1755771000000 } from "./migrations/1755771000000-AddStoryRolePanels";
import { CreateWatchlistItems1755772000000 } from "./migrations/1755772000000-CreateWatchlistItems";
import { AddUserActive1755773000000 } from "./migrations/1755773000000-AddUserActive";
import { PreserveIngestionRunsOnConnectorDelete1755774000000 } from "./migrations/1755774000000-PreserveIngestionRunsOnConnectorDelete";

const url = process.env.DATABASE_URL;

// Fail loudly rather than let the pg driver fall back to its own localhost:5432
// defaults, which on a dev machine is likely a *different* project's database.
// Tests inject a Testcontainers URL via setOptions() after this module loads.
if (!url && process.env.NODE_ENV !== "test") {
  throw new Error("DATABASE_URL is not set — copy backend/.env.example to backend/.env (see SETUP.md).");
}

export const AppDataSource = new DataSource({
  type: "postgres",
  url,
  // Explicit class imports, not a glob: TypeORM's glob loader uses Node's own
  // require()/import() on the file path, which can't parse raw .ts outside a
  // ts-node/tsx-registered process (e.g. inside Vitest workers). Add entity
  // classes to the array above the same way.
  entities: [
    User,
    Publisher,
    Story,
    Article,
    IntelligenceBrief,
    BriefArticle,
    IngestionConnector,
    IngestionRun,
    GkgAnnotation,
    ClusteringRun,
    RejectedStoryAssignment,
    EvidenceSet,
    EvidenceSetArticle,
    GenerationRun,
    AnalysisClaim,
    ClaimEvidence,
    PromptTemplate,
    Flashcard,
    FlashcardCitation,
    Entity,
    EntityEdge,
    EntityResolutionRun,
    EntityAlias,
    EntityMergeRefusal,
    EntityMergeProposal,
    StoryMergeRecord,
    WatchlistItem,
  ],
  migrations: [
    InitPgvector1755740000000,
    CreateUsers1755741000000,
    CreateCorpus1755742000000,
    CreateBriefs1755743000000,
    AddSearchVectors1755744000000,
    CreateIngestionConnectors1755745000000,
    CreateIngestionRuns1755746000000,
    AlignAnalysisTextMode1755747000000,
    AddPublisherTermsClass1755748000000,
    AddArticleToneAndDedupeIndex1755749000000,
    CreateGkgAnnotations1755750000000,
    PreserveGkgAnnotationSurfaceNames1755751000000,
    AddArticleExtractionAttemptedAt1755752000000,
    AddStoryCentroidAndClusteringRuns1755753000000,
    AddPendingStoryAssignmentReview1755754000000,
    CreateGenerationRuns1755755000000,
    FixGenerationSnapshotsAndReuse1755756000000,
    AddEvidenceDataModeAndClaimFloor1755757000000,
    AddBriefGenerationRun1755758000000,
    AddClaimEvidenceRelationship1755759000000,
    CreatePromptTemplates1755760000000,
    CreateFlashcards1755761000000,
    RecordFlashcardReviewsAndCacheQuestions1755762000000,
    CreateEntityResolution1755763000000,
    CreateEntityMergeReview1755764000000,
    RequeueFailedExtractionAttempts1755765000000,
    AddUserColorMode1755766000000,
    RelaxPublisherTermsPolicy1755767000000,
    RegroundFlashcards1755768000000,
    AddPublisherLeaning1755769000000,
    AddEntityTicker1755770000000,
    AddStoryRolePanels1755771000000,
    CreateWatchlistItems1755772000000,
    AddUserActive1755773000000,
    PreserveIngestionRunsOnConnectorDelete1755774000000,
  ],
  synchronize: false,
  logging: false,
});

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
import { User } from "./entities/User";
import { Publisher } from "./entities/Publisher";
import { Story } from "./entities/Story";
import { Article } from "./entities/Article";
import { IntelligenceBrief } from "./entities/IntelligenceBrief";
import { BriefArticle } from "./entities/BriefArticle";
import { IngestionConnector } from "./entities/IngestionConnector";
import { IngestionRun } from "./entities/IngestionRun";
import { GkgAnnotation } from "./entities/GkgAnnotation";

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
  ],
  synchronize: false,
  logging: false,
});

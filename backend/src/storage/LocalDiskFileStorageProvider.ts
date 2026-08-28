import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { FileStorageProvider } from "./FileStorageProvider";

// ADR-0015: local persistent volume for the demo; served back through the API
// itself (mounted in app.ts) rather than a public static host, so the same
// FileStorageProvider seam holds when an S3/GCS implementation replaces this one.
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(process.cwd(), "uploads");

export class LocalDiskFileStorageProvider implements FileStorageProvider {
  async save(key: string, data: Buffer, _contentType: string): Promise<void> {
    await mkdir(UPLOADS_DIR, { recursive: true });
    // basename strips any directory component: keys are always server-generated
    // (see routes/briefs.ts), but this keeps the write confined to UPLOADS_DIR
    // even if that ever changes (spec v3 §20.4: "no user-supplied path").
    await writeFile(join(UPLOADS_DIR, basename(key)), data);
  }

  async delete(key: string): Promise<void> {
    await rm(join(UPLOADS_DIR, basename(key)), { force: true });
  }

  url(key: string): string {
    return `/api/v1/media/${basename(key)}`;
  }
}

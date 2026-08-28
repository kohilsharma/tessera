import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { FileStorageProvider } from "./FileStorageProvider";

// ADR-0015: local persistent volume for the demo. Nothing outside this file
// knows where the bytes live — routes go through the FileStorageProvider seam,
// so an S3/GCS implementation replaces this one without touching them.
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(process.cwd(), "uploads");

// basename strips any directory component: keys are always server-generated
// (see routes/briefs.ts), but this keeps every read and write confined to
// UPLOADS_DIR even if that ever changes (spec v3 §20.4: "no user-supplied path").
function pathFor(key: string): string {
  return join(UPLOADS_DIR, basename(key));
}

export class LocalDiskFileStorageProvider implements FileStorageProvider {
  async save(key: string, data: Buffer, _contentType: string): Promise<void> {
    await mkdir(UPLOADS_DIR, { recursive: true });
    await writeFile(pathFor(key), data);
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(pathFor(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(pathFor(key), { force: true });
  }
}

// spec v3 §20.4 / §34.4 "FileStorageProvider": local disk today, S3/GCS later,
// behind this seam so routes never touch the filesystem (or a bucket) directly.
export interface FileStorageProvider {
  save(key: string, data: Buffer, contentType: string): Promise<void>;
  // Best-effort: callers replacing a key (see routes/briefs.ts's cover-image
  // upload) don't need this to fail loudly if the old file is already gone.
  delete(key: string): Promise<void>;
  url(key: string): string;
}

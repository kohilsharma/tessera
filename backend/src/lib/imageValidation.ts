// spec v3 §20.4 "image decoding where feasible": a client-supplied
// Content-Type/extension is just a claim, so the upload route trusts this
// sniff of the actual bytes instead.
// ponytail: signature check, not a full decode — a truncated/corrupt-but-
// signature-valid file still passes. Swap in a real decode (e.g. `sharp`) if
// that turns out to matter; not worth the dependency for a course-scope upload.
export type SniffedImageType = "jpeg" | "png" | "webp";

const SIGNATURES: { type: SniffedImageType; mimeType: string; matches: (buf: Buffer) => boolean }[] = [
  {
    type: "jpeg",
    mimeType: "image/jpeg",
    matches: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  {
    type: "png",
    mimeType: "image/png",
    matches: (buf) =>
      buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    type: "webp",
    mimeType: "image/webp",
    matches: (buf) =>
      buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

// Single source of truth for the allowed-type list — routes/briefs.ts's multer
// fileFilter and BriefDetail.tsx's <input accept> both mean this same set.
export const IMAGE_MIME_TYPES: readonly string[] = SIGNATURES.map((sig) => sig.mimeType);

export function sniffImageType(data: Buffer): SniffedImageType | null {
  return SIGNATURES.find((sig) => sig.matches(data))?.type ?? null;
}

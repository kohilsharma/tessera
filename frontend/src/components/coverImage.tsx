import { useEffect, useState } from "react";
import { fetchBriefCoverImage } from "../api/client";

// The cover image endpoint is owner-only, so the bytes need the bearer token an
// <img src> can't send: fetch them, then point the <img> at an object URL.
// Shared because two places show the same image — the Brief record page at full
// width, and the Briefs index on the entry's plate (#32) — and the token dance
// is the same either way. What each does while it waits is not: the record page
// says "loading", the index just leaves its plate empty.
//
// A null url is a Brief with no cover: nothing to fetch, and `src` stays null.
export function useBriefCoverImage(url: string | null, cacheKey: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    if (!url) return;

    fetchBriefCoverImage(url)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      // Without this the blob stays in memory for the life of the document.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // cacheKey too: replacing the image keeps the same URL but changes the key,
    // so this is what tells us to re-fetch after an upload.
  }, [url, cacheKey]);

  return { src, failed };
}

// The other half of the same job, on the Brief form (#35): an image the owner has
// picked but not yet saved. Same object-URL dance, no fetch — the bytes are
// already in hand — and the same revoke, which is why it lives beside the
// fetching hook rather than inside the form.
export function useSelectedImagePreview(file: File | null) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setSrc(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setSrc(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return src;
}

// The index's thumbnail: the plate is already drawn and already holds the row's
// shape, so a cover that is absent, loading, or unreachable shows the plate
// rather than a state block. `alt=""` because the entry's title says what this is
// a cover of.
export function BriefCoverThumbnail({ url, cacheKey }: { url: string | null; cacheKey: string | null }) {
  const { src } = useBriefCoverImage(url, cacheKey);
  return src ? <img src={src} alt="" /> : null;
}

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  attachArticleToBrief,
  deleteBrief,
  detachArticleFromBrief,
  getBrief,
  uploadBriefCoverImage,
  COVER_IMAGE_ACCEPT,
  type BriefSummary,
} from "../api/client";
import { useBriefCoverImage } from "../components/coverImage";
import { AnalysisRegister } from "../components/analysisRegister";
import { ArticleEntry } from "../components/indexArchetype";
import { RecordMasthead, RecordSection } from "../components/recordArchetype";
import { EmptyState, EntryList, ErrorState, PendingState, RetryableError } from "../components/uiStates";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The Brief's cover: the plate beside its identity, and the control that puts an
// image on it. The plate is always drawn, at a fixed ratio, so the mast holds the
// same two columns whether an image landed, is in flight, or was never added —
// the same reason the index draws its thumbnail plate unconditionally (#32). The
// token-and-object-URL dance itself is shared with that thumbnail
// (components/coverImage.tsx).
function BriefCover({
  url,
  cacheKey,
  upload,
}: {
  url: string | null;
  cacheKey: string | null;
  upload: UseMutationResult<BriefSummary, Error, File>;
}) {
  const { src, failed } = useBriefCoverImage(url, cacheKey);

  return (
    <div className="record-cover">
      {/* alt="" because the Brief's title, right beside it, names what this is a
          cover of — a cover image states nothing the record does not. */}
      <div className="record-plate">{src && <img src={src} alt="" />}</div>
      {failed && <ErrorState>Could not load the cover image.</ErrorState>}
      {url && !src && !failed && <PendingState>Loading cover image…</PendingState>}
      <label className="record-cover-control">
        {url ? "Replace cover image" : "Add a cover image"}
        <input
          type="file"
          accept={COVER_IMAGE_ACCEPT}
          disabled={upload.isPending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            // Cleared so re-picking the same file still fires a change event.
            e.target.value = "";
          }}
        />
      </label>
      {upload.isPending && <PendingState>Uploading…</PendingState>}
      {upload.isError && <ErrorState>Could not upload this cover image: {upload.error.message}</ErrorState>}
    </div>
  );
}

// The Record archetype's owned registration (#34): same masthead, ledger, and
// sections as a Story or an Article, on the bench stock rather than the corpus'
// ink sheet — because a Brief is yours and they are not. Ownership is stated in
// words too (the ledger's Owner cell), so the distinction survives greyscale.
export default function BriefDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [articleId, setArticleId] = useState("");
  const [attachError, setAttachError] = useState<string | null>(null);

  const query = useQuery({ queryKey: ["brief", id], queryFn: () => getBrief(id!), enabled: !!id });

  const attach = useMutation({
    mutationFn: (newArticleId: string) => attachArticleToBrief(id!, newArticleId),
    onSuccess: () => {
      setArticleId("");
      queryClient.invalidateQueries({ queryKey: ["brief", id] });
    },
    onError: (err: Error) => setAttachError(err.message),
  });

  const detach = useMutation({
    mutationFn: (targetArticleId: string) => detachArticleFromBrief(id!, targetArticleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["brief", id] }),
  });

  const remove = useMutation({
    mutationFn: () => deleteBrief(id!),
    onSuccess: () => navigate("/briefs"),
  });

  const uploadCover = useMutation({
    mutationFn: (file: File) => uploadBriefCoverImage(id!, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["brief", id] }),
  });

  function onAttach(e: FormEvent) {
    e.preventDefault();
    if (!UUID_RE.test(articleId)) {
      setAttachError("Enter a valid Article id (see the Stories browser).");
      return;
    }
    setAttachError(null);
    attach.mutate(articleId);
  }

  if (query.isPending) return <PendingState>Loading Brief…</PendingState>;
  // A Brief that does not exist — or one that is not yours — arrives here as the
  // API's own message in the shared error treatment, as on the corpus records.
  // See the ponytail note in StoryDetail: telling a 404 from a transient failure
  // is one change in api/client.ts and a pass over every detail page.
  if (query.isError)
    return (
      <RetryableError
        message={`Could not load this Brief: ${(query.error as Error).message}`}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );

  const brief = query.data;
  const atCapacity = brief.articleCount >= brief.articleCapacityLimit;

  return (
    <main>
      <RecordMasthead
        owned
        folio="Intelligence Brief"
        back={{ to: "/briefs", label: "Back to My Briefs" }}
        title={brief.title}
        dek={brief.note}
        plate={<BriefCover url={brief.coverImageUrl} cacheKey={brief.coverImageKey} upload={uploadCover} />}
        ledger={[
          // The endpoint is owner-only (403 otherwise), so a Brief on screen is
          // the reader's own — which is exactly what the mast's stock says, said
          // in words as well.
          { term: "Owner", value: "You" },
          { term: "Category", value: brief.category },
          {
            term: "Capacity",
            value: `${brief.articleCount}/${brief.articleCapacityLimit} articles${atCapacity ? " · full" : ""}`,
          },
          {
            term: "Created",
            value: <time dateTime={brief.createdAt}>{new Date(brief.createdAt).toLocaleDateString()}</time>,
          },
          {
            term: "Updated",
            value: <time dateTime={brief.updatedAt}>{new Date(brief.updatedAt).toLocaleDateString()}</time>,
          },
        ]}
      />

      {/* What can be done to the artefact itself, on the artefact: the edit is the
          page's one command (DESIGN.md's command button), the delete a plain
          ruled control — the inks name source layers and validation states, and a
          destructive action is neither. */}
      <div className="record-actions">
        <Link className="record-command" to={`/briefs/${brief.id}/edit`}>
          Edit Brief
        </Link>
        <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending}>
          {remove.isPending ? "Deleting…" : "Delete Brief"}
        </button>
      </div>
      {remove.isError && (
        <ErrorState>Could not delete this Brief: {(remove.error as Error).message}</ErrorState>
      )}

      {/* The saved analysis, above the Articles for the same reason Story detail puts
          it there: it is what the reader kept, and the Articles are what it cites.
          Frozen — this is the run the Brief pinned, not the Story's current one, which
          is what saving an analysis means (#55, ADR-0027). */}
      {brief.analysis && (
        <RecordSection heading="Saved analysis">
          <AnalysisRegister analysis={brief.analysis} />
          <p className="record-prose">
            Saved from its Story on{" "}
            <time dateTime={brief.analysis.completedAt}>
              {new Date(brief.analysis.completedAt).toLocaleDateString()}
            </time>
            . These claims stay as they are while the reporting develops — the Story goes on being analysed
            again, and this Brief keeps what it froze.
          </p>
        </RecordSection>
      )}

      <RecordSection heading="Attached Articles">
        {/* The line the whole owned/corpus distinction rests on: the Brief is
            yours, the Articles in it are not — they are the global corpus records
            it is built on, and each one opens as a corpus record with its Story
            above it. (A Brief cites Articles, not a Story: the Story is reached
            through an Article, which is the only path the API gives us —
            briefs/:id serves no Story, and #28 changes no endpoint.) */}
        <p className="record-prose">
          These are corpus Articles, held globally and owned by nobody. Open one to reach the
          Story it belongs to, or find more in <Link to="/stories">Browse Stories</Link>.
        </p>
        {brief.articles.length === 0 ? (
          <EmptyState>No Articles attached yet.</EmptyState>
        ) : (
          // The index's entry, as on a Story's Articles (#33) — one list
          // vocabulary for a corpus record wherever it is listed. The Remove
          // button is this list's own action: it detaches the Article from the
          // Brief and leaves the corpus record alone.
          <EntryList>
            {brief.articles.map((article) => (
              <ArticleEntry
                key={article.id}
                article={article}
                action={
                  <button
                    type="button"
                    onClick={() => detach.mutate(article.id)}
                    disabled={detach.isPending}
                  >
                    Remove
                  </button>
                }
              />
            ))}
          </EntryList>
        )}
        {detach.isError && (
          <ErrorState>Could not remove this Article: {(detach.error as Error).message}</ErrorState>
        )}
      </RecordSection>

      <RecordSection heading="Attach an Article">
        {atCapacity ? (
          <p className="record-prose">
            This Brief is at its article capacity ({brief.articleCapacityLimit}). Remove one, or
            raise the limit from <Link to={`/briefs/${brief.id}/edit`}>Edit Brief</Link>.
          </p>
        ) : (
          <p className="record-prose">
            Attach a corpus Article by its id — an Article&rsquo;s record page states it, from{" "}
            <Link to="/stories">Browse Stories</Link>.
          </p>
        )}
        {/* ponytail: pasting a UUID is the seam the API gives us today. An
            attach-from-the-Article-page control is the real fix and it is the
            Form archetype's ticket (#35), not this one's. */}
        <form className="record-attach" onSubmit={onAttach}>
          <label>
            Article id
            <input
              value={articleId}
              onChange={(e) => {
                setArticleId(e.target.value);
                setAttachError(null);
              }}
              disabled={atCapacity}
              aria-invalid={Boolean(attachError)}
            />
          </label>
          <button type="submit" disabled={atCapacity || attach.isPending}>
            {attach.isPending ? "Attaching…" : "Attach"}
          </button>
        </form>
        {attachError && <ErrorState>{attachError}</ErrorState>}
      </RecordSection>
    </main>
  );
}

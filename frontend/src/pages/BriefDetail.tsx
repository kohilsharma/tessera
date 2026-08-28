import { ChangeEvent, FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  attachArticleToBrief,
  deleteBrief,
  detachArticleFromBrief,
  getBrief,
  uploadBriefCoverImage,
} from "../api/client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  function onCoverImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadCover.mutate(file);
    e.target.value = "";
  }

  function onAttach(e: FormEvent) {
    e.preventDefault();
    if (!UUID_RE.test(articleId)) {
      setAttachError("Enter a valid Article id (see the Stories browser).");
      return;
    }
    setAttachError(null);
    attach.mutate(articleId);
  }

  if (query.isPending) return <p role="status">Loading Brief…</p>;
  if (query.isError)
    return (
      <div role="alert">
        <p>Could not load this Brief: {(query.error as Error).message}</p>
        <button type="button" onClick={() => query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? "Retrying…" : "Retry"}
        </button>
      </div>
    );

  const brief = query.data;
  const atCapacity = brief.articleCount >= brief.articleCapacityLimit;

  return (
    <main>
      <p>
        <Link to="/briefs">Back to My Briefs</Link>
      </p>
      <h1>{brief.title}</h1>
      {brief.coverImageUrl && <img src={brief.coverImageUrl} alt="" width={320} />}
      <p>
        {brief.category} · {brief.articleCount}/{brief.articleCapacityLimit} articles
      </p>
      {brief.note && <p>{brief.note}</p>}
      <p>
        <Link to={`/briefs/${brief.id}/edit`}>Edit</Link>{" "}
        <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending}>
          {remove.isPending ? "Deleting…" : "Delete Brief"}
        </button>
      </p>
      {remove.isError && (
        <p role="alert">Could not delete this Brief: {(remove.error as Error).message}</p>
      )}

      <p>
        <label>
          {brief.coverImageUrl ? "Replace cover image" : "Add a cover image"}{" "}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onCoverImageChange} disabled={uploadCover.isPending} />
        </label>
      </p>
      {uploadCover.isPending && <p role="status">Uploading…</p>}
      {uploadCover.isError && (
        <p role="alert">Could not upload this cover image: {(uploadCover.error as Error).message}</p>
      )}

      <h2>Articles</h2>
      {brief.articles.length === 0 ? (
        <p>No Articles attached yet.</p>
      ) : (
        <ul>
          {brief.articles.map((article) => (
            <li key={article.id}>
              <Link to={`/articles/${article.id}`}>{article.title}</Link> — {article.publisher.name}{" "}
              <button type="button" onClick={() => detach.mutate(article.id)} disabled={detach.isPending}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {detach.isError && <p role="alert">Could not remove this Article: {(detach.error as Error).message}</p>}

      <h3>Attach an Article</h3>
      <p>
        Find an Article&rsquo;s id from <Link to="/stories">Browse Stories</Link>.
      </p>
      <form onSubmit={onAttach}>
        <label>
          Article id{" "}
          <input
            value={articleId}
            onChange={(e) => {
              setArticleId(e.target.value);
              setAttachError(null);
            }}
            disabled={atCapacity}
            aria-invalid={Boolean(attachError)}
          />
        </label>{" "}
        <button type="submit" disabled={atCapacity || attach.isPending}>
          {attach.isPending ? "Attaching…" : "Attach"}
        </button>
      </form>
      {atCapacity && <p>This Brief is at its article capacity.</p>}
      {attachError && <p role="alert">{attachError}</p>}
    </main>
  );
}

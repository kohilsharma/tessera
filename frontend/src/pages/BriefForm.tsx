import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  createBrief,
  getBrief,
  updateBrief,
  DEFAULT_ARTICLE_CAPACITY_LIMIT,
  STORY_CATEGORIES,
  type StoryCategory,
} from "../api/client";
import { PendingState, RetryableError } from "../components/uiStates";

type FieldErrors = { title?: string; category?: string; articleCapacityLimit?: string; form?: string };

// Same component for create (/briefs/new) and edit (/briefs/:id/edit): editId
// present means "load and PATCH", absent means "start blank and POST" — mirrors
// backend/src/routes/briefs.ts accepting a partial body for either case.
export default function BriefForm() {
  const { id: editId } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(editId);

  const existing = useQuery({
    queryKey: ["brief", editId],
    queryFn: () => getBrief(editId!),
    enabled: isEdit,
  });

  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<StoryCategory>("technology");
  const [articleCapacityLimit, setArticleCapacityLimit] = useState(String(DEFAULT_ARTICLE_CAPACITY_LIMIT));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (existing.data) {
      setTitle(existing.data.title);
      setNote(existing.data.note ?? "");
      setCategory(existing.data.category);
      setArticleCapacityLimit(String(existing.data.articleCapacityLimit));
    }
  }, [existing.data]);

  function validate(): FieldErrors {
    const found: FieldErrors = {};
    if (title.trim().length === 0) found.title = "Title is required";
    const capacity = Number(articleCapacityLimit);
    if (!Number.isInteger(capacity) || capacity < 1) {
      found.articleCapacityLimit = "Must be a positive integer";
    }
    return found;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validate();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const input = { title, note: note || null, category, articleCapacityLimit: Number(articleCapacityLimit) };
      const brief = isEdit ? await updateBrief(editId!, input) : await createBrief(input);
      navigate(`/briefs/${brief.id}`);
    } catch (err) {
      setErrors({ form: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  if (isEdit && existing.isPending) return <PendingState>Loading Brief…</PendingState>;
  if (isEdit && existing.isError) {
    return (
      <RetryableError
        message={`Could not load this Brief: ${(existing.error as Error).message}`}
        onRetry={() => existing.refetch()}
        retrying={existing.isFetching}
      />
    );
  }

  return (
    <main>
      <p>
        <Link to="/briefs">Back to My Briefs</Link>
      </p>
      <h1>{isEdit ? "Edit Brief" : "New Brief"}</h1>
      <form onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="title">Title</label>
          <input
            id="title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setErrors((prev) => ({ ...prev, title: undefined }));
            }}
            required
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? "title-error" : undefined}
          />
          {errors.title && (
            <p id="title-error" role="alert">
              {errors.title}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="note">Note</label>
          <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div>
          <label htmlFor="category">Category</label>
          <select id="category" value={category} onChange={(e) => setCategory(e.target.value as StoryCategory)}>
            {STORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="articleCapacityLimit">Article capacity</label>
          <input
            id="articleCapacityLimit"
            type="number"
            min={1}
            step={1}
            value={articleCapacityLimit}
            onChange={(e) => {
              setArticleCapacityLimit(e.target.value);
              setErrors((prev) => ({ ...prev, articleCapacityLimit: undefined }));
            }}
            aria-invalid={Boolean(errors.articleCapacityLimit)}
            aria-describedby={errors.articleCapacityLimit ? "capacity-error" : undefined}
          />
          {errors.articleCapacityLimit && (
            <p id="capacity-error" role="alert">
              {errors.articleCapacityLimit}
            </p>
          )}
        </div>
        {errors.form && <p role="alert">{errors.form}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Create Brief"}
        </button>
      </form>
    </main>
  );
}

import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  createBrief,
  getBrief,
  updateBrief,
  uploadBriefCoverImage,
  COVER_IMAGE_ACCEPT,
  DEFAULT_ARTICLE_CAPACITY_LIMIT,
  STORY_CATEGORIES,
  type StoryCategory,
} from "../api/client";
import { useBriefCoverImage, useSelectedImagePreview } from "../components/coverImage";
import { Field, FormPage, FormSubmit } from "../components/formArchetype";
import { ErrorState, PendingState, RetryableError } from "../components/uiStates";

type FieldErrors = { title?: string; category?: string; articleCapacityLimit?: string; form?: string };

// Same component for create (/briefs/new) and edit (/briefs/:id/edit): editId
// present means "load and PATCH", absent means "start blank and POST" — mirrors
// backend/src/routes/briefs.ts accepting a partial body for either case.
//
// The Form archetype (#35) supplies the panel, the fields, the per-field error,
// and the one command; what is a Brief's own is the cover plate below.
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
  const [coverFile, setCoverFile] = useState<File | null>(null);
  // Set once a create has succeeded, so a failure *after* that — the cover
  // upload — leaves a retry updating the Brief that now exists instead of
  // creating a second one.
  const [savedId, setSavedId] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // The plate shows what will be saved: the picked file if there is one, else the
  // cover the Brief already carries (owner-only bytes, so fetched with the token
  // rather than pointed at by src — components/coverImage.tsx). Which of the
  // three it is gets said in words: the image is decorative, and an owner
  // confirming what they are about to save cannot rely on seeing it.
  const selectedSrc = useSelectedImagePreview(coverFile);
  const { src: existingSrc, failed: existingFailed } = useBriefCoverImage(
    existing.data?.coverImageUrl ?? null,
    existing.data?.coverImageKey ?? null,
  );
  const plateSrc = selectedSrc ?? existingSrc;
  // Four cases, not three: an existing cover is fetched with the token, so there
  // is a window where the Brief has one and the plate does not yet show it. The
  // record page spends the shared pending and error blocks on that window; here
  // the caption carries all four, because on the form nothing is in flight — the
  // upload happens on save — and a state block beside a 210px plate would say
  // less than the line already under it.
  const plateState = coverFile
    ? "Selected"
    : existingSrc
      ? "Current cover"
      : existingFailed
        ? "Current cover could not be loaded"
        : existing.data?.coverImageUrl
          ? "Loading current cover…"
          : "No cover image";

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
      const target = editId ?? savedId;
      const brief = target ? await updateBrief(target, input) : await createBrief(input);
      setSavedId(brief.id);
      // Second, and only if a file was picked: the cover endpoint needs a Brief
      // to attach the image to, which on create does not exist until now.
      if (coverFile) await uploadBriefCoverImage(brief.id, coverFile);
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
    <FormPage
      folio="Intelligence Brief"
      title={isEdit ? "Edit Brief" : "New Brief"}
      back={{ to: "/briefs", label: "Back to My Briefs" }}
      onSubmit={onSubmit}
    >
      <Field id="title" label="Title" error={errors.title}>
        {(props) => (
          <input
            {...props}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setErrors((prev) => ({ ...prev, title: undefined }));
            }}
            required
          />
        )}
      </Field>
      <Field id="note" label="Note" hint="Why you are keeping this Brief. Optional.">
        {(props) => <textarea {...props} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <Field id="category" label="Category">
        {(props) => (
          <select {...props} value={category} onChange={(e) => setCategory(e.target.value as StoryCategory)}>
            {STORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        id="articleCapacityLimit"
        label="Article capacity"
        error={errors.articleCapacityLimit}
        hint="How many Articles this Brief may hold."
      >
        {(props) => (
          <input
            {...props}
            type="number"
            min={1}
            step={1}
            value={articleCapacityLimit}
            onChange={(e) => {
              setArticleCapacityLimit(e.target.value);
              setErrors((prev) => ({ ...prev, articleCapacityLimit: undefined }));
            }}
          />
        )}
      </Field>

      {/* The plate is the record page's, at the same fixed ratio, so the owner
          confirms the image here in the shape it will be registered in there. It
          is always drawn: an absent cover and a picked one leave the same box,
          and the note beside it says which — the image itself is decorative
          (alt=""), the Brief's title names what it is a cover of. */}
      <div className="form-cover">
        <div>
          <div className="form-plate">{plateSrc && <img src={plateSrc} alt="" />}</div>
          {/* role="status" because this line changes under the reader — picking a
              file replaces it — and the image it describes is decorative, so
              without the announcement a screen-reader user has no way to confirm
              what will be saved. */}
          <p className="form-plate-note" role="status">
            {plateState}
            {coverFile && <span className="form-plate-file"> · {coverFile.name}</span>}
          </p>
        </div>
        <Field
          id="coverImage"
          label="Cover image"
          hint={
            existing.data?.coverImageUrl
              ? "JPEG, PNG, or WebP. Replaces the current cover when you save."
              : "JPEG, PNG, or WebP. Uploaded when you save this Brief."
          }
        >
          {(props) => (
            <input
              {...props}
              type="file"
              accept={COVER_IMAGE_ACCEPT}
              onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
            />
          )}
        </Field>
      </div>

      {errors.form && <ErrorState>{errors.form}</ErrorState>}
      <FormSubmit pending={submitting} pendingLabel="Saving…">
        {isEdit ? "Save changes" : "Create Brief"}
      </FormSubmit>
    </FormPage>
  );
}

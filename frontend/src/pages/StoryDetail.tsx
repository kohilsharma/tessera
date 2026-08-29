import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getStory } from "../api/client";
import { ArticleEntry } from "../components/indexArchetype";
import { RecordMasthead, RecordSection } from "../components/recordArchetype";
import { EmptyState, EntryList, PendingState, RetryableError } from "../components/uiStates";

// The first page on the Record archetype (#33): masthead, provenance ledger,
// body. Everything shaped here is shared — see components/recordArchetype.
export default function StoryDetail() {
  const { id } = useParams();
  const query = useQuery({ queryKey: ["story", id], queryFn: () => getStory(id!), enabled: !!id });

  if (query.isPending) return <PendingState>Loading Story…</PendingState>;
  // A Story that does not exist arrives here too, as the 404's own message
  // ("Story not found") in the shared error treatment.
  // ponytail: which leaves a Retry that cannot succeed. Telling a 404 apart
  // needs the status on the thrown error (api/client.ts throws bare Errors), and
  // every detail page in the app has this same branch — so it is one change
  // there and a pass over all of them, not two pages' worth here.
  if (query.isError)
    return (
      <RetryableError
        message={`Could not load Story: ${(query.error as Error).message}`}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );

  const story = query.data;

  return (
    <main>
      <RecordMasthead
        folio="Story"
        back={{ to: "/stories", label: "Back to Stories" }}
        title={story.title}
        dek={story.summary}
        // The coverage window is two facts, not one: when this Story was first
        // registered, and when it last moved.
        ledger={[
          { term: "Category", value: story.category },
          {
            term: "Coverage",
            value: `${story.articleCount} article${story.articleCount === 1 ? "" : "s"}`,
          },
          {
            term: "First seen",
            value: <time dateTime={story.firstSeenAt}>{new Date(story.firstSeenAt).toLocaleDateString()}</time>,
          },
          {
            term: "Last seen",
            value: <time dateTime={story.lastSeenAt}>{new Date(story.lastSeenAt).toLocaleDateString()}</time>,
          },
        ]}
      />

      <RecordSection heading="Articles">
        {story.articles.length === 0 ? (
          <EmptyState>No Articles yet.</EmptyState>
        ) : (
          // The index's entry, not a second list vocabulary: an Article listed
          // under its Story is the same kind of row as one listed anywhere else,
          // and its Publisher and date belong in the same provenance register.
          // No pagination here — a Story's Articles arrive whole.
          <EntryList>
            {story.articles.map((article) => (
              <ArticleEntry key={article.id} article={article} />
            ))}
          </EntryList>
        )}
      </RecordSection>
    </main>
  );
}

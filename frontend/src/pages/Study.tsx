import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getStudyDeck, reviewFlashcard, REVIEW_GRADES, type Flashcard } from "../api/client";
import { EmptyState, ErrorState, PendingState, RetryableError } from "../components/uiStates";

// The Student's study surface (#58, ADR-0021). One card at a time, not a list: a
// screen of twenty questions with their answers beside them is a transcript of an
// analysis, not revision — the answer has to be hidden for recall to be what is being
// tested, and hiding twenty of them is twenty decisions a reader did not ask for.
//
// The four shared UI states are all here, and the two empty ones are different facts:
// no cards at all is a deck to go and make, nothing due is a session finished.

// What a claim type is, said as what the card is drilling. The analysis register's own
// labels read as sections of a document ("Where the reporting agrees"); on a card the
// same fact is a kind of question.
const CARD_KIND: Record<Flashcard["claimType"], string> = {
  consensus: "Agreement",
  contradiction: "Disagreement",
  source_specific: "Single source",
  student_context: "Context",
  investor_implication: "Implication",
};

function Card({ card, dueCount }: { card: Flashcard; dueCount: number }) {
  const queryClient = useQueryClient();
  // Revealing is local and per card, keyed by the card's id, so the next question
  // never arrives already answered.
  const [revealed, setRevealed] = useState(false);
  const review = useMutation({
    mutationFn: (grade: number) => reviewFlashcard(card.id, grade),
    // Refetched rather than advanced in place: the schedule is the server's, and the
    // next card is whatever is due after this one was rescheduled.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["flashcards"] }),
  });

  return (
    <div className="study-card">
      <p className="study-folio">
        {/* What is left, not "card 3 of 8": nothing records when a session started, so
            a position would be a number this surface invented. The count falls as each
            card is answered, which is the progress a reader actually has. */}
        <span>
          {dueCount} card{dueCount === 1 ? "" : "s"} due
        </span>
        <span>{CARD_KIND[card.claimType]}</span>
      </p>
      <p className="study-question">{card.question}</p>

      {!revealed ? (
        <div className="record-actions">
          <button type="button" className="record-command" onClick={() => setRevealed(true)}>
            Show answer
          </button>
        </div>
      ) : (
        <>
          <p className="study-answer">{card.answer}</p>
          {/* The invariant, on a study card: the answer is a claim, and the reporting
              it rests on is named and openable. A card is not a fact a reader is
              asked to take on trust. */}
          <p className="claim-cites">
            {card.citations.map((citation) => (
              <Link key={citation.evidenceId} to={`/articles/${citation.articleId}`}>
                {citation.evidenceId} · {citation.publisherName}
              </Link>
            ))}
          </p>
          <p className="claim-measure">
            From <Link to={`/stories/${card.storyId}`}>{card.storyTitle}</Link>
          </p>
          <div className="record-actions">
            {REVIEW_GRADES.map(({ grade, label }) => (
              <button
                key={grade}
                type="button"
                onClick={() => review.mutate(grade)}
                disabled={review.isPending}
              >
                {label}
              </button>
            ))}
          </div>
          {review.isError && <ErrorState>Could not record this review: {review.error.message}</ErrorState>}
        </>
      )}
    </div>
  );
}

export default function Study() {
  const query = useQuery({ queryKey: ["flashcards"], queryFn: getStudyDeck });

  if (query.isPending) return <PendingState>Loading your flashcards…</PendingState>;
  if (query.isError)
    return (
      <RetryableError
        message={`Could not load your flashcards: ${query.error.message}`}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );

  const deck = query.data;
  const card = deck.items[0];

  return (
    <main className="stated-page">
      <h1>Flashcards</h1>
      <p className="record-prose">
        Each card answers with a claim from an analysis you studied, and names the reporting behind it. Answer
        honestly — how hard it was is what decides when the card comes back.
      </p>

      {deck.totalCount === 0 ? (
        <EmptyState>
          <p>No flashcards yet. A deck is made from an analysis of a Story you are studying.</p>
          <p>
            <Link to="/stories">Browse Stories</Link>, request an analysis, and make cards from it — or from a{" "}
            <Link to="/briefs">Brief</Link> you have already saved one into.
          </p>
        </EmptyState>
      ) : !card ? (
        <EmptyState>
          <p>
            Nothing due. You have {deck.totalCount} card{deck.totalCount === 1 ? "" : "s"} in hand
            {deck.nextDueAt && (
              <>
                , and the next is due{" "}
                <time dateTime={deck.nextDueAt}>{new Date(deck.nextDueAt).toLocaleDateString()}</time>
              </>
            )}
            .
          </p>
        </EmptyState>
      ) : (
        // Keyed by the card, so revealing an answer never carries over to the next
        // question when the deck is refetched.
        <Card key={card.id} card={card} dueCount={deck.dueCount} />
      )}
    </main>
  );
}

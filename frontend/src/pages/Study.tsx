import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  getMe,
  getStudyDeck,
  getAllFlashcards,
  generateFlashcardsFromSearch,
  updateFlashcard,
  deleteFlashcard,
  getFlashcardHistory,
  reviewFlashcard,
  REVIEW_GRADES,
  type Flashcard,
  type ReviewGrade,
} from "../api/client";
import { EmptyState, ErrorState, PendingState, RefusedState, RetryableError } from "../components/uiStates";
import { CitationRow } from "../components/analysisRegister";
import { EntryRegister, FilterRegister } from "../components/indexArchetype";
import { ArrowClockwise, Cards, ClockCounterClockwise, Eye, MagnifyingGlass, PencilSimple, Trash } from "@phosphor-icons/react";

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
    mutationFn: (grade: ReviewGrade) => reviewFlashcard(card.id, grade),
    // Refetched rather than advanced in place: the schedule is the server's, and the
    // next card is whatever is due after this one was rescheduled.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["flashcards"] }),
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.matches("input, textarea, select") || event.target.isContentEditable)) return;
      if (!revealed && event.key === " ") { event.preventDefault(); setRevealed(true); }
      if (revealed && !review.isPending) {
        const grade = ({ "1": 0, "2": 3, "3": 4, "4": 5 } as Record<string, ReviewGrade | undefined>)[event.key];
        if (grade !== undefined) review.mutate(grade);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, review.isPending]);

  return (
    <article className="study-card" aria-label="Flashcard study prompt">
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
          <button type="button" className="record-command study-reveal" onClick={() => setRevealed(true)} aria-label="Show answer" aria-keyshortcuts="Space">
            <Eye aria-hidden size={20} /> Show answer
          </button>
        </div>
      ) : (
        <>
          <p className="study-answer">{card.answer}</p>
          {/* The invariant, on a study card: the answer is a claim, and the reporting
              it rests on is named and openable. A card is not a fact a reader is
              asked to take on trust. The same row the analysis register renders, for
              the same reason it is the same fact. */}
          <CitationRow citations={card.citations} />
          {card.storyId && <p className="claim-note">From <Link to={`/stories/${card.storyId}`}>{card.storyTitle}</Link></p>}
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
    </article>
  );
}

function ManagedCard({ card, onSaved, onDeleted }: { card: Flashcard; onSaved: () => void; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(card.question);
  const [answer, setAnswer] = useState(card.answer);
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = useQuery({ queryKey: ["flashcards", card.id, "history"], queryFn: () => getFlashcardHistory(card.id), enabled: historyOpen });
  const save = useMutation({ mutationFn: () => updateFlashcard(card.id, { question, answer }), onSuccess: () => { setEditing(false); onSaved(); } });
  const remove = useMutation({ mutationFn: () => deleteFlashcard(card.id), onSuccess: onDeleted });
  const due = new Date(card.dueAt).getTime() <= Date.now();
  return <li className="study-deck-card">
    <div className="study-deck-card-head">
      <span className={`study-status${due ? " study-status--due" : ""}`}>{due ? "Due now" : `Due ${new Date(card.dueAt).toLocaleDateString()}`}</span>
      <span className="study-card-kind">{CARD_KIND[card.claimType]}</span>
    </div>
    {editing ? <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <label>Question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} /></label>
      <label>Answer<textarea value={answer} onChange={(event) => setAnswer(event.target.value)} /></label>
      <div className="record-actions"><button type="submit" disabled={save.isPending}>Save</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>
      {save.isError && <ErrorState>Could not save this card: {save.error.message}</ErrorState>}
    </form> : <><p className="study-deck-question">{card.question}</p><p className="study-deck-answer">{card.answer}</p><CitationRow citations={card.citations} /></>}
    <div className="record-actions">
      <button type="button" aria-label="Edit flashcard" title="Edit" onClick={() => setEditing(true)}><PencilSimple aria-hidden /></button>
      <button type="button" aria-label="Show study history" title="Study history" onClick={() => setHistoryOpen((open) => !open)}><ClockCounterClockwise aria-hidden /></button>
      <button type="button" aria-label="Delete flashcard" title="Delete" onClick={() => remove.mutate()}><Trash aria-hidden /></button>
    </div>
    {remove.isError && <ErrorState>Could not delete this card: {remove.error.message}</ErrorState>}
    {historyOpen && (history.isPending ? <PendingState>Loading study history…</PendingState> : history.isError ? <ErrorState>{history.error.message}</ErrorState> : history.data.items.length ? <ul>{history.data.items.map((item) => <li key={item.reviewedAt}><time dateTime={item.reviewedAt}>{new Date(item.reviewedAt).toLocaleString()}</time> · grade {item.grade}</li>)}</ul> : <p>No reviews yet.</p>)}
  </li>;
}

export default function Study() {
  const me = useQuery({ queryKey: ["me"], queryFn: getMe });
  const query = useQuery({
    queryKey: ["flashcards"],
    queryFn: getStudyDeck,
    enabled: me.data?.role === "student",
  });
  const [allFilter, setAllFilter] = useState<"all" | "due" | "upcoming">("all");
  const [allSearch, setAllSearch] = useState("");
  const [allPage, setAllPage] = useState(1);
  const all = useQuery({
    queryKey: ["flashcards", "all", allFilter, allSearch, allPage],
    queryFn: () => getAllFlashcards({ status: allFilter, q: allSearch, page: allPage, pageSize: 20 }),
    enabled: me.data?.role === "student",
  });
  const [search, setSearch] = useState("");
  const [count, setCount] = useState<5 | 10 | 20>(5);
  const [answerLength, setAnswerLength] = useState<"one_word" | "one_line" | "full">("full");
  const generate = useMutation({ mutationFn: () => generateFlashcardsFromSearch({ q: search, count, answerLength }), onSuccess: () => { setSearch(""); query.refetch(); all.refetch(); } });

  if (me.isPending) return <PendingState>Loading your flashcards…</PendingState>;
  if (me.isError)
    return (
      <RetryableError
        message={`Could not verify access to your flashcards: ${me.error.message}`}
        onRetry={() => me.refetch()}
        retrying={me.isFetching}
      />
    );
  if (me.data.role !== "student") return <RefusedState role="Students">Flashcards are available only to Students.</RefusedState>;

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
  const allCards = all.data?.cards ?? [];
  const allEnvelope = all.data ? { ...all.data, cards: allCards, total: all.data.total ?? allCards.length } : null;

  return (
    <main className="stated-page study-page">
      <header className="study-header">
        <div>
          <p className="study-kicker"><Cards aria-hidden size={18} /> Your desk</p>
          <h1>Flashcards</h1>
          <p className="record-prose">Recall first, then check the cited answer. Your grade decides when each card returns.</p>
        </div>
        <div className="study-count" aria-label={`${deck.totalCount} cards in deck`}><strong>{deck.totalCount}</strong><span>in deck</span></div>
      </header>

      <section className="study-create" aria-labelledby="create-cards-heading">
        <div className="study-section-heading"><div><h2 id="create-cards-heading">Make a new set</h2><p>Search accepted reporting and freeze the results into your own cited cards.</p></div></div>
        <form className="study-create-form" onSubmit={(event) => { event.preventDefault(); if (search.trim()) generate.mutate(); }}>
          <label className="study-search-field"><span>Search reporting</span><span className="study-input-wrap"><MagnifyingGlass aria-hidden size={20} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try a topic, place, or person" /></span></label>
          <label><span>Cards</span><select value={count} onChange={(event) => setCount(Number(event.target.value) as 5 | 10 | 20)} aria-label="Card count"><option value={5}>5 cards</option><option value={10}>10 cards</option><option value={20}>20 cards</option></select></label>
          <label><span>Answer length</span><select value={answerLength} onChange={(event) => setAnswerLength(event.target.value as typeof answerLength)} aria-label="Answer length"><option value="one_word">One word</option><option value="one_line">One line</option><option value="full">Full answer</option></select></label>
          <button type="submit" disabled={generate.isPending || !search.trim()}>{generate.isPending ? <><ArrowClockwise className="study-spin" aria-hidden size={18} /> Making cards…</> : "Generate cards"}</button>
        </form>
        {generate.isError && <ErrorState>{generate.error.message}</ErrorState>}
        {generate.isSuccess && <p className="study-success" role="status">Cards added to your deck.</p>}
      </section>
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
      <section className="study-deck" aria-labelledby="all-cards-heading">
        <div className="study-section-heading"><div><h2 id="all-cards-heading">Your deck</h2><p>Browse every card, including the ones scheduled for later.</p></div></div>
        {all.isPending ? <PendingState>Loading your full deck…</PendingState> : all.isError ? <RetryableError message={`Could not load your full deck: ${all.error.message}`} onRetry={() => all.refetch()} retrying={all.isFetching} /> : <>
        <FilterRegister label="Filter your flashcards">
          <label>Show <select value={allFilter} onChange={(event) => { setAllFilter(event.target.value as typeof allFilter); setAllPage(1); }}><option value="all">All cards</option><option value="due">Due now</option><option value="upcoming">Upcoming</option></select></label>
          <label>Find <input value={allSearch} onChange={(event) => { setAllSearch(event.target.value); setAllPage(1); }} placeholder="Question or answer" /></label>
        </FilterRegister>
        {allCards.length && allEnvelope ? <EntryRegister envelope={allEnvelope} onGoToPage={setAllPage}>{allCards.map((item) => <ManagedCard key={item.id} card={item} onSaved={() => all.refetch()} onDeleted={() => { query.refetch(); all.refetch(); }} />)}</EntryRegister> : <EmptyState><p>{allFilter === "all" && !allSearch ? "Your deck is empty. Generate cards above or from a completed analysis." : "No cards match this filter."}</p></EmptyState>}
        </>}
      </section>
    </main>
  );
}

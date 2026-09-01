import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  getMe,
  makeFlashcards,
  MAX_STUDY_DETAIL_LENGTH,
  type Analysis,
  type AnalysisClaim,
  type ClaimType,
  type EvidenceRow,
} from "../api/client";

// One rendering of a cited analysis, for the two records that carry one: the Story it
// was written about (#53) and the Brief a reader saved it into (#55). Shared because a
// saved analysis is the *same* analysis — a second vocabulary for it would be a second
// chance to render a citation that does not resolve.
//
// It reads differently under the two Lenses (#56), off the analysis's own `lens` rather
// than off the reader — so a saved investor analysis keeps its reading in a Brief, and
// an Admin looking through the investor Lens sees what an Investor sees.

// The reading order of an analysis: what the reporting agrees on, then where it
// disagrees, then what only one outlet says, then the reader's own Lens. Agreement
// first because it is the strongest thing the evidence supports; the Lens last
// because it is the interpretation, not the reporting.
const CLAIM_ORDER: ClaimType[] = [
  "consensus",
  "contradiction",
  "source_specific",
  "student_context",
  "investor_implication",
];

// The Investor reading (ADR-0021's differentiator): the agreement/disagreement axis
// first, then the implication that reads off it, and single-source reporting last —
// it is the weakest corroboration on that axis, not the second thing to look at.
const INVESTOR_CLAIM_ORDER: ClaimType[] = [
  "consensus",
  "contradiction",
  "investor_implication",
  "source_specific",
];

const CLAIM_LABELS: Record<ClaimType, string> = {
  consensus: "Where the reporting agrees",
  contradiction: "Where it disagrees",
  source_specific: "Reported by one outlet only",
  student_context: "Context",
  investor_implication: "Investor implication",
};

// A citation is the invariant made clickable: the evidence id the claim cited, the
// outlet it resolves to, and a link to the Article itself. An id with no frozen row
// behind it is not rendered — the backend cannot persist one, and this is the last
// place that could put one on screen.
function Citations({ claim, evidence }: { claim: AnalysisClaim; evidence: Map<string, EvidenceRow> }) {
  return (
    <p className="claim-cites">
      {claim.citations.map((evidenceId) => {
        const row = evidence.get(evidenceId);
        if (!row) return null;
        return (
          <Link key={evidenceId} to={`/articles/${row.articleId}`}>
            {evidenceId} · {row.publisher.name}
          </Link>
        );
      })}
    </p>
  );
}

// The rows a claim cited, grouped by Publisher for the corroboration count. A
// contradiction does not use this grouping: its polarity comes from citationSides.
function citedByPublisher(claim: AnalysisClaim, evidence: Map<string, EvidenceRow>): EvidenceRow[][] {
  const sides = new Map<string, EvidenceRow[]>();
  for (const evidenceId of claim.citations) {
    const row = evidence.get(evidenceId);
    if (!row) continue;
    sides.set(row.publisher.id, [...(sides.get(row.publisher.id) ?? []), row]);
  }
  return [...sides.values()];
}

// A contradiction's actual polarity, recorded below the prompt and persisted with
// each citation. Publisher grouping alone is not a side: two Publishers may support
// one position against a third.
function ContradictionSides({ claim, evidence }: { claim: AnalysisClaim; evidence: Map<string, EvidenceRow> }) {
  if (!claim.citationSides) {
    return (
      <>
        <p className="claim-measure">This earlier analysis did not record which citation was on each side</p>
        <Citations claim={claim} evidence={evidence} />
      </>
    );
  }
  return (
    <ul className="claim-sides">
      {claim.citationSides.map((side) => (
        <li key={side.relationship}>
          <p className="side-publisher">{side.relationship === "supports" ? "Supports" : "Contradicts"}</p>
          {side.citations.map((evidenceId) => {
            const row = evidence.get(evidenceId);
            if (!row) return null;
            return (
              <p key={row.evidenceId} className="side-cite">
                <span>{row.publisher.name}</span> ·{" "}
                <Link to={`/articles/${row.articleId}`}>
                  <span>{row.evidenceId}</span> · {row.title}
                </Link>
              </p>
            );
          })}
        </li>
      ))}
    </ul>
  );
}

// What an agreement is worth, counted in Publishers (#56): the distinct Publishers this
// claim cited, against the distinct Publishers in the whole frozen set. It means
// separate reports rather than one wire story counted several times, because the
// EvidenceSet collapsed near-identical copy when it was frozen (ADR-0027) — which is
// what makes the count worth reading at all.
function Corroboration({
  claim,
  evidence,
  totalPublisherCount,
}: {
  claim: AnalysisClaim;
  evidence: Map<string, EvidenceRow>;
  totalPublisherCount: number;
}) {
  const cited = citedByPublisher(claim, evidence).length;
  return (
    <p className="claim-measure">
      Cited to {cited} of {totalPublisherCount} publisher{totalPublisherCount === 1 ? "" : "s"} in the evidence
    </p>
  );
}

function FlashcardCommand({ generationRunId }: { generationRunId: string }) {
  const me = useQuery({ queryKey: ["me"], queryFn: getMe });
  const navigate = useNavigate();
  const [studyDetail, setStudyDetail] = useState("");
  const make = useMutation({
    mutationFn: () => makeFlashcards(generationRunId, studyDetail),
    onSuccess: () => navigate("/study"),
  });

  // Flashcards are the Student's distinct role feature (ADR-0004, ADR-0021). An
  // Investor or Admin is not merely hidden by this check — the API refuses them too —
  // but a command that can only answer 403 has no place on their analysis.
  if (me.data?.role !== "student") return null;
  return (
    <>
      <form
        className="record-attach"
        onSubmit={(event) => {
          event.preventDefault();
          make.mutate();
        }}
      >
        <label htmlFor={`study-focus-${generationRunId}`}>
          Study focus (optional)
          <input
            id={`study-focus-${generationRunId}`}
            value={studyDetail}
            maxLength={MAX_STUDY_DETAIL_LENGTH}
            placeholder="e.g. the policy timeline"
            disabled={make.isPending}
            onChange={(event) => setStudyDetail(event.target.value)}
          />
        </label>
        <button type="submit" className="record-command" disabled={make.isPending}>
          {make.isPending ? "Making flashcards…" : "Make flashcards"}
        </button>
      </form>
      {make.isError && <p className="state-error">Could not make flashcards: {make.error.message}</p>}
    </>
  );
}

export function AnalysisRegister({ analysis }: { analysis: Analysis }) {
  const evidence = new Map(analysis.evidence.map((row) => [row.evidenceId, row]));
  const investor = analysis.lens === "investor_implication";
  const groups = (investor ? INVESTOR_CLAIM_ORDER : CLAIM_ORDER)
    .map((claimType) => ({
      claimType,
      claims: analysis.claims.filter((claim) => claim.claimType === claimType),
    }))
    // Disagreement is the axis the Investor Lens exists for, so its group is kept even
    // when it is empty and says so: a contradiction the model wrote can be refused for
    // citing one Publisher (#54), and a reader who is shown nothing cannot tell that
    // from outlets who agree.
    .filter((group) => group.claims.length > 0 || (investor && group.claimType === "contradiction"));

  return (
    <>
      <p className="record-prose">
        Written from {analysis.articleCount} Article{analysis.articleCount === 1 ? "" : "s"} across{" "}
        {analysis.distinctPublisherCount} publisher{analysis.distinctPublisherCount === 1 ? "" : "s"}, frozen when
        this analysis was made. Every claim carries the reporting it rests on.
        {investor &&
          " Near-identical copies of one report were counted once when this evidence was frozen, so these" +
            " publishers are separate reports rather than one wire story repeated."}
      </p>
      <dl className="record-note">
        {groups.map((group) => (
          <div key={group.claimType}>
            <dt>{CLAIM_LABELS[group.claimType]}</dt>
            <dd>
              {group.claims.length === 0 ? (
                <p className="claim-measure">No disagreement between these outlets is recorded in this analysis</p>
              ) : (
                <ul className="claim-list">
                  {group.claims.map((claim) => (
                    <li key={claim.id}>
                      <p>{claim.text}</p>
                      {investor && claim.claimType === "contradiction" ? (
                        <ContradictionSides claim={claim} evidence={evidence} />
                      ) : (
                        <Citations claim={claim} evidence={evidence} />
                      )}
                      {investor && claim.claimType === "consensus" && (
                        <Corroboration
                          claim={claim}
                          evidence={evidence}
                          totalPublisherCount={analysis.distinctPublisherCount}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <FlashcardCommand generationRunId={analysis.id} />
    </>
  );
}

import { Link } from "react-router-dom";
import type { Analysis, AnalysisClaim, ClaimType, EvidenceRow } from "../api/client";

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

// The rows a claim cited, grouped by the Publisher that filed them. Both the sides of a
// contradiction and the count behind an agreement are readings of this one grouping.
function citedByPublisher(claim: AnalysisClaim, evidence: Map<string, EvidenceRow>): EvidenceRow[][] {
  const sides = new Map<string, EvidenceRow[]>();
  for (const evidenceId of claim.citations) {
    const row = evidence.get(evidenceId);
    if (!row) continue;
    sides.set(row.publisher.id, [...(sides.get(row.publisher.id) ?? []), row]);
  }
  return [...sides.values()];
}

// A contradiction with both sides shown (#56): the outlets that disagree, each with the
// reporting the claim cited for it. The claim text says what the disagreement is; this
// says who is on each side of it and gives the reader the way to check — which is what
// separates "sources disagree" from an evidence trail.
//
// It replaces the flat citation row rather than joining it: the same links, grouped by
// Publisher and carrying the headline they resolve to.
function ContradictionSides({ claim, evidence }: { claim: AnalysisClaim; evidence: Map<string, EvidenceRow> }) {
  return (
    <ul className="claim-sides">
      {citedByPublisher(claim, evidence).map((rows) => (
        <li key={rows[0].publisher.id}>
          <p className="side-publisher">{rows[0].publisher.name}</p>
          {rows.map((row) => (
            <p key={row.evidenceId} className="side-cite">
              <Link to={`/articles/${row.articleId}`}>
                <span>{row.evidenceId}</span> · {row.title}
              </Link>
            </p>
          ))}
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
function Corroboration({ claim, evidence, of }: { claim: AnalysisClaim; evidence: Map<string, EvidenceRow>; of: number }) {
  const cited = citedByPublisher(claim, evidence).length;
  return (
    <p className="claim-measure">
      Cited to {cited} of {of} publisher{of === 1 ? "" : "s"} in the evidence
    </p>
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
                        <Corroboration claim={claim} evidence={evidence} of={analysis.distinctPublisherCount} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

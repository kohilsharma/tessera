import { Link } from "react-router-dom";
import type { Analysis, AnalysisClaim, ClaimType, EvidenceRow } from "../api/client";

// One rendering of a cited analysis, for the two records that carry one: the Story it
// was written about (#53) and the Brief a reader saved it into (#55). Shared because a
// saved analysis is the *same* analysis — a second vocabulary for it would be a second
// chance to render a citation that does not resolve.

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

export function AnalysisRegister({ analysis }: { analysis: Analysis }) {
  const evidence = new Map(analysis.evidence.map((row) => [row.evidenceId, row]));
  const groups = CLAIM_ORDER.map((claimType) => ({
    claimType,
    claims: analysis.claims.filter((claim) => claim.claimType === claimType),
  })).filter((group) => group.claims.length > 0);

  return (
    <>
      <p className="record-prose">
        Written from {analysis.articleCount} Article{analysis.articleCount === 1 ? "" : "s"} across{" "}
        {analysis.distinctPublisherCount} publisher{analysis.distinctPublisherCount === 1 ? "" : "s"}, frozen when
        this analysis was made. Every claim carries the reporting it rests on.
      </p>
      <dl className="record-note">
        {groups.map((group) => (
          <div key={group.claimType}>
            <dt>{CLAIM_LABELS[group.claimType]}</dt>
            <dd>
              <ul className="claim-list">
                {group.claims.map((claim) => (
                  <li key={claim.id}>
                    <p>{claim.text}</p>
                    <Citations claim={claim} evidence={evidence} />
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

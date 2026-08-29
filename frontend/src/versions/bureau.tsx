import { useState } from "react";
import { flushSync } from "react-dom";
import { evidence, filters, modeDescription } from "../data";
import type { Claim } from "../data";
import type { SharedState } from "./BureauPrototype";

export default function Bureau({
  filter,
  lens,
  activeClaim,
  activeEvidenceId,
  saved,
  saving,
  saveFailed,
  visibleClaims,
  setFilter,
  changeLens,
  inspect,
  setSaved,
  saveBrief,
}: SharedState) {
  const [metaOpen, setMetaOpen] = useState(false);
  const activeEvidence = evidence.find((item) => item.id === activeEvidenceId) ?? evidence[0];
  const registeredIds = new Set([...activeClaim.evidence, ...(activeClaim.contradicts ?? [])]);

  function inspectWithMorph(claim: Claim, evidenceId: string, source?: HTMLElement) {
    const canMorph =
      source && "startViewTransition" in document && matchMedia("(min-width: 1051px) and (prefers-reduced-motion: no-preference)").matches;

    if (canMorph) {
      document.documentElement.classList.add("evidence-transitioning");
      source.style.viewTransitionName = "evidence-morph";
      const transition = document.startViewTransition(() => {
        source.style.viewTransitionName = "";
        flushSync(() => inspect(claim, evidenceId));
        document.querySelector<HTMLElement>(".evidence-sheet")!.style.viewTransitionName = "evidence-morph";
      });
      transition.finished.finally(() => {
        document.documentElement.classList.remove("evidence-transitioning");
        document.querySelector<HTMLElement>(".evidence-sheet")?.style.removeProperty("view-transition-name");
      });
      return;
    }

    inspect(claim, evidenceId);
    const smooth = matchMedia("(prefers-reduced-motion: no-preference)").matches;
    document.getElementById("evidence-bench")?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "nearest" });
  }

  return (
    <>
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Tessera home">
          <span className="mark" aria-hidden="true"><i /><i /></span>
          TESSERA
        </a>
        <nav aria-label="Primary navigation">
          <a className="active" href="#analysis">Stories</a>
          <a href="#briefs">My Briefs</a>
          <a href="#search">Search</a>
        </nav>
        <button className="identity" type="button" aria-label="Open profile">KS <span>Student</span></button>
      </header>

      <main id="top">
        <section className="story-mast" aria-labelledby="story-title">
          <div className="mast-index" aria-hidden="true">STORY / 0427</div>
          <div className="story-heading">
            <p className="return-link">Back to Stories <span>Seeded demonstration data</span></p>
            <h1 id="story-title">Europe's semiconductor alliance moves from funding to fabrication</h1>
            <p className="dek">Four Publishers report a confirmed pilot target, while equipment risk and subsidy timing remain unresolved.</p>
          </div>
          <div className="mast-actions">
            <div className="lens-control" aria-label="Analysis lens">
              <button className={lens === "Student" ? "selected" : ""} onClick={() => changeLens("Student")} type="button">Student</button>
              <button className={lens === "Investor" ? "selected" : ""} onClick={() => changeLens("Investor")} type="button">Investor</button>
            </div>
            <button className="save-button" type="button" onClick={saveBrief} disabled={saved || saving}>
              {saving ? "Sealing…" : saved ? "Saved as IntelligenceBrief" : "Save IntelligenceBrief"}
            </button>
          </div>
          <dl className="story-ledger">
            <div><dt>EvidenceSet</dt><dd>ES-0427.03 / frozen</dd></div>
            <div><dt>Evidence</dt><dd>4 Articles / 4 Publishers</dd></div>
            <div><dt>Generated</dt><dd>30 Jul 2026, 09:42 UTC</dd></div>
            <div><dt>Analysis Text Mode</dt><dd>Feed excerpt or better</dd></div>
          </dl>
        </section>

        <section className="workspace" id="analysis">
          <div className="analysis-register">
            <div className="register-heading">
              <div>
                <h2>What reporting supports</h2>
              </div>
              <span className="validation-stamp">Citations valid</span>
            </div>

            <div className="filter-row" aria-label="Filter claims">
              {filters.map((item) => (
                <button key={item} type="button" className={filter === item ? "selected" : ""} onClick={() => setFilter(item)}>
                  {item}
                </button>
              ))}
            </div>

            <div className="claim-list" aria-live="polite">
              {visibleClaims.map((claim) => (
                <article key={claim.id} id={`claim-${claim.id}`} className={`claim claim-${claim.type.toLowerCase().replace(/\s/g, "-")} ${activeClaim.id === claim.id ? "active-claim" : ""}`}>
                  <header>
                    <span className={`claim-type type-${claim.type.toLowerCase().replace(/\s/g, "-")}`}>{claim.type}</span>
                    <span className="claim-id">{claim.id}</span>
                  </header>
                  <p>{claim.text}</p>
                  <div className="citation-row">
                    <span>Supported by</span>
                    {claim.evidence.map((id) => (
                      <button key={id} type="button" className={activeClaim.id === claim.id && activeEvidenceId === id ? "active-citation" : ""} onClick={(event) => inspectWithMorph(claim, id, event.currentTarget)} aria-label={`Inspect supporting evidence ${id}`} aria-pressed={activeClaim.id === claim.id && activeEvidenceId === id}>
                        <b>{id}</b> {evidence.find((item) => item.id === id)?.publisher}
                      </button>
                    ))}
                    {claim.contradicts?.map((id) => (
                      <button className={`opposing ${activeClaim.id === claim.id && activeEvidenceId === id ? "active-citation" : ""}`} key={id} type="button" onClick={(event) => inspectWithMorph(claim, id, event.currentTarget)} aria-label={`Inspect contradicting evidence ${id}`} aria-pressed={activeClaim.id === claim.id && activeEvidenceId === id}>
                        <b>{id}</b> opposes
                      </button>
                    ))}
                  </div>
                </article>
              ))}
              {visibleClaims.length === 0 && <p className="empty-state">No validated claims match this filter.</p>}
            </div>
          </div>

          <aside className="evidence-bench" id="evidence-bench" aria-labelledby="evidence-title">
            <div className="bench-heading">
              <div>
                <p className="folio">FROZEN EVIDENCE / EXACT SNAPSHOT</p>
                <h2 id="evidence-title">Registration bench</h2>
              </div>
              <span className="crosshair" aria-hidden="true">+</span>
            </div>

            <p className="bench-context">
              Registered to <a href={`#claim-${activeClaim.id}`}>{activeClaim.id}</a>
              <span>{activeClaim.text}</span>
            </p>

            <div key={`${activeClaim.id}-${activeEvidence.id}`} className={`relation-lock relation-${activeEvidence.ink}`} aria-live="polite">
              <span>{activeClaim.id}</span>
              <b aria-hidden="true">+</b>
              <span>{activeEvidence.id}</span>
              <strong>{activeClaim.evidence.includes(activeEvidence.id) ? "Support registered" : activeClaim.contradicts?.includes(activeEvidence.id) ? "Contradiction registered" : "Outside active claim"}</strong>
            </div>

            <div className="source-register" aria-label="Evidence sources">
              {evidence.map((item) => {
                const relevant = registeredIds.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`${item.ink} ${activeEvidence.id === item.id ? "active-source" : ""} ${relevant ? "registered" : "muted"}`}
                    onClick={() => inspect(activeClaim, item.id)}
                    aria-pressed={activeEvidence.id === item.id}
                  >
                    <b>{item.id}</b><span>{item.publisher}</span><small>{relevant ? "registered" : "outside claim"}</small>
                  </button>
                );
              })}
            </div>

            <article key={activeEvidence.id} className={`evidence-sheet ink-${activeEvidence.ink}`}>
              <header>
                <span className="evidence-number">{activeEvidence.id}</span>
                <div><b>{activeEvidence.publisher}</b><time>{activeEvidence.date}</time></div>
              </header>
              <h3>{activeEvidence.title}</h3>
              <blockquote>{activeEvidence.excerpt}</blockquote>
              <dl>
                <div><dt>Snapshot</dt><dd title={activeEvidence.hash}>sha256: {activeEvidence.hash.slice(0, 7)}…{activeEvidence.hash.slice(-4)}</dd></div>
                <div><dt>Text mode</dt><dd>{activeEvidence.mode}</dd></div>
                <div><dt>Relation</dt><dd>{activeClaim.evidence.includes(activeEvidence.id) ? "Supports active claim" : activeClaim.contradicts?.includes(activeEvidence.id) ? "Contradicts active claim" : "Not cited by active claim"}</dd></div>
              </dl>
              <button type="button" className="meta-toggle" aria-expanded={metaOpen} onClick={() => setMetaOpen((open) => !open)}>
                {metaOpen ? "Hide Article metadata" : "View Article metadata"} <span aria-hidden="true">{metaOpen ? "−" : "→"}</span>
              </button>
              {metaOpen && (
                <dl className="meta-panel">
                  <div><dt>Article</dt><dd>{activeEvidence.title}</dd></div>
                  <div><dt>Publisher</dt><dd>{activeEvidence.publisher}</dd></div>
                  <div><dt>Published</dt><dd>{activeEvidence.date}</dd></div>
                  <div><dt>Acquired</dt><dd>{activeEvidence.mode} — {modeDescription[activeEvidence.mode]}</dd></div>
                  <div><dt>Snapshot</dt><dd>sha256: {activeEvidence.hash}</dd></div>
                  <div><dt>Rights</dt><dd>Metadata stored per GDELT terms; article body internal only.</dd></div>
                </dl>
              )}
            </article>

            <p className="rights-note">Snapshot text is shown for analysis only. Article bodies are not redistributed.</p>
          </aside>
        </section>
      </main>
      <div className="saved-toast" role="status" aria-live="polite" hidden={!saved}>
        <span className="saved-seal" aria-hidden="true">ES<br />0427.03</span>
        <span><b>IntelligenceBrief saved</b><small>EvidenceSet ES-0427.03 frozen</small></span>
        <button type="button" onClick={() => setSaved(false)}>Dismiss</button>
      </div>
      <div className="saved-toast error" role="alert" hidden={!saveFailed}>
        <span className="saved-seal" aria-hidden="true">REJ</span>
        <span><b>Registration failed</b><small>Evidence validation rejected the brief</small></span>
        <button type="button" onClick={saveBrief}>Retry</button>
      </div>
    </>
  );
}

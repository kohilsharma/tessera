/*
THESIS: The Evidence Registration Bureau — an institutional proofing room where the same frozen EvidenceSet reads as registered layers rather than a dashboard summary.
OWN-WORLD: Paper + registration inks. Source layers align to prove consensus and stay offset to expose contradiction; hard sheet offsets, folio marks, and registration crosses make provenance structural.
STORY: Reader inspects a claim against the exact frozen Article snapshot on an adjacent bench, keeps context while comparing sources, then saves the validated GenerationRun as an owned IntelligenceBrief.
FIRST VIEWPORT: Dark Story mast into a four-cell EvidenceSet ledger, then the ruled claim register beside the sticky registration bench.
NAV: Wordmark-left / three-links / identity-right, sticky at 62px with a three-pixel active underline; links stay visible in a ruled second row at 1050px rather than hiding behind a menu.
DEMO: `?fail=1` forces save to fail, so the `role="alert"` rejection state stays reachable without shipping demo chrome.
*/
import { useEffect, useRef, useState } from "react";
import { claims } from "../data";
import type { Claim, Filter, Lens } from "../data";
import Bureau from "./bureau";

export type SharedState = {
  filter: Filter;
  lens: Lens;
  activeClaim: Claim;
  activeEvidenceId: string;
  saved: boolean;
  saving: boolean;
  saveFailed: boolean;
  visibleClaims: Claim[];
  setFilter: (next: Filter) => void;
  changeLens: (next: Lens) => void;
  inspect: (claim: Claim, evidenceId: string) => void;
  setSaved: (next: boolean) => void;
  saveBrief: () => void;
};

const failSave = new URLSearchParams(window.location.search).has("fail");

function visibleFor(claim: Claim, filter: Filter, lens: Lens) {
  const matchesFilter = filter === "All claims" || claim.type === filter;
  return matchesFilter && (claim.type !== "Lens-specific" || lens === "Student");
}

// The design prototype for the Phase-3 flagship (ADR-0002/0010), driven by the
// hardcoded fixtures in src/data.ts — no backend, and the save is simulated.
// It is not a Phase-1 surface, so it lives at /design-prototype rather than at
// the app's root; the built pages replace it as the flagship lands.
export default function BureauPrototype() {
  const [filter, setFilterState] = useState<Filter>("All claims");
  const [activeClaim, setActiveClaim] = useState(claims[0]);
  const [activeEvidenceId, setActiveEvidenceId] = useState("A1");
  const [lens, setLensState] = useState<Lens>("Student");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  function saveBrief() {
    if (saved || saving) return;
    setSaveFailed(false);
    setSaving(true);
    saveTimer.current = window.setTimeout(() => {
      setSaving(false);
      if (failSave) setSaveFailed(true);
      else setSaved(true);
    }, 700);
  }

  const visibleClaims = claims.filter((claim) => visibleFor(claim, filter, lens));

  function setFilter(next: Filter) {
    setFilterState(next);
    const nextClaim = claims.find((claim) => visibleFor(claim, next, lens));
    if (nextClaim && next !== "All claims" && activeClaim.type !== next) {
      setActiveClaim(nextClaim);
      setActiveEvidenceId(nextClaim.evidence[0]);
    }
  }

  function changeLens(next: Lens) {
    setLensState(next);
    if (next === "Investor" && activeClaim.type === "Lens-specific") {
      setActiveClaim(claims[0]);
      setActiveEvidenceId(claims[0].evidence[0]);
    }
  }

  function inspect(claim: Claim, evidenceId: string) {
    setActiveClaim(claim);
    setActiveEvidenceId(evidenceId);
  }

  const shared: SharedState = {
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
  };

  return (
    <div className="app-shell design-bureau">
      <Bureau {...shared} />
    </div>
  );
}

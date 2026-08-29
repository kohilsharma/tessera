---
name: Tessera
description: Registered evidence for defensible news intelligence
colors:
  proof-blue: "#1458a6"
  proof-magenta: "#c51d62"
  registered-overlap: "#492e84"
  lens-specific: "#315f35"
  bureau-ink: "#171715"
  stock-paper: "#f2f0e9"
  bench-stock: "#dedbd2"
  quiet-ink: "#55534e"
  registration-rule: "#b8b5ac"
  proof-blue-stock: "#e1e9f2"
  proof-magenta-stock: "#f3e2e9"
  registered-overlap-stock: "#e7e2ef"
  lens-specific-stock: "#e3ebe1"
  focus-amber: "#f0a800"
typography:
  display:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "clamp(3rem, 5.7vw, 6rem)"
    fontWeight: 800
    lineHeight: 0.92
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "clamp(1.55rem, 2.6vw, 2.7rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  measurement:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "0.66rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "normal"
rounded:
  sheet: "0"
  compact-control: "999px"
spacing:
  registration-gap: "7px"
  compact: "12px"
  sheet-inset: "28px"
  section: "58px"
components:
  button-primary:
    backgroundColor: "{colors.stock-paper}"
    textColor: "{colors.bureau-ink}"
    rounded: "{rounded.sheet}"
    padding: "11px 18px"
    height: "47px"
  filter-selected:
    backgroundColor: "{colors.bureau-ink}"
    textColor: "{colors.stock-paper}"
    rounded: "{rounded.compact-control}"
    padding: "8px 12px"
  evidence-sheet-blue:
    backgroundColor: "{colors.proof-blue-stock}"
    textColor: "{colors.bureau-ink}"
    rounded: "{rounded.sheet}"
    padding: "28px"
  evidence-sheet-magenta:
    backgroundColor: "{colors.proof-magenta-stock}"
    textColor: "{colors.bureau-ink}"
    rounded: "{rounded.sheet}"
    padding: "28px"
  validation-stamp:
    backgroundColor: "{colors.registered-overlap}"
    textColor: "{colors.stock-paper}"
    rounded: "{rounded.sheet}"
    padding: "10px 12px"
---

# Design System: Tessera

## Overview

**Creative North Star: "The Evidence Registration Bureau"**

Tessera behaves like an institutional proofing room: exact, source-conscious, and visibly constructed from registered layers. Security-print linework, folio marks, source inks, hard sheet offsets, and registration crosses make provenance structural rather than decorative. Dense work surfaces remain calm because every mark has a reading function.

The system is procedural, not editorially theatrical. Claims and source snapshots visibly align, separate, and lock together; interaction should make evidence relationships easier to defend rather than merely making the interface feel animated.

**Key Characteristics:**
- Archival authority without nostalgia or crime-lab theater.
- Source layers align to prove consensus and remain offset to expose contradiction.
- Flat, ruled surfaces replace floating dashboard cards.
- Semantic stock washes distinguish claim and source roles without sacrificing reading contrast.
- Motion is reserved for evidence registration, positional continuity, and certain completion feedback.

## Colors

Stock Paper and Bureau Ink own the canvas. Proof Blue and Proof Magenta identify source layers; Registered Overlap identifies agreement and validated registration. Student Context green is isolated to educational framing. Low-chroma stock variants may own selected rows and Evidence sheets while full inks remain reserved for borders, active controls, and relation marks.

**The Registered Color Rule.** Color identifies a source role, claim type, selection, or validation state. It never decorates an otherwise complete component.

**The Redundant Signal Rule.** Every colored relationship also carries a label, border style, position, or registration geometry. Color never bears meaning alone.

## Typography

Platform sans faces handle reading and display; compact platform monospace handles Evidence IDs, hashes, timestamps, folios, labels, and measurements. Native stacks keep local demonstrations deterministic and offline-safe. Display type is oversized and procedural, capped at six rem with tracking no tighter than negative four hundredths of an em.

**The Measurement Rule.** Monospaced type is reserved for values whose alignment or fixed identity matters.

**The Reading Rule.** Claims and Evidence excerpts remain sans-serif with a maximum measure near 68 characters; metadata may become compact, but never replaces prose hierarchy.

## Layout

The page is capped at 1600 pixels. Wide workspaces use an asymmetric two-column grid: analysis register at roughly two-thirds and a sticky Evidence bench at one-third, with a 360-pixel minimum bench. The dark Story mast leads into a four-cell EvidenceSet ledger, then the ruled claim register and adjacent source bench.

At 1050 pixels and below, navigation gains a dedicated second row, the ledger becomes two-by-two, and the Evidence bench stacks after claims. The stacked bench repeats active-claim context and provides a jump-back link so citation inspection retains origin. At 560 pixels, filters wrap, source tabs become two columns, controls stack, and the display title resolves to 2.5rem. Sticky behavior disables on wide viewports shorter than 780 pixels.

Spacing uses contrast rather than uniform repetition: compact identity groups at 7–12 pixels, sheet interiors near 28 pixels, and major workspace insets near 58 pixels. Active and inactive claim rows reserve the same gutters so selection never changes document geometry.

## Elevation & Depth

Surfaces are flat at rest and separated by ink density, rules, stock color, and overlap. Hard offset shadows communicate physical registration only: an active source tab lifts by 5 by 6 pixels, an Evidence sheet by 9 by 10 pixels, and the save command or confirmation uses one compact colored offset. Ambient shadows and soft floating-card elevation are forbidden.

**The Structural Shadow Rule.** A shadow means a sheet or tab has moved into active physical hierarchy. No active state, no shadow.

## Shapes

Corners are square. Pills are reserved for compact filters; they never define content containers or command sheets. Containers derive shape from sheet edges, clipped registration reveals, ruled tabs, seals, and crosshair geometry. Dashed borders identify Evidence outside the active claim; solid borders identify registered source records.

## Components

### Buttons
- **Command buttons:** Square Stock Paper fields on dark surfaces with hard Proof Magenta offset; hover moves to Proof Blue and active press collapses the offset.
- **Filters:** Compact pills with ruled neutral rest state and Bureau Ink selected state.
- **Focus:** Three-pixel Focus Amber outline outside every interactive control.
- **Disabled:** Neutral stock, Quiet Ink, no shadow, and no implied interactivity.

### Navigation
- **Desktop:** Sticky 62-pixel bar with centered links and a three-pixel active underline.
- **Stacked:** At 1050 pixels, links remain visible in a ruled second row rather than disappearing behind an invented menu.

### Claim Register
- **Structure:** Stable ruled rows contain claim type, Claim ID, statement, and explicit supporting or contradicting Evidence controls.
- **Selection:** Claim-type stock wash plus a registered Blue/Overlap/Magenta rail and crosshair; row geometry does not shift.
- **Citation:** Active support uses Proof Blue; active opposition uses Proof Magenta. `aria-pressed` and text labels preserve non-color meaning.

### Registration Bench
- **Source tabs:** Source hue identifies Article layer; solid or dashed border and status text identify registered versus outside-claim state. Active tab rises and fills with its source ink.
- **Relation lock:** Claim ID and Evidence ID join with a registration cross and explicit support, contradiction, or outside-claim label.
- **Evidence sheet:** Frozen Article snapshot uses source-stock paper, an 11-pixel source edge, one hard offset shadow, and exact snapshot metadata.

### Validation And Save
- **Validation stamp:** Registered Overlap field confirms citation validation without resembling an editable control.
- **Saved state:** Bureau Ink confirmation contains an EvidenceSet seal, frozen-set identity, and dismiss action. Its intensity remains proportional to a routine save.

### Motion
- **Evidence morph:** On wide screens with motion allowed and View Transitions supported, a selected citation morphs into the Evidence sheet over 520 milliseconds. Unsupported browsers, narrow layouts, and reduced-motion users receive the complete static update and existing positional feedback.
- **Registration:** Relation locks and sheets use bounded clip-path and transform arrivals. No loops, ambient drift, parallax, or decorative motion.

## Do's and Don'ts

### Do:
- **Do** make claim-to-evidence relationships visible before interaction and exact after selection.
- **Do** preserve readable hierarchy when all color is removed.
- **Do** use dense linework only where it communicates registration, source grouping, or document identity.
- **Do** keep source order, active-claim context, keyboard focus, and reduced-motion behavior intact across breakpoints.
- **Do** reserve progressive browser effects for evidence continuity and provide a complete static fallback.

### Don't:
- **Don't** turn proof texture into cheerful poster decoration.
- **Don't** use generic rounded dashboard cards, glass, ornamental glow, ambient shadows, or gradient text.
- **Don't** spend Proof Blue, Proof Magenta, Registered Overlap, or Student Context green on decoration.
- **Don't** imply source completeness, factual verdicts, outlet bias, or numerical certainty the product cannot support.
- **Don't** hide primary navigation or evidence context merely to make a narrow layout fit.

## Implementation

Bureau is the committed and only visual world, and since the rollout (#28) it reaches the whole application. Its tokens live at `:root` in `frontend/src/styles.css`; the live pages consume them through four page archetypes — index, record, form, dashboard — plus the application shell (`frontend/src/components/AppShell.tsx`) that `frontend/src/App.tsx`, now the route table alone, wraps them in. The Phase-3 design study keeps its own route (`/design-prototype`): `frontend/src/versions/BureauPrototype.tsx` owns that surface's shared state — filter, lens, active claim, active Evidence, and save lifecycle — and renders `versions/bureau.tsx` inside the `.design-bureau` wrapper, which keeps a duplicate token block of its own so a root-level token edit cannot change how the frozen reference renders.

Nine exploratory worlds (Terminal, Shoebox, Specimen, Abyss, Pit, Archive, Stockroom, Darkroom, Cloud Quarry) were built to test this surface's mechanism against alternative grammars and have been removed now that Bureau is chosen. Their record lives in git history; no runtime switcher remains.

The relation of the active Evidence to the active Claim is rendered with non-color semantics: a registration lock pairing Claim ID and Evidence ID with an explicit "Support registered", "Contradiction registered", or "Outside active claim" label.

**Demo affordance.** `?fail=1` forces save to fail, keeping the `role="alert"` rejection state reachable for demonstration without shipping demo chrome into the interface.

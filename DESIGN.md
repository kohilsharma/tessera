# Design System: Tessera

Supersedes the "Evidence Registration Bureau" system (#28–#37), withdrawn 2026-09-03. That system
was made almost entirely of prohibitions — no ambient depth, no decorative motion, no colour without
meaning, no icons — and what shipped was Arial on beige with one keyframe in the whole application.
**A design system made only of prohibitions produces nothing.** This one says what to do.

Origin: the direction study at `docs/design-brief.md`, realised as the design canvas exported to
`docs/Tessera Directions.html`. All six palettes below are the designer's own, with every value
re-measured for contrast here.

---

## 1. North star

**The product looks like who you are.**

Tessera has three users with genuinely different jobs — a student learning, an investor deciding, an
admin operating — and it wears a different face for each. Not a different app: the *same*
components, the same layouts, the same words, re-tinted and re-typed by role. Signing in is a small
piece of theatre where the product becomes yours.

Underneath that, one thing never changes: **provenance is structural.** Every claim carries its
citation, every citation opens, and "says who?" is always one click away. Colour, weight and
position exist to make that relationship legible — and, where it earns it, delightful.

## 2. The token contract

Every theme declares **the same twenty-two custom properties** and differs only in their values. This is
the whole mechanism: a component that reaches for `var(--agree)` is correct under all six palettes,
so the themes cannot drift apart and nothing is duplicated per role.

Implemented in `frontend/src/tokens.css` (#74). `frontend/src/tokens.test.ts` holds that file to
this section hex for hex and re-measures every ratio, so §2 and §3 are the specification in both
directions: edit them and the suite fails until the stylesheet follows.

| Token | Role |
|---|---|
| `--paper` | Page ground |
| `--paper2` | Raised surface: cards, headers, panels |
| `--ink` | Primary text |
| `--quiet` | Secondary text, metadata |
| `--rule` | Hairlines, dividers |
| `--rule2` | Stronger borders, disabled edges |
| `--left` `--centre` `--right` | The political spectrum axis |
| `--agree` `--diverge` `--imply` | The claim-type axis (consensus / contradiction / implication) |
| `--wash-agree` `--wash-diverge` `--wash-imply` | Tinted grounds for those three |
| `--agree-text` `--diverge-text` `--imply-text` | The same three, safe for **small text** |
| `--on-accent` | Text sitting on a filled accent |
| `--up` `--down` | Market direction — price rising / falling. Named for meaning: "up" is not "agree". |
| `--focus` | Focus ring |

**Rules.**
1. No component hard-codes a colour. If you need one that isn't here, the contract is wrong — extend
   it in all six palettes or don't use it.
2. Accent tokens are for **marks** — bars, dots, rules, fills. Small text on an accent uses the
   `-text` variant.
3. Colour never carries meaning alone. Every coloured relationship also has a label, an icon, a
   shape or a position. Remove all colour and the hierarchy must still read.

## 3. The six palettes

| Signed in as | Theme | Native mode |
|---|---|---|
| Student | Studio | light |
| Investor | Terminal | dark |
| Admin | Newsroom | light |
| *nobody — login, register, `/status`* | Newsroom | light |

The role sets `data-theme` on `<html>` and is **not** user-overridable. Light/dark is the separate
axis the reader controls: it follows `prefers-color-scheme` by default, with a per-account override
applied as `.dark` on the same element. "Native mode" above is only what that role most often ends
up in, never a lock.

Contrast ratios are measured against that palette's `--paper`. Text tokens meet WCAG AA (≥4.5:1);
marks and the focus ring meet ≥3:1.

### Newsroom — Admin

Editorial, typographic, warm. Instrument Serif over Archivo.

```css
[data-theme="newsroom"] {
  --paper:#faf8f4; --paper2:#ffffff; --ink:#16140f; --quiet:#6d685e;
  --rule:#e2ddd2;  --rule2:#c9c3b6;
  --left:#2f5c9e;  --centre:#7a746a; --right:#a84a2f;
  --agree:#2d6a4a; --diverge:#a84a2f; --imply:#5b4a9c;
  --wash-agree:#eaf1ec; --wash-diverge:#f7ebe6; --wash-imply:#eeebf5;
  --agree-text:#2d6a4a; --diverge-text:#a84a2f; --imply-text:#5b4a9c;
  --up:#2d6a4a; --down:#a84a2f;
  --on-accent:#ffffff; --focus:#c08400;
}
[data-theme="newsroom"].dark {
  --paper:#141310; --paper2:#1c1a16; --ink:#f2efe6; --quiet:#a29b8d;
  --rule:#2e2b24;  --rule2:#464036;
  --left:#7aa5e0;  --centre:#a29b8d; --right:#e08c6d;
  --agree:#6cc295; --diverge:#e08c6d; --imply:#a695e6;
  --wash-agree:#18251d; --wash-diverge:#2a1d17; --wash-imply:#1f1b2e;
  --agree-text:#6cc295; --diverge-text:#e08c6d; --imply-text:#a695e6;
  --up:#6cc295; --down:#e08c6d;
  --on-accent:#141310; --focus:#e0b34a;
}
```
Light: ink 17.4, quiet 5.2, accents 4.4–6.8, focus 3.0. `--centre` as small text is `#777167`
(`#7a746a` measures 4.4:1).
Dark: ink 16.2, quiet 6.7, accents 6.7–8.7.

### Terminal — Investor

Dense, data-first, cool. IBM Plex Sans over Spline Sans Mono. Dark is its native mode.

```css
[data-theme="terminal"].dark {
  --paper:#0b0e11; --paper2:#12171c; --ink:#dde5ec; --quiet:#7c8b98;
  --rule:#1e252d;  --rule2:#313c46;
  --left:#4b8fe0;  --centre:#8a99a6; --right:#e8794a;
  --agree:#2fc48d; --diverge:#ff6f4d; --imply:#b78cff;
  --wash-agree:#0e2620; --wash-diverge:#2a1410; --wash-imply:#1b1630;
  --agree-text:#2fc48d; --diverge-text:#ff6f4d; --imply-text:#b78cff;
  --up:#2fc48d; --down:#ff6f4d;
  --on-accent:#0b0e11; --focus:#e0b34a;
}
[data-theme="terminal"] {
  --paper:#eef1f4; --paper2:#ffffff; --ink:#0e1418; --quiet:#5a6b78;
  --rule:#d3dae0;  --rule2:#b3bec7;
  --left:#1f5fb8;  --centre:#5a6b78; --right:#c2481f;
  --agree:#0e7a55; --diverge:#c2481f; --imply:#5b3ec2;
  --wash-agree:#e2f2ec; --wash-diverge:#fbe9e3; --wash-imply:#ece7fa;
  --agree-text:#0e7a55; --diverge-text:#be461e; --imply-text:#5b3ec2;
  --up:#0e7a55; --down:#c2481f;
  --on-accent:#ffffff; --focus:#a86b00;
}
```
Dark: ink 15.2, quiet 5.5, accents 5.8–8.7, focus 9.9.
Light: ink 16.4, quiet 4.9, accents 4.4–6.4. `--right` / `--diverge` as small text is `#be461e`.

### Studio — Student

Bright, generous, rounded. Bricolage Grotesque over DM Sans.

```css
[data-theme="studio"] {
  --paper:#faf6f0; --paper2:#ffffff; --ink:#191823; --quiet:#6c6885;
  --rule:#ebe4db;  --rule2:#d3cbc1;
  --left:#3d6bf5;  --centre:#8b8698; --right:#e0533d;
  --agree:#12a06c; --diverge:#e0533d; --imply:#6b4ef0;
  --wash-agree:#e5f6ee; --wash-diverge:#fdeae6; --wash-imply:#eeeafe;
  --agree-text:#0e8157; --diverge-text:#c24835; --imply-text:#6b4ef0;
  --up:#0e8157; --down:#c24835;
  --on-accent:#ffffff; --focus:#be8300;
}
[data-theme="studio"].dark {
  --paper:#16151d; --paper2:#1f1d29; --ink:#f4f1ff; --quiet:#a09cba;
  --rule:#2c2a3a;  --rule2:#413d55;
  --left:#7d9cff;  --centre:#a09cba; --right:#ff8a72;
  --agree:#4bd3a0; --diverge:#ff8a72; --imply:#a894ff;
  --wash-agree:#16302a; --wash-diverge:#33201e; --wash-imply:#241f3d;
  --agree-text:#4bd3a0; --diverge-text:#ff8a72; --imply-text:#a894ff;
  --up:#4bd3a0; --down:#ff8a72;
  --on-accent:#16151d; --focus:#e0b34a;
}
```
Light: ink 16.3, quiet 4.9, marks 3.1–4.9, focus 3.0. Small text uses the `-text` variants;
`--left` becomes `#3a66eb`, `--centre` `#736f7e`.
Dark: ink 16.3, quiet 6.9, accents 6.9–9.6.

**The dark grounds are deliberately different from each other** — Newsroom a warm charcoal
(`#141310`), Studio a violet-cast near-black (`#16151d`), Terminal a cold blue-black (`#0b0e11`).
A shared dark ground would erase role theming exactly when it is being demonstrated.

All values above are the designer's own, taken from `docs/Tessera Directions.html`. Two were
corrected here: `--focus` failed WCAG 2.2's 3:1 in both light themes, and the `-text` variants were
added because several light-theme accents are marks-only at their given lightness.

## 4. Typography

Three families per theme: a **display** face, a **UI** face, and a **mono** for measurements.

| Theme | Display | UI | Mono |
|---|---|---|---|
| Newsroom | Instrument Serif | Archivo | IBM Plex Mono |
| Terminal | IBM Plex Sans 700 | IBM Plex Sans | Spline Sans Mono |
| Studio | Bricolage Grotesque 800 | DM Sans | DM Mono |

All from Google Fonts, each with a real fallback stack.

Scale — `--t-display` is a **theme** token because the three directions carry display type very
differently; the rest are shared.

```
--t-display  newsroom 3.6rem · terminal 1.9rem · studio 2.9rem
--t-title    1.75rem     --t-heading 1.5rem
--t-body     1rem        --t-small   0.875rem
--t-meta     0.8125rem   --t-micro   0.6875rem
```

**The measurement rule.** Mono is reserved for values whose alignment or fixed identity matters:
evidence ids (`A1`), hashes, tickers, prices, indicator readouts, timestamps, run counts. Never for
prose.

**The reading rule.** Claims and excerpts stay in the UI face at a measure of ~68 characters.
Metadata may compress; it never replaces prose hierarchy.

## 5. Space, shape, depth

Spacing scale, in px: `4 8 12 16 22 28 40 56 80`. Use contrast rather than uniform repetition —
tight identity groups at 4–12, card interiors at 22–28, major page insets at 40–56.

Radii are a theme token: Newsroom `2px`, Terminal `0–2px`, Studio `12–26px`. Studio is where
roundness lives; the other two earn their character from rules and density.

Depth is a theme token too. Newsroom and Terminal separate surfaces with **rules and ink density**.
Studio uses **soft layered shadows** — and only Studio. Nothing floats for decoration in any theme.

## 6. Layout and breakpoints

The page caps at **1600px** and centres. Three widths, inherited from the previous system so the
existing verification screenshots stay comparable:

| Width | What changes |
|---|---|
| **> 1050px** | Full layout. Record pages run a two-column grid — content at roughly two-thirds, an evidence or role rail at one-third with a 360px minimum. The rail may stick. |
| **≤ 1050px** | Navigation takes its own row. The rail stacks *after* the content it supports and repeats enough context to stay useful. Ledgers go two-by-two. |
| **≤ 560px** | Filters wrap, controls stack, the display size drops to the next step on the scale, tables become stacked rows rather than scrolling sideways. |

Sticky behaviour switches off on viewports shorter than 780px — a sticky rail on a short screen
eats the content it was helping.

**Rules.** No page scrolls horizontally at any width; wide content (tables, the graph, code) scrolls
inside its own container. Hit targets are never below 44px. Navigation is never hidden merely to
make a narrow layout fit — it moves, it does not disappear.

## 7. Motion

| Purpose | Duration | Easing |
|---|---|---|
| Micro (hover, focus, press) | 140ms | `ease` |
| Enter / exit, list transitions | 320ms | `cubic-bezier(.16,1,.3,1)` |
| Sign-in transition | ~700ms | `cubic-bezier(.16,1,.3,1)` |

**Motion carries information or it doesn't ship.** An element that appears should say where it came
from; a list that reorders should let you follow a row. No ambient drift, no parallax, no looping
decoration.

The one piece of theatre is **the sign-in transition**: the page paints in signed-out Newsroom, then
a single sweep retints the tokens — rules, then washes, then accents — with the wordmark the only
fixed element, resolving onto a dashboard whose data has been loading underneath. The token change
*is* the animation; there is no spinner, no logo bounce, no particles. Once per login, never on
navigation.

`prefers-reduced-motion: reduce` collapses every duration above to an instant state change. That
includes the sign-in transition.

## 8. Components

Icons are **Phosphor** throughout — regular as the default, bold for emphasis, duotone where a
surface wants warmth (Studio uses duotone most). Never emoji.

The four page archetypes survive from the previous system and keep their names: **Index** (a
filtered, paginated list), **Record** (one thing and its evidence), **Form** (create and edit),
**Dashboard** (registers of one role's work).

**The four states are mandatory on every route**, and three of them must look different from each
other:
- **Loading** — skeletons in `--rule2`, never a spinner alone.
- **Empty** — says what *would* be here and how to make it happen. This is where first-time users
  land; it is not an apology.
- **Error** — says the request failed and offers a retry.
- **Refused** — says you are not allowed, in `--diverge`, and never pretends the thing is empty.

Recurring components and the tokens they own:

- **Coverage spectrum** — a segmented bar in `--left --centre --right`, each segment labelled and
  counted. A **blindspot** (coverage overwhelmingly one-sided) is called out in words, not only by
  the shape of the bar.
- **Claim** — grouped by type, tinted by `--wash-*`, labelled in `--*-text`. A contradiction renders
  as **two opposed sides**, never a flat list.
- **Citation chip** — mono, `A1 · Publisher`, always openable. If a citation cannot open, that is a
  bug, not a style.
- **Register row** — a name, a measure bar, and its metadata; the shared vocabulary behind every
  dashboard and admin list.
- **Role panel** — the block inside a Record that only one role sees. Marked as such, so a reader
  knows it is theirs.

**Every long list is bounded**: it scrolls inside a container, paginates, or virtualises, and states
what it is showing ("5 of 31"). No page grows without limit; no page scrolls horizontally.

## 9. Libraries

See ADR-0030. Behaviour comes from **Base UI**, charts from **Recharts**, the graph from
**Cytoscape**, motion from **Motion**, icons from **Phosphor**, tables from **TanStack Table**.
Styling is **CSS Modules** over the token contract — no utility-class framework.

Nothing is hand-rolled that a library does properly. The previous system's hand-drawn CSS bars and
icon-free surfaces are the specific failure this replaces.

## 10. Don'ts

- Don't ship the generic AI-SaaS look: purple gradient hero, glassmorphism, uniformly rounded
  floating cards, an emoji in every heading.
- Don't use Inter, Roboto, Arial or Fraunces.
- Don't add a number, badge or stat tile because a layout looked empty.
- Don't let colour carry meaning alone.
- Don't animate something that isn't telling the reader anything.
- Don't imply source completeness or factual verdicts the product can't support. A publisher's
  leaning is shown **only** as a sourced third-party rating with its attribution — a cited claim
  about a publisher, never our inference.

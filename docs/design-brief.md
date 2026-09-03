# Tessera — design brief

> **Historical.** This brief was the input to the direction study; the direction has since been
> chosen and the system it produced lives in **`DESIGN.md`**, which is the authority. Read this only
> to understand *why* the design is what it is — never as an open question. The realised canvas is
> `docs/Tessera Directions.html`.

Input for a visual design pass. Paste this whole file into a design tool as the brief.

**How to use this brief.** It tells you what the product *is*, who uses it, what has to be on the
screen, and what must not happen. It deliberately does **not** tell you what it should look like.
The aesthetic is yours. Commit to a real point of view and take it all the way — a timid design
that offends nobody is the failure mode we are trying to escape, not the goal.

---

## What Tessera is

An **evidence-grounded news intelligence workspace**. It ingests news from many publishers, groups
reporting about the same event into a **Story**, and generates analysis where *every factual claim
carries a citation* back to a specific article, frozen at the moment the analysis ran. Nothing on
screen is asserted without a source you can open.

The thesis, in one line: **provenance is structural, not decorative.** A reader should always be
able to ask "says who?" and get an answer in one click. Whatever the design becomes, that question
should feel easy to ask and satisfying to answer.

## Who uses it, and the tension you have to resolve

Three roles. Each gets its own dashboard, its own data, and — this is the interesting part —
**role-specific panels that appear inside shared screens**. An investor viewing a Story sees a
ticker and price chart there; a student viewing the same Story sees flashcard tools; an admin sees
moderation controls. Same page, three different products.

- **Student** — learning from the news. Owns collections and a spaced-repetition flashcard deck
  built from cited claims. Wants it to feel low-stakes and worth coming back to.
- **Investor** — deciding with the news. Watchlist, sectors, market data beside the reporting,
  consensus versus contradiction across outlets. Wants density and speed.
- **Admin** — running the machine. Connectors, ingestion runs, review queues, prompt versions,
  publishers, users. Wants status visible at a glance and no ambiguity about what failed.

**The tension is the design problem.** One visual language has to carry a playful study drill, a
dense financial dashboard, and an operations console without any of them feeling like a guest in
someone else's house. Solve that however you see fit — a shared spine with role-specific
temperature, a system that shifts density, something we haven't thought of. Show us your answer.

## The screens

Design these. The first three matter most.

1. **Story detail** — the flagship. Headline, the outlets covering it, a **bias spectrum** showing
   how coverage distributes across the political spectrum, and a generated analysis whose claims are
   grouped as *agreement*, *disagreement*, and *implication* — each claim showing citations that
   open the article behind them. Plus the role-conditional panel described above.
2. **A role dashboard** — pick whichever role you find most interesting, or do more than one.
3. **Flashcard study** — one card at a time: question, reveal, four difficulty grades. This should
   feel like something a person chooses to do, not a form they fill in.
4. **Knowledge graph** — a force-directed graph of people, organisations and places co-mentioned in
   the news, around 60 nodes, clickable, zoomable, with an evidence panel behind every connection.
5. **Admin console** — many dense panels of operational data, run histories, review queues.

## Real content to design against

Use these. Do not use lorem ipsum.

- **A Story**: "Commerce tightens export rules on advanced AI chips" · technology · 7 articles ·
  6 publishers · tracked 4 days.
- **Publishers on it**: The Guardian, Vox, Reuters, Associated Press, Bloomberg, Wall Street
  Journal, Fox Business.
- **Bias spectrum**: 2 left, 3 centre, 2 right. Elsewhere, a story with 5 left and 0 right — that's
  a **blindspot**, and it should be impossible to miss.
- **An agreement claim**: "All six outlets report the licence requirement applies to accelerators
  above a stated memory-bandwidth threshold, effective in 90 days." Cited to A1 Reuters, A3
  Bloomberg, A5 AP.
- **A disagreement**: whether the rules reach existing contracts. The Guardian says signed orders
  must be re-licensed; Fox Business says they're grandfathered through the quarter. Both sides need
  to be visible at once — this is not a list, it's an opposition.
- **A citation** reads `A1 · Reuters` and opens the article behind it.
- **Market panel**: NVDA · 176.40 · −4.18% · 50-day average 168.92 · RSI 38.1 · a price series.
- **A flashcard**: "What threshold does the new licence requirement use?" → "Memory bandwidth —
  accelerators above a stated ceiling require a licence, effective in 90 days." with its citations
  under the answer, and grades Again / Hard / Good / Easy.
- **Graph**: node size scales with how many articles mention that name; connection thickness with
  how often two names appear together.
- **An admin row**: "Ingestion run · 14:15 · 47 discovered · 12 inserted · 35 duplicate · ok", and a
  review queue reading "31 awaiting a decision".

## Hard constraints

These are the only things that are not up for creative interpretation.

- **Light and dark**, both designed, neither an afterthought.
- **Four states per screen**: loading, empty, error, and refused-by-permission. "Nothing here yet"
  must look different from "that request failed" and from "you're not allowed to see this". Empty
  states are where first-time users actually land — design them properly, not as an apology.
- **Colour never carries meaning alone.** Every coloured relationship also has a label, an icon, a
  shape, or a position. WCAG AA contrast. Keyboard reachable. This constrains *how* you use colour,
  not *which* colours you use.
- **Long lists are bounded** — they scroll inside something, or paginate, and say what they're
  showing. Pages must never grow without limit.
- **Icons exist.** The current build has zero, and reads as a document rather than a product.
- **Dense is not cramped.** The admin console shows ten panels and still has to be scannable.

## What went wrong last time

The previous design system was a principled, austere "evidence bureau" aesthetic. It shipped:
Arial on beige, near-black hairline rules, two accent colours used sixteen times in the entire
application, one CSS animation, zero icons, zero charts, and lists that grew until the page lagged.
The rules forbade ambient depth, decorative motion, and colour without meaning — and what was left
was a document.

The lesson is not "be louder." It's that a design system made entirely of prohibitions produces
nothing. Give this one things it *does*.

## What to avoid

- The generic AI-SaaS look: purple gradient hero, glassmorphism, floating rounded cards with soft
  drop shadows applied uniformly, an emoji in every heading.
- Overused typefaces — Inter, Roboto, Arial, Fraunces.
- Decoration that carries no information. Every effect should be earning something.
- Data slop: numbers, badges and stat tiles added because the layout looked empty.

## Implementation note

Design as if real components exist, because they will. The build is React, and component, chart,
icon, animation and graph libraries are all allowed — nothing above the mandated base stack is
off limits. So do not water a design down to what is easy to hand-roll in CSS: if the right answer
is a proper charting library, a real icon set, a command palette or a physics-based drag, draw it.

## Deliverable

The screens above, light and dark, at desktop width. Then the token set behind them — colour, type
scale, spacing scale, radii, elevation, motion timing — concrete enough to implement directly as
CSS custom properties.

Be opinionated. We would rather react to something with a strong point of view than approve
something safe.

# Bureau rollout — verification sweep (#37)

Browser pass over the finished rollout (#28), captured against the seeded demo corpus at the
design's two breakpoints: `1050-*.jpg` and `560-*.jpg`. jsdom does no layout and no cascade,
so the automated suite cannot check any of this — these screenshots are the review artefact.

Every live route, at both widths:

| File | Route | Archetype |
|---|---|---|
| `*-stories.jpg`, `*-briefs.jpg`, `*-search.jpg` | `/stories`, `/briefs`, `/search` | Index |
| `*-story.jpg`, `*-article.jpg` | `/stories/:id`, `/articles/:id` | Record, corpus |
| `*-brief.jpg` | `/briefs/:id` | Record, owned artefact |
| `*-brief-form.jpg`, `*-login.jpg`, `*-register.jpg` | `/briefs/new`, `/login`, `/register` | Form |
| `*-dashboard-student.jpg`, `*-dashboard-investor.jpg`, `*-dashboard-admin.jpg` | `/dashboard/:role` | Dashboard |
| `*-account.jpg`, `*-status.jpg` | `/account`, `/status` | Stated page |

Plus the two shared states whose meaning is partly carried by colour, at 560:
`560-state-empty.jpg` (empty register under applied, ink-filled filter pills) and
`560-state-refused.jpg` (a dashboard that is not the caller's, in the error treatment).

Not captured here, verified in the browser and reported on #37: no element past the viewport
on any route at 390px, keyboard order from the shell into page content with the 3px amber ring
at every stop, motion suppressed under `prefers-reduced-motion` across the application, and
`/design-prototype` rendering byte-identical to its pre-rollout baseline at 1050/560/390.

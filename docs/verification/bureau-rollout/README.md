# Bureau rollout — verification sweep (#37)

Browser pass over the finished rollout (#28), captured against the seeded demo corpus at the
design's two breakpoints: `1050-*.jpg` and `560-*.jpg`. jsdom does no layout and no cascade,
so the automated suite cannot check any of this — these screenshots are the review artefact.

One capture per archetype consumer, plus the two shared states that carry meaning in colour:

| File | What it shows |
|---|---|
| `*-stories.jpg` | Index archetype — filter register, ruled entries, pagination |
| `*-story.jpg` | Record archetype on a corpus record (ink mast) |
| `*-brief.jpg` | Record archetype as the owned artefact (bench mast, cover plate) |
| `*-brief-form.jpg` | Form archetype, with the cover-image control |
| `*-dashboard-student.jpg`, `*-dashboard-admin.jpg` | Dashboard archetype, two of its three surfaces |
| `*-account.jpg`, `1050-status.jpg` | Stated pages — the two the rollout had missed |
| `560-state-empty.jpg` | Empty state under applied (ink-filled) filter pills |
| `560-state-refused.jpg` | A dashboard that is not the caller's, in the error treatment |

Not captured here, verified in the browser and reported on #37: no horizontal overflow at
390px on any route, keyboard order from the shell into page content with the 3px amber ring
at every stop, motion suppressed under `prefers-reduced-motion`, and `/design-prototype`
rendering byte-identical to its pre-rollout baseline at 1050/560/390.

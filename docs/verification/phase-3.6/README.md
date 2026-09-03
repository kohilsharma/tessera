# Phase 3.6 — the sign-in transition (#78)

#78's third done-condition is "never gates first paint or adds perceived latency — **verified, not
assumed**", and its first is that the sweep plays at all. Neither is reachable from the automated
suite: jsdom applies no stylesheet, runs no compositor, and resolves no custom property, so a test
there can assert the class lifecycle and the awaited seam but never that a token actually eased. So
these are Chrome, against the live stack, signing in as the seeded `investor@tessera.local` —
Newsroom → Terminal, the largest palette jump the product has, on both the same-mode and the
light→dark paths.

Captured at 1440×900 and 390×844, both at DPR 2. The seeded `investor` is `colorMode: system`, so
`78-7` was taken with the account temporarily set to `dark` and restored afterwards.

| File | Moment | What it has to show |
|---|---|---|
| `78-1-signed-out-newsroom-desktop.png`, `78-4-…-mobile.png` | before submit | The signed-out surface in Newsroom — warm cream ground, Instrument Serif display, terracotta offset on the button |
| `78-2-mid-sweep-desktop.png`, `78-5-…-mobile.png` | ~300ms after submit | **Still `/login`**, button reading "Logging in…", field rules already cool blue-grey while the ground is still Newsroom cream — the staged sweep mid-flight on the page a reader is looking at |
| `78-3-arrived-terminal-desktop.png`, `78-6-…-mobile.png` | after the sweep | `/dashboard/investor` in Terminal, populated with real seeded content — no skeleton, because the data arrived under the sweep |
| `78-7-mid-sweep-mode-flip-desktop.png` | ~300ms, light→**dark** login | The case the cross-fade cannot serve. Ink and paper have swapped outright and the page is fully readable, while the field and card rules are still mid-sweep on Newsroom's warm grey — and the button reads its resting "Log in", not "Logging in…" |

The mid-sweep frames are the ones that matter, and they are what the first implementation of #78
could not produce: it navigated on the microtask after the auth response, and since `/login` and
`/dashboard` sit under different layout elements, React replaced every node before a frame painted.
A CSS transition needs a before-change style on a laid-out node, so the sweep applied to a DOM that
no longer existed. The desktop capture was confirmed to be inside the window by sampling
`documentElement` at capture time — `{"sweeping": true, "theme": "terminal", "url": "/login"}`.

Not captured here, measured programmatically and written up in
`docs/repo-state/phase-3.6-product-overhaul.md`: the staged order (rules finished by ~481ms while the
`h1` ink still held Newsroom's `rgb(22,20,15)` until t≈567ms, then eased to `#0e1418`), an
intermediate rule value proving interpolation rather than a swap (`rgb(192,193,189)`, between
`#c9c3b6` and `#b3bec7`), and the latency answer: `/dashboard/investor` requested at +214ms and
complete at +634ms relative to submit, ~300ms before the navigation. The sweep spends time the
network was going to spend anyway.

`78-7` is the frame that would not have existed a revision earlier. Staging by CSS property put
`color` on the accent tier at 300ms and `background-color` on the wash tier at 160ms, which is
harmless while ink and paper stay on the same sides of the page and fatal when they swap: on a
light→dark login the text passed through its own background at **1.15:1 for ~122ms**. Moving `color`
down to the wash tier does not fix it — travelling together the two cross simultaneously and both sit
at mid-grey, which is worse. `transitionTheme` now marks a mode-crossing sweep with
`theme-transition--mode-flip`, and that block swaps ink and paper outright while the rules and
accents still sweep. Re-measured through a real login: **15.2:1 across every frame, zero below AA**.

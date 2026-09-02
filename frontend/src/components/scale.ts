// The largest of a set of counts, floored at 1 — the denominator every drawing here
// scales a share against. Its own module because three registers want it and none of
// them owns it: a timeline's bars scale against the tallest bucket (#64, #65), and the
// graph's nodes and lines against the most-reported name and the heaviest tie (#68, #69).
// It lived in `timelineRegister` first, which made a max-with-a-floor read as a timeline
// concept for two surfaces that draw no axis at all.
//
// Floored at 1 because a set of all-zero counts would otherwise divide by zero and draw
// nothing rather than draw flat.
export function peakOf(counts: number[]): number {
  return Math.max(...counts, 1);
}

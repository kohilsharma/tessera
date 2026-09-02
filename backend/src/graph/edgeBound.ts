// The both-ends bound, written once because two seams apply it: the pass bounds the graph
// it stores (`runEntityResolution.rebuildEdges`) and the read path bounds the screen it
// draws (`loadGraphView`) — over different citations and different numbers
// (`EDGES_PER_ENTITY`, `VIEW_EDGES_PER_ENTITY`, ./config.ts) but under one rule. Written
// twice, the two drift, and a drifted bound is not a failure: it is a picture that quietly
// stops being the graph the pass kept.
//
// Takes a `pair(a, b, w)` CTE in scope and leaves a `kept(a, b)` one. A pair inside either
// endpoint's strongest `bound` is kept, so a node is never drawn as an isolate because its
// one tie was its neighbour's seventh. Each pair appears in `directed` in both orders,
// which is what makes "either end" one comparison rather than two.
//
// `bound` is a parameter placeholder rather than a number, because the two callers number
// their parameters differently; `alsoKeep` is the neighbourhood's one exemption (#69), a
// clause keeping every tie to the focus whatever its rank.
export function bothEndsBoundSql(bound: string, alsoKeep = ""): string {
  return `
  directed AS (
    SELECT a AS "self", b AS "other", w FROM pair
    UNION ALL
    SELECT b, a, w FROM pair
  ),
  ranked AS (
    SELECT "self", "other",
           ROW_NUMBER() OVER (PARTITION BY "self" ORDER BY w DESC, "other" ASC) AS "rank"
      FROM directed
  ),
  kept AS (
    SELECT DISTINCT LEAST("self", "other") AS a, GREATEST("self", "other") AS b
      FROM ranked WHERE "rank" <= ${bound}${alsoKeep}
  )`;
}

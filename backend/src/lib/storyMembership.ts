import type { StoryAssignmentStatus } from "../entities/Article";

// CONTEXT.md "Story Assignment": a pending assignment is invisible to browse, to
// search, and to evidence selection — so a machine's borderline guess can never
// reach a reader or ground a claim (#50).
//
// This exists because a pending assignment *has* a `storyId`: it is a proposal
// attached to the Story it was proposed for, which is the only way an Admin can
// review it. So every read path that used to mean membership by "joins a Story"
// has to mean it by this instead, and there is one predicate to grep for when the
// next reader-facing surface lands (evidence selection, #53 onward).
export const ACCEPTED_ASSIGNMENT: StoryAssignmentStatus = "auto_accepted";
export const PENDING_ASSIGNMENT: StoryAssignmentStatus = "pending_review";

// The SQL form, for raw queries and query-builder conditions. The alias is always
// a literal written in this repo's own source, never anything a caller supplies.
export function acceptedMembership(alias: string): string {
  return `${alias}."storyAssignmentStatus" = '${ACCEPTED_ASSIGNMENT}'`;
}

// ADR-0026's centroid, as one definition: the mean of a Story's *accepted* members'
// vectors. Written once because clustering recomputes it, revalidates against it and
// updates it, review's accept path updates it, and merge (#52) will recompute it —
// five sites where the same subquery drifting by one condition would let a proposal
// silently move the target every later candidate is scored against.
export function acceptedCentroid(storyAlias: string): string {
  return `(SELECT avg(member."embedding") FROM "articles" member
           WHERE member."storyId" = ${storyAlias}."id"
             AND ${acceptedMembership("member")}
             AND member."embedding" IS NOT NULL)`;
}

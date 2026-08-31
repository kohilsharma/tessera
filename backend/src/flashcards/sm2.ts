// SM-2 (SuperMemo 2, Wozniak 1987), the scheduling ADR-0021 names. Pure and
// dependency-free: it is arithmetic over three numbers, so it is a function rather
// than a library, and it is the one part of #58 with a right answer to test against.
//
// A grade is 0–5, as the algorithm defines it. What the surface calls the buttons is
// the surface's business; what the schedule does with them is here.

// The recall grades SM-2 accepts. 3 is the pass mark: below it the card lapsed.
export const MIN_REVIEW_GRADE = 0;
export const MAX_REVIEW_GRADE = 5;
export const PASSING_GRADE = 3;

// SM-2's starting ease, and the floor it may never go under — below about 1.3 the
// interval stops growing and the card is shown forever.
export const INITIAL_EASE_FACTOR = 2.5;
export const MIN_EASE_FACTOR = 1.3;

// The first two intervals are fixed by the algorithm; every later one is the
// previous interval times the ease factor.
const FIRST_INTERVAL_DAYS = 1;
const SECOND_INTERVAL_DAYS = 6;

export type ReviewSchedule = {
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
};

export function isReviewGrade(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_REVIEW_GRADE &&
    value <= MAX_REVIEW_GRADE
  );
}

// Canonical SM-2 as published. The interval is calculated from the ease factor the
// card had when it was reviewed, then the ease is updated from the grade. That order
// matters on a grade of 3 or 5: using the new ease for the interval quietly applies
// the grade twice.
export function reschedule(current: ReviewSchedule, grade: number): ReviewSchedule {
  const miss = MAX_REVIEW_GRADE - grade;
  // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), floored. SM-2
  // updates ease for every outcome, including a lapse; the reset interval and the
  // lower future multiplier record two different facts (forgotten now, harder later).
  const easeFactor = Math.max(MIN_EASE_FACTOR, current.easeFactor + (0.1 - miss * (0.08 + miss * 0.02)));

  if (grade < PASSING_GRADE) {
    return { repetitions: 0, easeFactor, intervalDays: FIRST_INTERVAL_DAYS };
  }

  const repetitions = current.repetitions + 1;
  const intervalDays =
    repetitions === 1
      ? FIRST_INTERVAL_DAYS
      : repetitions === 2
        ? SECOND_INTERVAL_DAYS
        : Math.max(current.intervalDays + 1, Math.round(current.intervalDays * current.easeFactor));

  return { repetitions, easeFactor, intervalDays };
}

// Whole days, from the moment of the review rather than from the previous due date:
// a Student who comes back a week late has waited long enough, and pushing the next
// review out from a due date they missed compounds the debt.
export function dueAfter(reviewedAt: Date, intervalDays: number): Date {
  return new Date(reviewedAt.getTime() + intervalDays * 24 * 60 * 60 * 1000);
}

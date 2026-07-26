# 11. Module cuts: drop monitoring; keep eval harness (after flagship, degradable)

Date: 2026-07-25
Status: Accepted — except the **timeline** cut is **superseded by ADR-0020** (the timeline
ships as a read view). The TrackedTopic/Notification **monitoring** cut and the eval-harness
decision below both still stand.
Depends on: ADR-0001, ADR-0002, ADR-0010

## Context

Beyond the entity graph (ADR-0002) and timeline (ADR-0010), v3 carries three more
startup-only modules: TrackedTopic, Notifications, and an evaluation harness. None is
course-required. TrackedTopic + Notifications is really a mini-product (saved-query engine +
scheduler + change-detection/diffing + notification store + read state + delivery + UI) and
is a classic "80% done, visibly broken in the demo" risk. The evaluation harness (clustering
precision/recall + generation scoring) is genuinely useful and a strong viva flex, but is a
whole metrics subsystem.

## Decision

- **Cut from graded build (deferred behind interfaces):** TrackedTopic, Notifications, and
  the timeline change-detection that "notify me what changed" implies.
- **Keep: the full evaluation harness**, with two guardrails:
  1. **Sequenced AFTER the flagship is finished end-to-end** — it is the last graded module.
     It must not compete with the flagship for the middle weeks.
  2. **Degradable** — if time runs short it collapses to an "eval sliver": a one-shot script
     reporting clustering cluster-count/publisher-diversity and generation validation
     pass-rate over the fixtures. This still gives a real "how I measure quality" viva answer.
- Fixtures (ADR-0007) double as the labeled ground-truth set for clustering precision/recall.

## Consequences

- The flagship is protected from eval-harness scope creep (contrast ADR-0006's risk).
- Threshold tuning during the flagship phase uses eyeballing/fixtures, not the harness (the
  harness formalizes measurement afterward).
- Monitoring product remains a documented later addition (tables/interfaces noted, not built).

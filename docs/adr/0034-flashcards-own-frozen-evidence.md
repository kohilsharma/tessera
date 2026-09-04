# ADR-0034: Flashcards own frozen evidence

Date: 2026-09-04
Status: Accepted

## Decision

A Flashcard owns its question, answer, and citations into an immutable EvidenceSet. Search
generation selects only accepted Story membership, freezes the matching Articles, and asks the
model for cited cards. Generation from a completed analysis remains supported as a compatibility
entry point. SM-2 scheduling and review history remain unchanged.

Cards are fully listable, readable, editable, and deletable within their Student owner. Editing
question or answer does not alter citations; deleting a card cascades its private citation rows.

## Rationale

An AnalysisClaim is shared analysis output, not a Student-owned answer. Keeping the answer and
citations on the card makes search-born cards possible without weakening the citation invariant.
The accepted-membership gate prevents unreviewed firehose reporting from becoming study material.

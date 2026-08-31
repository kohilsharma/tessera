import { STORY_NAME_MAX_LENGTH } from "../clustering/config";
import { SynthesisProvider, SynthesisRequest } from "./SynthesisProvider";

// ADR-0003 requires a deterministic Mock so the whole suite runs with no API
// key. It answers in the shape the caller asked for — a JSON object when
// `json` is set — so the validate-and-repair loop can be tested against a
// provider that never varies and never bills.
export class MockSynthesisProvider implements SynthesisProvider {
  async complete(request: SynthesisRequest): Promise<string> {
    // #51: naming a Story asks for a different JSON object than synthesis does, so
    // the Mock answers by task. The `[mock]` prefix is the point: with no key
    // configured a demo still gets named Stories, and the name says out loud that
    // no model chose it. The headline is read back out of the bullet list
    // clustering/naming.ts writes — the end-to-end Mock naming test in
    // tests/clustering.test.ts is what fails if that format ever drifts.
    if (request.task === "story_name") {
      const firstHeadline = request.prompt.match(/^- (.+)$/m)?.[1] ?? "unnamed cluster";
      return JSON.stringify({ title: `[mock] ${firstHeadline}`.slice(0, STORY_NAME_MAX_LENGTH), category: "world" });
    }
    if (!request.json) return `[mock synthesis] ${request.prompt.slice(0, 120)}`;
    // Echoing the evidence ids found in the prompt keeps the Mock honest about
    // ADR-0002's invariant: a claim carries citations, or it is not a claim.
    const ids = [...request.prompt.matchAll(/\[([a-z0-9-]{1,64})\]/gi)].map((m) => m[1]);
    // #53: and one claim of whichever Lens the prompt asked for, so the no-key demo
    // shows the role split the Lens exists for (ADR-0004) rather than a consensus
    // claim both roles would see. Read back out of the prompt for the same reason the
    // ids are — the Mock's only input is what it was asked.
    const lens = request.prompt.match(/\b(student_context|investor_implication)\b/)?.[1];
    return JSON.stringify({
      claims: [
        {
          text: "[mock synthesis] deterministic claim over the frozen evidence set.",
          claim_type: "consensus",
          citations: ids.slice(0, 2),
        },
        ...(lens && ids.length > 0
          ? [{ text: `[mock synthesis] deterministic ${lens} claim.`, claim_type: lens, citations: [ids[0]] }]
          : []),
      ],
    });
  }
}

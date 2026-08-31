import { postJsonWithRetry } from "../lib/openaiCompatible";
import { SynthesisProvider, SynthesisRequest } from "./SynthesisProvider";

// One class for every provider worth using, because they all speak
// /chat/completions: NVIDIA's integrate API, Gemini (via its
// /v1beta/openai/ surface), DeepSeek, or any other gateway. Swapping provider
// is three env vars, not a new adapter (ADR-0003).
export class OpenAICompatibleSynthesisProvider implements SynthesisProvider {
  constructor(
    private readonly apiKey: string,
    // `||`, not `??`: a bare `SYNTHESIS_MODEL=` line in a .env sets the empty
    // string, which `??` would pass through as the model id.
    private readonly model: string = process.env.SYNTHESIS_MODEL || "openai/gpt-oss-20b",
    private readonly apiBase: string = process.env.SYNTHESIS_API_BASE || "https://integrate.api.nvidia.com/v1",
  ) {}

  async complete(request: SynthesisRequest): Promise<string> {
    const messages: { role: string; content: string }[] = [];
    if (request.system) messages.push({ role: "system", content: request.system });
    messages.push({ role: "user", content: request.prompt });

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      // Low by default: synthesis is grounded extraction from a frozen
      // EvidenceSet, not creative writing.
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 2000,
    };
    if (request.json) body.response_format = { type: "json_object" };

    const parsed = (await postJsonWithRetry(
      `${this.apiBase}/chat/completions`,
      this.apiKey,
      body,
      "synthesis",
    )) as { choices?: { message?: { content?: string } }[] };

    const content = parsed.choices?.[0]?.message?.content;
    // An empty completion is a failure worth naming here, while the model that
    // produced it is still in scope — the repair loop above would otherwise
    // report it as a schema violation and burn a retry on a re-prompt.
    if (!content) throw new Error(`${this.model} returned no completion content`);
    return content;
  }
}

import { postJsonWithRetry } from "../lib/openaiCompatible";
import { SynthesisProvider, SynthesisRequest } from "./SynthesisProvider";

export class OpenAICompatibleSynthesisProvider implements SynthesisProvider {
  private readonly apiBase: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    apiBase: string,
    allowedOrigin: string,
  ) {
    const endpoint = new URL(apiBase);
    const approved = new URL(allowedOrigin);
    if (endpoint.protocol !== "https:" || endpoint.origin !== approved.origin) {
      throw new Error(`SYNTHESIS_API_BASE must use the approved origin ${approved.origin}`);
    }
    this.apiBase = apiBase.replace(/\/$/, "");
  }

  async complete(request: SynthesisRequest): Promise<string> {
    const messages: { role: string; content: string }[] = [];
    if (request.system) messages.push({ role: "system", content: request.system });
    messages.push({ role: "user", content: request.prompt });

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
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
    if (!content) throw new Error(`${this.model} returned no completion content`);
    return content;
  }
}

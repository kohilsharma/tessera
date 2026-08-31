// Shared transport for every OpenAI-compatible endpoint we talk to — NVIDIA's
// integrate API, Gemini's /v1beta/openai/ surface, DeepSeek, or any gateway.
// Embeddings and synthesis both POST JSON and both meet the same rate limiters,
// so the retry policy lives here once rather than in each provider.

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;

export async function postJsonWithRetry(
  url: string,
  apiKey: string,
  body: unknown,
  label: string,
): Promise<unknown> {
  let lastError = "";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();

    lastError = `${res.status} ${await res.text()}`;
    if (!RETRYABLE.has(res.status) || attempt === MAX_ATTEMPTS - 1) break;
    // Honour Retry-After when the server sends one — a rate limiter knows how
    // long it wants us gone better than our own backoff curve does.
    const retryAfter = Number(res.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 2 ** attempt * 500 + Math.random() * 250; // jitter: callers run in loops
    console.warn(`[${label}] ${res.status}, retrying in ${Math.round(delayMs)}ms`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`${label} request failed: ${lastError}`);
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export function openRouterConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL);
}

function jsonFromContent(content) {
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => typeof part === 'string' ? part : part?.text || part?.content || '').join('')
      : content && typeof content === 'object'
        ? JSON.stringify(content)
        : '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/** Call a named LLM agent through OpenRouter. Failure is explicit: callers must
 * never silently replace an agent decision with deterministic fabricated output. */
export async function callOpenRouterAgent({ name, system, prompt, schema, temperature = 0.15 }) {
  if (!openRouterConfigured()) throw new Error('OPENROUTER_API_KEY and OPENROUTER_MODEL are required');
  const controller = new AbortController();
  const timeoutMs = Number(process.env.OPENROUTER_TIMEOUT_MS) || 60000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-OpenRouter-Title': 'FUSION Analog Agent Studio'
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL,
        messages: [
          { role: 'system', content: system + '\nReturn only valid JSON; never generate an unconstrained netlist.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        plugins: [{ id: 'response-healing' }],
        reasoning: { effort: 'low', exclude: true },
        temperature,
        // Auto Router may select a reasoning model; leave enough completion
        // budget for both its internal work and the final JSON envelope.
        max_tokens: 3200
      }),
      signal: controller.signal
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${payload?.error?.message || 'request failed'}`);
    const parsed = jsonFromContent(payload?.choices?.[0]?.message?.content);
    if (!parsed) {
      const received = payload?.choices?.[0]?.message?.content;
      const shape = Array.isArray(received) ? 'array' : typeof received;
      throw new Error(`${name} returned invalid JSON content (${shape}; finish=${payload?.choices?.[0]?.finish_reason || 'unknown'})`);
    }
    return {
      name,
      output: parsed,
      model: payload.model || process.env.OPENROUTER_MODEL,
      usage: payload.usage || null,
      generationId: payload.id || null,
      schema
    };
  } finally {
    clearTimeout(timeout);
  }
}

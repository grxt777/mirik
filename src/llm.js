// Клиент OpenRouter (OpenAI-совместимый chat/completions с tool calling).
import { config } from './config.js';
import { store, save } from './store.js';

export async function chat({ messages, tools, temperature = 0.4, maxTokens = 4000 }) {
  const body = { model: config.model, messages, temperature, max_tokens: maxTokens };
  if (tools?.length) body.tools = tools;

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.openrouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': config.publicUrl,
          'X-Title': 'Mirik',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
      if (data.usage) {
        store.stats.tokens += data.usage.total_tokens || 0;
        store.stats.cost += data.usage.cost || 0;
        save();
      }
      return data.choices[0].message;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

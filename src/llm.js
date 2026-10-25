// Клиент OpenRouter (OpenAI-совместимый chat/completions с tool calling).
import { config } from './config.js';
import { store, save } from './store.js';

// Учёт расхода: всего, по дням и по агентам
function recordUsage(u, agent) {
  const s = store.stats;
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });
  const add = (o) => {
    o.calls = (o.calls || 0) + 1;
    o.prompt = (o.prompt || 0) + (u.prompt_tokens || 0);
    o.completion = (o.completion || 0) + (u.completion_tokens || 0);
    o.tokens = (o.tokens || 0) + (u.total_tokens || 0);
    o.cost = (o.cost || 0) + (u.cost || 0);
  };
  s.tokens += u.total_tokens || 0;
  s.cost += u.cost || 0;
  s.prompt = (s.prompt || 0) + (u.prompt_tokens || 0);
  s.completion = (s.completion || 0) + (u.completion_tokens || 0);
  add(((s.daily ||= {})[day] ||= {}));
  if (agent) add(((s.byAgent ||= {})[agent] ||= {}));
  const days = Object.keys(s.daily).sort();
  for (const d of days.slice(0, -60)) delete s.daily[d];
  save();
}

export async function chat({ messages, tools, temperature = 0.4, maxTokens = 4000, agent }) {
  // та же модель, но у самого дешёвого провайдера; если он недоступен, OpenRouter возьмёт следующий по цене
  const body = { model: config.model, messages, temperature, max_tokens: maxTokens, provider: { sort: 'price' } };
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
      if (data.usage) recordUsage(data.usage, agent);
      return Object.assign(data.choices[0].message, { _usage: data.usage });
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

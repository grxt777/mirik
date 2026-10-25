// Баланс OpenRouter, цены модели и прогноз «на сколько хватит». Плюс расход Сани по прямому каналу.
import { config } from './config.js';
import { store, save } from './store.js';

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function orGet(path) {
  const res = await fetch(`https://openrouter.ai/api/v1${path}`, {
    headers: { Authorization: `Bearer ${config.openrouterKey}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`OpenRouter ${path}: HTTP ${res.status}`);
  return (await res.json()).data;
}

async function openrouter() {
  return cached('or', 60_000, async () => {
    const [credits, key] = await Promise.all([orGet('/credits'), orGet('/key')]);
    return {
      totalCredits: credits.total_credits,
      totalUsage: credits.total_usage,
      balance: credits.total_credits - credits.total_usage,
      keyLimit: key.limit,
      keyRemaining: key.limit_remaining,
      keyUsage: key.usage,
      keyUsageDaily: key.usage_daily,
      keyUsageMonthly: key.usage_monthly,
    };
  });
}

// Цены провайдеров модели: берём самого дешёвого рабочего (к нему и идут запросы — provider.sort=price)
async function pricing() {
  return cached('price', 6 * 3600_000, async () => {
    const { endpoints } = await orGet(`/models/${config.model}/endpoints`);
    const ok = endpoints
      .filter((e) => e.status === 0 && (e.supported_parameters || []).includes('tools'))
      .map((e) => ({ provider: e.provider_name, prompt: Number(e.pricing.prompt) * 1e6, completion: Number(e.pricing.completion) * 1e6 }))
      .sort((a, b) => a.prompt + a.completion - (b.prompt + b.completion));
    return ok.length ? { ...ok[0], official: ok.find((e) => e.provider === 'Z.AI') || null } : null;
  });
}

async function sanya() {
  if (!config.sanyaUrl || !config.linkToken) return { error: 'связь с Саней не настроена' };
  return cached('sanya', 60_000, async () => {
    const res = await fetch(`${config.sanyaUrl}/link/usage`, {
      headers: { Authorization: `Bearer ${config.linkToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }).catch((e) => ({ error: e.message }));
}

export async function usageReport() {
  const s = store.stats;
  const [or, price, sanyaUsage] = await Promise.all([
    openrouter().catch((e) => ({ error: e.message })),
    pricing().catch(() => null),
    sanya(),
  ]);
  // Смешанная цена за 1 млн токенов — по реальному соотношению вход/выход у Мирика (агенты в основном читают)
  const share = s.prompt + s.completion > 0 ? s.prompt / (s.prompt + s.completion) : 0.9;
  // Реальная цена за 1 млн токенов по фактическим счетам; пока данных мало — по прайсу самого дешёвого провайдера
  const listBlended = price ? price.prompt * share + price.completion * (1 - share) : null;
  const realPerM = s.tokens > 20000 && s.cost > 0 ? (s.cost / s.tokens) * 1e6 : null;
  const recentDays = Object.keys(s.daily || {}).sort().slice(-7).map((d) => s.daily[d]);
  const recent = recentDays.reduce((a, d) => ({ tokens: a.tokens + (d.tokens || 0), cost: a.cost + (d.cost || 0) }), { tokens: 0, cost: 0 });
  const recentPerM = recent.tokens > 20000 && recent.cost > 0 ? (recent.cost / recent.tokens) * 1e6 : null;
  const blended = recentPerM ?? realPerM ?? listBlended;
  const left = or.error ? null : Math.max(0, Math.min(or.balance, or.keyRemaining ?? Infinity));
  const tasks = s.tasksDone || 0;
  return {
    model: config.model,
    openrouter: or,
    price,
    estimate: left == null || !blended ? null : {
      spendable: left,
      blendedPerM: blended,
      basis: recentPerM ? 'real7d' : realPerM ? 'real' : 'list',
      tokensLeft: (left / blended) * 1e6,
      avgTaskCost: tasks ? s.cost / tasks : null,
      tasksLeft: tasks && s.cost > 0 ? left / (s.cost / tasks) : null,
    },
    mirik: { tokens: s.tokens, prompt: s.prompt || 0, completion: s.completion || 0, cost: s.cost, tasksDone: tasks, daily: s.daily || {}, byAgent: s.byAgent || {} },
    sanya: sanyaUsage,
  };
}

// Предупреждения владельцу, когда баланс опускается ниже порогов
const THRESHOLDS = [5, 2, 1, 0.5];
export function watchBalance(notify) {
  const check = async () => {
    try {
      cache.delete('or');
      const or = await openrouter();
      const left = Math.min(or.balance, or.keyRemaining ?? Infinity);
      const crossed = THRESHOLDS.filter((t) => left < t).at(-1);
      const last = store.lowBalanceAlert ?? Infinity;
      if (crossed != null && crossed < last) {
        store.lowBalanceAlert = crossed;
        save();
        await notify(`💸 На OpenRouter осталось $${left.toFixed(2)} (меньше $${crossed}). Пополни баланс, иначе Мирик и команда остановятся.`);
      } else if (crossed == null && store.lowBalanceAlert != null) {
        delete store.lowBalanceAlert; // пополнили — снова следим за порогами
        save();
      }
    } catch {}
  };
  setTimeout(check, 20_000);
  setInterval(check, 15 * 60_000);
}

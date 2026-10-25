// Память Мирика: журнал выполненных задач + факты, поиск BM25 (без сторонних моделей),
// сводка старой переписки, состояние офиса и вычистка секретов из всего, что хранится.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { store, save } from './store.js';

// ---------- секреты не должны оседать в истории ----------
export function scrub(text) {
  let s = String(text ?? '');
  for (const v of Object.values(store.secrets)) if (typeof v === 'string' && v.length >= 4) s = s.split(v).join('[секрет]');
  return s;
}

export function scrubAll() {
  for (const t of store.tasks) {
    t.text = scrub(t.text);
    t.result = t.result && scrub(t.result);
    for (const s of t.steps) s.text = scrub(s.text);
  }
  for (const h of Object.values(store.chats)) for (const m of h) if (typeof m.content === 'string') m.content = scrub(m.content);
  for (const j of store.journal || []) { j.text = scrub(j.text); j.result = scrub(j.result); }
  save();
}

// ---------- поиск BM25 ----------
const STOP = new Set('и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между the a an of to in is and or for on with че там мирик'.split(' '));
const stem = (w) => (w.length > 6 ? w.slice(0, 6) : w);
export const tokenize = (s) => String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);

function bm25(docs, query, k = 6) {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !docs.length) return [];
  const toks = docs.map((d) => tokenize(d.text));
  const avg = toks.reduce((n, t) => n + t.length, 0) / toks.length || 1;
  const df = Object.fromEntries(q.map((w) => [w, toks.filter((t) => t.includes(w)).length]));
  return docs
    .map((d, i) => {
      const t = toks[i];
      let score = 0;
      for (const w of q) {
        const f = t.filter((x) => x === w).length;
        if (!f) continue;
        const idf = Math.log(1 + (docs.length - df[w] + 0.5) / (df[w] + 0.5));
        score += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (t.length / avg)));
      }
      return { d, score: score * (d.boost || 1) };
    })
    .filter((x) => x.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.d);
}

// ---------- журнал задач ----------
export function addJournal(task) {
  if (task.agent !== 'mirik' && task.source !== 'telegram') return;
  (store.journal ||= []).push({
    id: task.id,
    t: task.createdAt,
    chatId: task.chatId,
    text: scrub(task.text).slice(0, 400),
    result: scrub(task.result || '').slice(0, 900),
  });
  if (store.journal.length > 600) store.journal.splice(0, store.journal.length - 600);
  save();
}

const when = (t) => new Date(t).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function recallFor(query, exclude = new Set()) {
  const docs = [
    ...store.memory.map((m) => ({ text: m.text, label: `факт: ${m.text}`, boost: 1.3 })),
    ...(store.journal || []).filter((j) => !exclude.has(j.id)).map((j) => ({ text: `${j.text} ${j.result}`, label: `[${when(j.t)}] задача «${j.text.slice(0, 160)}» → ${j.result.slice(0, 400)}` })),
  ];
  return bm25(docs, query, 6).map((d) => '- ' + d.label.replace(/\n+/g, ' ')).join('\n');
}

// ---------- состояние офиса: что реально происходит прямо сейчас ----------
function recentFiles() {
  const out = [];
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(full, depth + 1); }
      else { try { out.push({ p: path.relative(config.workspaceDir, full), m: fs.statSync(full).mtimeMs }); } catch {} }
    }
  };
  walk(config.workspaceDir, 0);
  return out.sort((a, b) => b.m - a.m).slice(0, 12);
}

export function officeState(agentState, AGENTS, currentTaskId) {
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : `${Math.round(m / 60)} ч назад`; };
  const running = store.tasks.filter((t) => t.status === 'running' && t.id !== currentTaskId);
  const lines = [];
  lines.push(running.length ? 'Сейчас выполняется:' : 'Сейчас других задач в работе нет.');
  for (const t of running) {
    const who = [...new Set(t.steps.map((s) => AGENTS[s.agent]?.name).filter(Boolean))].join(', ');
    const last = t.steps.slice(-3).map((s) => `${AGENTS[s.agent]?.name}: ${s.text.replace(/\n+/g, ' ').slice(0, 120)}`).join(' | ');
    lines.push(`- «${t.text.slice(0, 120)}» (начата ${ago(t.createdAt)}; участвуют: ${who || '—'}) — последние шаги: ${last}`);
  }
  const busy = Object.values(agentState).filter((s) => s.status !== 'idle' && s.id !== 'mirik');
  lines.push('Сотрудники: ' + Object.values(agentState).filter((s) => s.id !== 'mirik').map((s) => `${AGENTS[s.id].name} — ${s.status === 'idle' ? 'свободен' : s.activity}`).join('; '));
  const done = store.tasks.filter((t) => ['done', 'failed', 'cancelled', 'interrupted'].includes(t.status) && t.id !== currentTaskId).slice(-6);
  if (done.length) {
    lines.push('Недавно завершено:');
    for (const t of done) lines.push(`- [${t.status}, ${ago(t.finishedAt || t.createdAt)}] «${t.text.slice(0, 100)}» → ${(t.result || '').replace(/\n+/g, ' ').slice(0, 220)}`);
  }
  const files = recentFiles();
  if (files.length) lines.push('Свежие файлы в рабочей папке: ' + files.map((f) => f.p).join(', '));
  const secrets = Object.keys(store.secrets);
  lines.push(`Доступы (секреты): ${secrets.length ? secrets.join(', ') : 'нет'}.${secrets.includes('eclass_pass') ? ' Доступ к e-class ЕСТЬ — Боря может входить.' : ' Доступа к e-class нет.'}`);
  if (busy.length) lines.push('Если владелец спрашивает «как там/какой этап» — отвечай по этим данным, НЕ запускай задачу заново.');
  return lines.join('\n');
}

// ---------- сводка старой переписки ----------
export async function compressHistory(chatId, summarize) {
  const h = store.chats[chatId];
  if (!h || h.length <= 40) return;
  const old = h.splice(0, h.length - 20);
  const prev = (store.chatSummaries ||= {})[chatId] || '';
  const text = old.map((m) => `${m.role === 'user' ? 'Владелец' : 'Мирик'}: ${String(m.content).slice(0, 500)}`).join('\n');
  try {
    store.chatSummaries[chatId] = (await summarize(prev, text)).slice(0, 2000);
  } catch {
    store.chatSummaries[chatId] = (prev + '\n' + text).slice(-2000);
  }
  save();
}

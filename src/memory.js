// Память Мирика: журнал выполненных задач + факты, поиск BM25 (без сторонних моделей),
// сводка старой переписки, состояние офиса и вычистка секретов из всего, что хранится.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { store, save } from './store.js';
import { secretValues, secretNames } from './secrets.js';
import * as memdb from './memdb.js';

// ---------- секреты не должны оседать в истории ----------
export function scrub(text) {
  let s = String(text ?? '');
  for (const v of secretValues()) if (typeof v === 'string' && v.length >= 4) s = s.split(v).join('[секрет]');
  return s;
}

export function scrubAll() {
  for (const t of store.tasks) {
    t.text = scrub(t.text);
    t.result = t.result && scrub(t.result);
    for (const s of t.steps) s.text = scrub(s.text);
  }
  memdb.scrubValues(secretValues());
  save();
}

// ---------- журнал задач и поиск: SQLite + FTS5 (memdb.js) ----------
export function addJournal(task) {
  if (task.agent !== 'mirik' && task.source !== 'telegram') return;
  memdb.addJournal({ ...task, text: scrub(task.text), result: scrub(task.result || '') });
}

export function recallFor(query, { skipMsgIds, skipTaskIds } = {}) {
  return memdb.search(query, { k: 6, skipMsgIds, skipTaskIds }).map((l) => '- ' + l).join('\n');
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
  const secrets = secretNames();
  lines.push(`Доступы (секреты): ${secrets.length ? secrets.join(', ') : 'нет'}.${secrets.includes('eclass_pass') ? ' Доступ к e-class ЕСТЬ — Боря может входить.' : ' Доступа к e-class нет.'}`);
  if (busy.length) lines.push('Если владелец спрашивает «как там/какой этап» — отвечай по этим данным, НЕ запускай задачу заново.');
  return lines.join('\n');
}

// ---------- сводка старой переписки + автоматические факты ----------
export async function compressHistory(chatId, summarize) {
  const rows = memdb.pendingForSummary(chatId);
  if (!rows.length) return;
  const prev = memdb.summary(chatId);
  const text = rows.map((m) => `${m.role === 'user' ? 'Владелец' : 'Мирик'}: ${String(m.content).slice(0, 600)}`).join('\n');
  let out = '';
  try { out = await summarize(prev, text); } catch { return; }
  const [sumPart, factPart = ''] = out.split(/\n?ФАКТЫ:\s*\n?/i);
  memdb.setSummary(chatId, sumPart.replace(/^СВОДКА:\s*/i, '').trim().slice(0, 2500), rows.at(-1).id);
  for (const line of factPart.split('\n')) {
    const f = line.replace(/^[\s\-•*\d.)]+/, '').trim();
    if (f.length > 8 && f.length < 300 && !/^нет\b/i.test(f)) memdb.addFact(f, 'auto');
  }
}

// Долгая память Мирика: SQLite (WAL) + полнотекстовый поиск FTS5.
// Здесь живут факты о владельце, журнал выполненных задач, ВСЯ переписка (архив) и сводки чатов.
// Эмбеддингов нет сознательно (только GLM): поиск по словам с учётом окончаний, а «по смыслу» —
// агентно: Мирик сам переформулирует запрос через инструмент recall.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { store, save } from './store.js';

// отдельная закрытая папка: агентский пользователь sandbox не может даже заглянуть (включая -wal/-shm)
const dir = path.join(config.dataDir, 'private');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.chmodSync(dir, 0o700);

const db = new DatabaseSync(path.join(dir, 'memory.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS facts (id INTEGER PRIMARY KEY, text TEXT NOT NULL, source TEXT, created_at INTEGER);
  CREATE TABLE IF NOT EXISTS journal (id TEXT PRIMARY KEY, t INTEGER, chat_id TEXT, text TEXT, result TEXT);
  CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, chat_id TEXT, role TEXT, content TEXT, t INTEGER);
  CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, id);
  CREATE TABLE IF NOT EXISTS chats (chat_id TEXT PRIMARY KEY, summary TEXT DEFAULT '', summarized_upto INTEGER DEFAULT 0, reset_upto INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY, key TEXT UNIQUE, name TEXT, role TEXT DEFAULT '', score INTEGER, relation TEXT, knows TEXT DEFAULT '[]', history TEXT DEFAULT '[]', created_at INTEGER, updated_at INTEGER);
  CREATE VIRTUAL TABLE IF NOT EXISTS mem_fts USING fts5(kind UNINDEXED, ref UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2');
`);

const q = (sql) => db.prepare(sql);
const index = (kind, ref, body) => q('INSERT INTO mem_fts(kind, ref, body) VALUES (?, ?, ?)').run(kind, String(ref), body);
const chatKey = (id) => String(id);

// ---------- факты ----------
export function addFact(text, source = 'manual') {
  text = String(text).trim().slice(0, 500);
  if (!text) return null;
  if (q('SELECT id FROM facts WHERE lower(text) = lower(?)').get(text)) return null;
  const { lastInsertRowid: id } = q('INSERT INTO facts(text, source, created_at) VALUES (?, ?, ?)').run(text, source, Date.now());
  index('fact', id, text);
  return Number(id);
}
export const listFacts = (n = 40) => q('SELECT id, text FROM facts ORDER BY id DESC LIMIT ?').all(n).reverse();
export const factCount = () => q('SELECT COUNT(*) c FROM facts').get().c;
export function deleteFact(id) {
  const r = q('DELETE FROM facts WHERE id = ?').run(id);
  q("DELETE FROM mem_fts WHERE kind = 'fact' AND ref = ?").run(String(id));
  return r.changes > 0;
}
export function clearFacts() {
  db.exec("DELETE FROM facts; DELETE FROM mem_fts WHERE kind = 'fact';");
}

// ---------- журнал задач ----------
export function addJournal({ id, createdAt, chatId, text, result }) {
  q('INSERT OR REPLACE INTO journal(id, t, chat_id, text, result) VALUES (?, ?, ?, ?, ?)').run(id, createdAt, chatKey(chatId), text.slice(0, 600), (result || '').slice(0, 1500));
  q("DELETE FROM mem_fts WHERE kind = 'task' AND ref = ?").run(id);
  index('task', id, `${text}\n${result || ''}`);
}

// ---------- переписка: полный архив + окно для контекста ----------
function chatRow(chatId) {
  q('INSERT OR IGNORE INTO chats(chat_id) VALUES (?)').run(chatKey(chatId));
  return q('SELECT * FROM chats WHERE chat_id = ?').get(chatKey(chatId));
}
export function addMessage(chatId, role, content) {
  const { lastInsertRowid: id } = q('INSERT INTO messages(chat_id, role, content, t) VALUES (?, ?, ?, ?)').run(chatKey(chatId), role, content, Date.now());
  index('msg', id, content);
}
// последние сообщения после сводки/сброса — то, что идёт в контекст как диалог
export function history(chatId, n = 20) {
  const c = chatRow(chatId);
  const from = Math.max(c.summarized_upto, c.reset_upto);
  return q('SELECT id, role, content FROM messages WHERE chat_id = ? AND id > ? ORDER BY id DESC LIMIT ?').all(chatKey(chatId), from, n).reverse();
}
export const summary = (chatId) => chatRow(chatId).summary;
export function resetChat(chatId) {
  const max = q('SELECT MAX(id) m FROM messages WHERE chat_id = ?').get(chatKey(chatId)).m || 0;
  chatRow(chatId);
  q("UPDATE chats SET reset_upto = ?, summary = '' WHERE chat_id = ?").run(max, chatKey(chatId));
}
// всё, что ещё не сжато в сводку (кроме последних keep сообщений)
export function pendingForSummary(chatId, threshold = 40, keep = 20) {
  const c = chatRow(chatId);
  const from = Math.max(c.summarized_upto, c.reset_upto);
  const rows = q('SELECT id, role, content FROM messages WHERE chat_id = ? AND id > ? ORDER BY id').all(chatKey(chatId), from);
  return rows.length > threshold ? rows.slice(0, rows.length - keep) : [];
}
export function setSummary(chatId, text, upto) {
  chatRow(chatId);
  q('UPDATE chats SET summary = ?, summarized_upto = ? WHERE chat_id = ?').run(text, upto, chatKey(chatId));
}

// ---------- сеть: люди вокруг владельца и их отношение к нему ----------
const personKey = (name) => String(name || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const personOut = (p) => p && { ...p, knows: JSON.parse(p.knows || '[]'), history: JSON.parse(p.history || '[]') };

// повторный занос того же человека обновляет оценку и отношение (имя остаётся как при первом заносе); прошлые оценки — в истории
export function upsertPerson({ name, score, relation, role, knows }) {
  name = String(name || '').trim().slice(0, 80);
  const key = personKey(name);
  if (!key) throw new Error('Не указано имя');
  score = Math.round(Number(score));
  if (!(score >= 1 && score <= 10)) throw new Error('Оценка — целое от 1 до 10');
  relation = String(relation || '').trim().slice(0, 1200);
  if (!relation) throw new Error('Не описано отношение');
  const now = Date.now();
  const old = personOut(q('SELECT * FROM people WHERE key = ?').get(key));
  const links = [...new Set([...(old?.knows || []), ...(Array.isArray(knows) ? knows : [])].map((n) => String(n).trim().slice(0, 80)).filter((n) => n && personKey(n) !== key))].slice(0, 40);
  const history = [...(old?.history || []), { t: now, score }].slice(-30);
  if (old) {
    q('UPDATE people SET name = ?, role = ?, score = ?, relation = ?, knows = ?, history = ?, updated_at = ? WHERE id = ?')
      .run(old.name, String(role ?? old.role ?? '').trim().slice(0, 80), score, relation, JSON.stringify(links), JSON.stringify(history), now, old.id);
    return { id: old.id, updated: true, prev: old.score };
  }
  const { lastInsertRowid: id } = q('INSERT INTO people(key, name, role, score, relation, knows, history, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(key, name, String(role || '').trim().slice(0, 80), score, relation, JSON.stringify(links), JSON.stringify(history), now, now);
  return { id: Number(id), updated: false };
}
export const listPeople = () => q('SELECT * FROM people ORDER BY score DESC, name').all().map(personOut);
export const getPerson = (name) => personOut(q('SELECT * FROM people WHERE key = ?').get(personKey(name)));
export function deletePerson(idOrName) {
  const r = typeof idOrName === 'number' ? q('DELETE FROM people WHERE id = ?').run(idOrName) : q('DELETE FROM people WHERE key = ?').run(personKey(idOrName));
  return r.changes > 0;
}

// ---------- поиск ----------
const STOP = new Set('и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему когда даже ну ли если уже или ни быть был до вас вам там потом себя ничего ей может они тут где есть надо для мы тебя их чем была сам без кто этот того этого какой здесь этом один мой тем чтобы сейчас были куда можно при два об другой хоть после над больше тот через эти нас про всего них много три эту моя свою этой перед лучше чуть том такой им более всегда между the a an of to in is and or for on with че там мирик мирика мирику ты'.split(' '));

export function ftsQuery(text) {
  const words = [...new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])].filter((w) => w.length > 1 && !STOP.has(w));
  // приблизительная морфология: префикс слова + * (кинотеатры/кинотеатров/кинотеатр → кинот*)
  return words.slice(0, 16).map((w) => (w.length > 5 ? `"${w.slice(0, Math.max(4, w.length - 3))}"*` : `"${w}"*`)).join(' OR ');
}

const when = (t) => new Date(t).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Ищет по фактам, прошлым задачам и архиву переписки. skipMsgIds — сообщения, которые уже в контексте.
export function search(text, { k = 6, skipMsgIds = new Set(), skipTaskIds = new Set() } = {}) {
  const match = ftsQuery(text);
  if (!match) return [];
  let rows;
  try {
    rows = q('SELECT kind, ref, bm25(mem_fts) AS score FROM mem_fts WHERE mem_fts MATCH ? ORDER BY score LIMIT 60').all(match);
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set();
  const push = (line, key) => { if (!seen.has(key)) { seen.add(key); out.push(line); } };
  for (const r of rows) {
    if (out.length >= k) break;
    if (r.kind === 'fact') {
      const f = q('SELECT id, text FROM facts WHERE id = ?').get(Number(r.ref));
      if (f) push(`факт #${f.id}: ${f.text}`, 'f' + f.text);
    } else if (r.kind === 'task') {
      if (skipTaskIds.has(r.ref)) continue;
      const j = q('SELECT * FROM journal WHERE id = ?').get(r.ref);
      if (j) push(`[${when(j.t)}] задача «${j.text.slice(0, 200)}» → ${j.result.replace(/\n+/g, ' ').slice(0, 500)}`, 't' + j.text);
    } else if (r.kind === 'msg') {
      if (skipMsgIds.has(Number(r.ref))) continue;
      const m = q('SELECT * FROM messages WHERE id = ?').get(Number(r.ref));
      if (m) push(`[${when(m.t)}] ${m.role === 'user' ? 'владелец' : 'Мирик'}: ${m.content.replace(/\n+/g, ' ').slice(0, 400)}`, 'm' + m.content);
    }
  }
  return out;
}

// ---------- секреты не должны оседать в памяти ----------
export function scrubValues(values) {
  for (const v of values) {
    if (typeof v !== 'string' || v.length < 4) continue;
    q("UPDATE messages SET content = replace(content, ?, '[секрет]') WHERE instr(content, ?) > 0").run(v, v);
    q("UPDATE journal SET text = replace(text, ?, '[секрет]'), result = replace(result, ?, '[секрет]') WHERE instr(text, ?) > 0 OR instr(result, ?) > 0").run(v, v, v, v);
    q("UPDATE chats SET summary = replace(summary, ?, '[секрет]') WHERE instr(summary, ?) > 0").run(v, v);
    q("UPDATE mem_fts SET body = replace(body, ?, '[секрет]') WHERE body LIKE '%' || ? || '%'").run(v, v);
  }
}

// ---------- переезд из db.json ----------
if (store.memory || store.journal || store.chats || store.chatSummaries) {
  db.exec('BEGIN');
  for (const m of store.memory || []) addFact(m.text, 'manual');
  for (const j of store.journal || []) addJournal({ id: j.id, createdAt: j.t, chatId: j.chatId, text: j.text, result: j.result });
  for (const [chatId, msgs] of Object.entries(store.chats || {})) for (const m of msgs) addMessage(chatId, m.role, String(m.content));
  for (const [chatId, s] of Object.entries(store.chatSummaries || {})) { chatRow(chatId); q('UPDATE chats SET summary = ? WHERE chat_id = ?').run(s, chatKey(chatId)); }
  db.exec('COMMIT');
  delete store.memory; delete store.journal; delete store.chats; delete store.chatSummaries;
  save();
  console.log('[memory] перенёс память из db.json в SQLite');
}

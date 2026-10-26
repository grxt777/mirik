// Энциклопедия StartupBase: отрасли → идеи (с оценками совета) и проверенные факты (с источником и датой).
// Каждое исследование пополняет базу, следующее начинает с неё — и тратит меньше токенов на повторный поиск.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { ftsQuery } from './memdb.js';

const dir = path.join(config.dataDir, 'private');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(dir, 'vcbase.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY, slug TEXT UNIQUE, title TEXT, summary TEXT, sector TEXT, tags TEXT, region TEXT,
    folder TEXT, avg_score REAL, decision TEXT, created_at INTEGER, updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS opinions (
    id INTEGER PRIMARY KEY, idea_id INTEGER, agent TEXT, score REAL, verdict TEXT, file TEXT, created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY, sector TEXT, idea_id INTEGER, kind TEXT, text TEXT, source TEXT, as_of TEXT, agent TEXT, created_at INTEGER
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS vc_fts USING fts5(kind UNINDEXED, ref UNINDEXED, sector UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2');
`);
const q = (sql) => db.prepare(sql);

export const SECTORS = {
  agritech: { name: 'Агритех', emoji: '🌾', words: ['агро', 'agri', 'ферм', 'урожа', 'хлоп', 'сельск', 'посев', 'теплиц', 'скот'] },
  fintech: { name: 'Финтех', emoji: '💳', words: ['фин', 'fin', 'банк', 'платеж', 'плат', 'кредит', 'займ', 'карт', 'страхов', 'инвест', 'крипт'] },
  foodtech: { name: 'Фудтех', emoji: '🍔', words: ['food', 'еда', 'ресторан', 'достав', 'кафе', 'кухн', 'продукт питан'] },
  edtech: { name: 'Эдтех', emoji: '🎓', words: ['edu', 'обучен', 'образов', 'курс', 'школ', 'студент', 'репетит'] },
  healthtech: { name: 'Медтех', emoji: '🩺', words: ['health', 'мед', 'врач', 'клиник', 'здоров', 'аптек', 'диагност'] },
  ecommerce: { name: 'E-commerce', emoji: '🛍', words: ['commerce', 'магазин', 'маркетплейс', 'торгов', 'ритейл', 'продаж онлайн'] },
  logistics: { name: 'Логистика', emoji: '🚚', words: ['логист', 'груз', 'склад', 'перевоз', 'курьер', 'достав груз'] },
  mobility: { name: 'Мобильность', emoji: '🚕', words: ['такси', 'транспорт', 'авто', 'каршер', 'самокат', 'mobility'] },
  proptech: { name: 'Недвижимость', emoji: '🏠', words: ['недвиж', 'аренд', 'квартир', 'строит', 'property'] },
  cleantech: { name: 'Клинтех и энергия', emoji: '⚡', words: ['энерг', 'солнеч', 'эко', 'отход', 'переработ', 'вод', 'clean', 'климат'] },
  hrtech: { name: 'HR-тех', emoji: '👔', words: ['hr', 'найм', 'ваканс', 'резюме', 'сотрудник', 'кадр'] },
  traveltech: { name: 'Туризм', emoji: '✈️', words: ['тур', 'travel', 'отел', 'путешеств', 'гостиниц'] },
  media: { name: 'Медиа и игры', emoji: '🎮', words: ['медиа', 'игр', 'game', 'контент', 'видео', 'музык', 'блог'] },
  saas: { name: 'B2B SaaS', emoji: '🧩', words: ['saas', 'crm', 'erp', 'b2b', 'автоматизац', 'бизнес-софт'] },
  ai: { name: 'AI и дип-тех', emoji: '🤖', words: ['ии', ' ai', 'нейросет', 'машинн', 'робот', 'дрон', 'компьютерное зрение'] },
  govtech: { name: 'Гос и соц', emoji: '🏛', words: ['гос', 'социал', 'благотвор', 'город'] },
  other: { name: 'Другое', emoji: '🧪', words: [] },
};

// «агротех», «AgriTech», «сельское хозяйство» → agritech; по тексту идеи — по ключевым словам
export function normalizeSector(s, text = '') {
  const v = String(s || '').toLowerCase().trim();
  if (SECTORS[v]) return v;
  const hay = `${v} ${String(text).toLowerCase()}`;
  let best = 'other', bestHits = 0;
  for (const [id, sec] of Object.entries(SECTORS)) {
    const hits = sec.words.filter((w) => hay.includes(w)).length + (sec.name.toLowerCase() === v ? 5 : 0);
    if (hits > bestHits) { best = id; bestHits = hits; }
  }
  return best;
}

const slugify = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'idea';
const day = (t) => new Date(t).toISOString().slice(0, 10);
const ageMonths = (iso) => { const d = Date.parse(iso); return isNaN(d) ? null : Math.max(0, Math.round((Date.now() - d) / (30.4 * 864e5))); };

// ---------- факты ----------
export function saveFacts(list, { agent } = {}) {
  let saved = 0, dup = 0;
  for (const f of list || []) {
    const text = String(f.text || '').trim().slice(0, 600);
    if (text.length < 8) continue;
    if (q('SELECT id FROM facts WHERE lower(text) = lower(?)').get(text)) { dup++; continue; }
    const sector = normalizeSector(f.sector, text);
    const ideaId = f.idea ? q('SELECT id FROM ideas WHERE slug = ? OR folder = ?').get(f.idea, f.idea)?.id ?? null : null;
    const { lastInsertRowid: id } = q('INSERT INTO facts(sector, idea_id, kind, text, source, as_of, agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(sector, ideaId, String(f.kind || 'fact').slice(0, 20), text, String(f.source || '').slice(0, 300), String(f.as_of || day(Date.now())).slice(0, 10), agent || '', Date.now());
    q('INSERT INTO vc_fts(kind, ref, sector, body) VALUES (?, ?, ?, ?)').run('fact', String(id), sector, `${text} ${f.kind || ''}`);
    saved++;
  }
  return { saved, dup };
}

// ---------- идеи: оценки берём прямо из файлов мнений совета (без участия модели) ----------
function parseOpinion(text) {
  const score = text.match(/оценка[^\d\n]{0,12}(\d+(?:[.,]\d)?)\s*(?:\/|из)\s*10/i);
  const verdict = text.match(/(?:вердикт|решение)\s*[:：]\s*\**\s*(.+)/i);
  return { score: score ? parseFloat(score[1].replace(',', '.')) : null, verdict: verdict ? verdict[1].replace(/\*+/g, '').trim().slice(0, 300) : '' };
}

export function recordIdea({ title, summary, sector, tags, region, folder }, wsPath) {
  const slug = slugify(folder ? path.basename(folder) : title);
  const now = Date.now();
  const sec = normalizeSector(sector, `${title} ${summary} ${tags}`);
  const existing = q('SELECT id FROM ideas WHERE slug = ?').get(slug);
  let id = existing?.id;
  if (id) q('UPDATE ideas SET title = ?, summary = ?, sector = ?, tags = ?, region = ?, folder = ?, updated_at = ? WHERE id = ?').run(title, summary, sec, tags || '', region || '', folder || '', now, id);
  else id = Number(q('INSERT INTO ideas(slug, title, summary, sector, tags, region, folder, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(slug, title, summary, sec, tags || '', region || '', folder || '', now, now).lastInsertRowid);
  // мнения совета из opinions/*.md
  const opinions = [];
  if (folder) {
    let dirFull;
    try { dirFull = wsPath(path.join(folder, 'opinions')); } catch {}
    for (const f of dirFull && fs.existsSync(dirFull) ? fs.readdirSync(dirFull).filter((n) => n.endsWith('.md')) : []) {
      const agent = f.replace(/\.md$/, '');
      const parsed = parseOpinion(fs.readFileSync(path.join(dirFull, f), 'utf8'));
      q('DELETE FROM opinions WHERE idea_id = ? AND agent = ? AND created_at > ?').run(id, agent, now - 864e5); // повтор того же дня — заменяем
      q('INSERT INTO opinions(idea_id, agent, score, verdict, file, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, agent, parsed.score, parsed.verdict, path.join(folder, 'opinions', f), now);
      opinions.push({ agent, ...parsed });
    }
  }
  const scored = opinions.filter((o) => o.score != null);
  const avg = scored.length ? scored.reduce((n, o) => n + o.score, 0) / scored.length : null;
  const decision = opinions.find((o) => o.agent === 'bakhtiyor')?.verdict || '';
  q('UPDATE ideas SET avg_score = ?, decision = ? WHERE id = ?').run(avg, decision, id);
  q("DELETE FROM vc_fts WHERE kind = 'idea' AND ref = ?").run(String(id));
  q('INSERT INTO vc_fts(kind, ref, sector, body) VALUES (?, ?, ?, ?)').run('idea', String(id), sec, `${title} ${summary} ${tags || ''} ${region || ''} ${opinions.map((o) => o.verdict).join(' ')}`);
  return { id, slug, sector: sec, avg, opinions };
}

// Совет сохранил мнение → идея сразу попадает в базу (не зависит от того, вспомнит ли Мирик про vc_record_idea)
export function autoRecord(folder, taskText, wsPath) {
  const slug = slugify(path.basename(folder));
  const ex = q('SELECT * FROM ideas WHERE slug = ?').get(slug);
  const text = String(taskText || '').replace(/^\[[^\]]+\]:\s*/, '').replace(/^мирик[,!]?\s*/i, '').replace(/^оцените идею[:\s]*/i, '');
  return recordIdea({
    title: ex?.title || text.slice(0, 90) || slug,
    summary: ex?.summary || text.slice(0, 500),
    sector: ex?.sector || normalizeSector('', text),
    tags: ex?.tags || '',
    region: ex?.region || (/узбек/i.test(text) ? 'Узбекистан' : ''),
    folder,
  }, wsPath);
}

// ---------- поиск ----------
export function lookup(text, { sector, k = 8 } = {}) {
  const match = ftsQuery(text);
  const sec = sector ? normalizeSector(sector) : null;
  let rows = [];
  if (match) {
    try { rows = q('SELECT kind, ref, sector, bm25(vc_fts) s FROM vc_fts WHERE vc_fts MATCH ? ORDER BY s LIMIT 80').all(match); } catch {}
  }
  if (sec) rows = rows.filter((r) => r.sector === sec);
  const ideas = [], facts = [];
  for (const r of rows) {
    if (r.kind === 'idea' && ideas.length < 3) {
      const i = q('SELECT * FROM ideas WHERE id = ?').get(Number(r.ref));
      if (i) ideas.push({ ...i, opinions: q('SELECT agent, score, verdict FROM opinions WHERE idea_id = ? ORDER BY id DESC').all(i.id) });
    } else if (r.kind === 'fact' && facts.length < k) {
      const f = q('SELECT * FROM facts WHERE id = ?').get(Number(r.ref));
      if (f) facts.push(f);
    }
  }
  // без запроса или если мало нашлось — свежие факты отрасли
  const s2 = sec || (ideas[0]?.sector ?? null);
  if (s2 && facts.length < k) {
    for (const f of q('SELECT * FROM facts WHERE sector = ? ORDER BY created_at DESC LIMIT ?').all(s2, k)) if (!facts.some((x) => x.id === f.id) && facts.length < k) facts.push(f);
  }
  return { ideas, facts };
}

const NAMES = { artem: 'Артём', dina: 'Дина', kamila: 'Камила', bakhtiyor: 'Бахтиёр' };
export function formatLookup({ ideas, facts }) {
  const out = [];
  if (ideas.length) {
    out.push('Похожие идеи, которые уже оценивали:');
    for (const i of ideas) {
      const ops = i.opinions.map((o) => `${NAMES[o.agent] || o.agent} ${o.score ?? '?'}/10`).join(', ');
      out.push(`- «${i.title}» [${SECTORS[i.sector]?.name || i.sector}, ${day(i.updated_at)}] средняя ${i.avg_score?.toFixed(1) ?? '?'}/10 (${ops}). Инвестор: ${i.decision || '—'}. Папка: ${i.folder}`);
    }
  }
  if (facts.length) {
    out.push('Факты из базы (с источником и датой — переиспользуй, не ищи заново; старше 12 мес. перепроверь, если критично):');
    for (const f of facts) out.push(`- [${SECTORS[f.sector]?.name || f.sector}, ${f.as_of}${ageMonths(f.as_of) > 12 ? ', устарел?' : ''}] ${f.text}${f.source ? ` — ${f.source}` : ''}`);
  }
  return out.join('\n');
}

// ---------- для админки и Telegram ----------
export function overview() {
  const sectors = Object.entries(SECTORS).map(([id, s]) => {
    const st = q('SELECT COUNT(*) n, AVG(avg_score) a FROM ideas WHERE sector = ?').get(id);
    const fc = q('SELECT COUNT(*) n FROM facts WHERE sector = ?').get(id).n;
    return { id, name: s.name, emoji: s.emoji, ideas: st.n, avg: st.a, facts: fc };
  });
  const ideas = q('SELECT * FROM ideas ORDER BY updated_at DESC LIMIT 200').all().map((i) => ({
    ...i,
    opinions: q('SELECT agent, score, verdict, file, created_at FROM opinions WHERE idea_id = ? ORDER BY id DESC').all(i.id),
    facts: q('SELECT COUNT(*) n FROM facts WHERE idea_id = ?').get(i.id).n,
  }));
  return { sectors, ideas, totals: { ideas: ideas.length, facts: q('SELECT COUNT(*) n FROM facts').get().n } };
}

// Карточка идеи для страницы энциклопедии: все мнения (с полным текстом из файлов), факты идеи и отрасли
export function ideaDetail(id, readFile) {
  const idea = q('SELECT * FROM ideas WHERE id = ?').get(id);
  if (!idea) return null;
  const opinions = q('SELECT * FROM opinions WHERE idea_id = ? ORDER BY id DESC').all(id);
  const latest = new Map();
  for (const o of opinions) if (!latest.has(o.agent)) latest.set(o.agent, { ...o, text: o.file ? readFile(o.file) : '' });
  return {
    ...idea,
    opinions: [...latest.values()],
    history: opinions.length > latest.size ? opinions.length - latest.size : 0,
    facts: q('SELECT * FROM facts WHERE idea_id = ? ORDER BY created_at DESC').all(id),
    sectorFacts: q('SELECT * FROM facts WHERE sector = ? AND (idea_id IS NULL OR idea_id != ?) ORDER BY created_at DESC LIMIT 15').all(idea.sector, id),
  };
}

export function allFacts(limit = 1000) {
  return q('SELECT * FROM facts ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function sectorFacts(sector, limit = 200) {
  return q('SELECT * FROM facts WHERE sector = ? ORDER BY created_at DESC LIMIT ?').all(normalizeSector(sector), limit);
}

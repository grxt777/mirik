// Аккаунт владельца в Telegram (MTProto, GramJS) — ТОЛЬКО ЧТЕНИЕ переписок.
// Сессия = полный доступ к аккаунту, поэтому: лежит в /data/private (700, коду агентов недоступна),
// не попадает в secrets.json (её нельзя «ввести в форму»), а наружу торчат лишь функции чтения.
// Вход — командами бота владельцу, код и пароль 2FA мимо LLM.
import fs from 'node:fs';
import path from 'node:path';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { computeCheck } from 'telegram/Password.js';
import { config } from './config.js';

const dir = path.join(config.dataDir, 'private');
const file = path.join(dir, 'tg_session');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

// служебный чат Telegram (туда приходят коды входа) — никогда не читаем
const BLOCKED = new Set(['777000']);
const IDLE_MS = 10 * 60_000;

const readSession = () => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } };
function saveSession(s) {
  fs.writeFileSync(file + '.tmp', s, { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}

export const tgConfigured = () => !!(config.tgApiId && config.tgApiHash);
export const tgLoggedIn = () => !!readSession();

function makeClient(session) {
  const c = new TelegramClient(new StringSession(session), config.tgApiId, config.tgApiHash, {
    connectionRetries: 3, deviceModel: 'Mirik', appVersion: '1.0', systemVersion: 'server',
  });
  c.setLogLevel('error');
  return c;
}

// ---------- вход ----------
let pending = null; // { client, phone, hash }

export async function startLogin(phone) {
  if (!tgConfigured()) throw new Error('Не заданы TG_API_ID и TG_API_HASH (my.telegram.org → API development tools)');
  await pending?.client.disconnect().catch(() => {});
  const client = makeClient('');
  await client.connect();
  const { phoneCodeHash } = await client.sendCode({ apiId: config.tgApiId, apiHash: config.tgApiHash }, phone);
  pending = { client, phone, hash: phoneCodeHash };
}

async function finish(client) {
  saveSession(client.session.save());
  await client.disconnect().catch(() => {});
  pending = null;
  const me = await withClient((c) => c.getMe());
  return [me.firstName, me.lastName].filter(Boolean).join(' ') + (me.username ? ` (@${me.username})` : '');
}

// → { needPassword: true } или { name }
export async function submitCode(code) {
  if (!pending) throw new Error('Сначала /tg_login +номер');
  try {
    await pending.client.invoke(new Api.auth.SignIn({ phoneNumber: pending.phone, phoneCodeHash: pending.hash, phoneCode: code }));
  } catch (e) {
    if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') return { needPassword: true };
    throw e;
  }
  return { name: await finish(pending.client) };
}

export async function submitPassword(password) {
  if (!pending) throw new Error('Сначала /tg_login +номер');
  const pwd = await pending.client.invoke(new Api.account.GetPassword());
  await pending.client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(pwd, password) }));
  return { name: await finish(pending.client) };
}

export async function logout() {
  await pending?.client.disconnect().catch(() => {});
  pending = null;
  if (readSession()) {
    // завершаем сессию и на стороне Telegram, чтобы она пропала из «Устройств»
    await withClient((c) => c.invoke(new Api.auth.LogOut())).catch(() => {});
  }
  closeClient();
  fs.rmSync(file, { force: true });
}

// ---------- клиент: подключаемся по требованию, отключаемся после простоя ----------
let client = null, idle = null;

function closeClient() {
  clearTimeout(idle);
  client?.disconnect().catch(() => {});
  client = null;
}

async function withClient(fn) {
  const session = readSession();
  if (!session) throw new Error('Аккаунт Telegram не подключён — владелец входит командой /tg_login');
  if (!client) {
    client = makeClient(session);
    await client.connect();
  }
  clearTimeout(idle);
  idle = setTimeout(closeClient, IDLE_MS);
  try { return await fn(client); } catch (e) {
    if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|USER_DEACTIVATED/.test(e.errorMessage || e.message)) {
      closeClient();
      fs.rmSync(file, { force: true });
      throw new Error('Сессия Telegram отозвана — нужно заново войти: /tg_login');
    }
    throw e;
  }
}

// ---------- чтение ----------
const when = (d) => new Date(d * 1000).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const nameOf = (e) => (!e ? '?' : e.title || [e.firstName, e.lastName].filter(Boolean).join(' ') || (e.username ? '@' + e.username : String(e.id)));
const kindOf = (d) => (d.isUser ? (d.entity?.bot ? 'бот' : 'личка') : d.isChannel && !d.isGroup ? 'канал' : 'группа');

let dialogsCache = { t: 0, list: [] };
async function dialogs(c) {
  if (Date.now() - dialogsCache.t > 5 * 60_000) dialogsCache = { t: Date.now(), list: await c.getDialogs({ limit: 400 }) };
  return dialogsCache.list.filter((d) => !BLOCKED.has(String(d.id)));
}

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();

export async function findChats(query) {
  return withClient(async (c) => {
    const q = norm(query);
    const list = await dialogs(c);
    const hits = q ? list.filter((d) => norm(nameOf(d.entity)).includes(q) || norm(d.entity?.username) === q.replace(/^@/, '')) : list.slice(0, 30);
    return hits.slice(0, 30).map((d) => ({ id: String(d.id), name: nameOf(d.entity), username: d.entity?.username || null, kind: kindOf(d), unread: d.unreadCount }));
  });
}

// chat: id из tg_find_chat, @username, t.me-ссылка или имя
async function resolve(c, chat) {
  const s = String(chat || '').trim().replace(/^https?:\/\/t\.me\//, '@').replace(/\/.*$/, '');
  if (!s) throw new Error('Не указан чат');
  const list = await dialogs(c);
  const byId = list.find((d) => String(d.id) === s);
  if (byId) return byId.entity;
  if (s.startsWith('@')) {
    const u = norm(s.slice(1));
    const d = list.find((x) => norm(x.entity?.username) === u);
    if (d) return d.entity;
    const e = await c.getEntity(s);
    if (BLOCKED.has(String(e.id))) throw new Error('Этот чат читать нельзя');
    return e;
  }
  const q = norm(s);
  const exact = list.filter((d) => norm(nameOf(d.entity)) === q);
  const hits = exact.length ? exact : list.filter((d) => norm(nameOf(d.entity)).includes(q));
  if (hits.length === 1) return hits[0].entity;
  if (!hits.length) throw new Error(`Чат «${chat}» не найден — поищи через tg_find_chat`);
  throw new Error(`Под «${chat}» подходит несколько чатов — уточни id:\n` + hits.slice(0, 15).map((d) => `${d.id} — ${nameOf(d.entity)} (${kindOf(d)})`).join('\n'));
}

function media(m) {
  if (!m.media) return '';
  if (m.photo) return '[фото]';
  if (m.voice) return '[голосовое]';
  if (m.videoNote) return '[кружок]';
  if (m.video) return '[видео]';
  if (m.sticker) return '[стикер]';
  if (m.document) return `[файл ${m.file?.name || ''}]`.replace(' ]', ']');
  if (m.poll) return `[опрос: ${m.poll.poll?.question?.text || m.poll.poll?.question || ''}]`;
  return '[вложение]';
}

// all — вся история без лимита (для tg_study_chat: целиком в модель она не идёт, только по частям)
export async function readChat(chat, { limit = 100, days, search, all } = {}) {
  return withClient(async (c) => {
    const entity = await resolve(c, chat);
    const max = all ? undefined : Math.min(Math.max(Number(limit) || 100, 1), 500);
    const since = days ? Date.now() / 1000 - Number(days) * 86400 : 0;
    const msgs = [];
    for await (const m of c.iterMessages(entity, { limit: max, search: search || undefined })) {
      if (since && m.date < since) break;
      msgs.push(m);
    }
    const lines = msgs.reverse().map((m) => {
      if (m.action) return `[${when(m.date)}] · служебное: ${m.action.className.replace('MessageAction', '')}`;
      const who = m.out ? 'Я (владелец)' : nameOf(m.sender);
      const reply = m.replyTo?.replyToMsgId ? ` ↩${m.replyTo.replyToMsgId}` : '';
      const fwd = m.fwdFrom ? ' [переслано]' : '';
      return `[${when(m.date)}] #${m.id}${reply} ${who}${fwd}: ${[media(m), m.message].filter(Boolean).join(' ')}`;
    });
    return { name: nameOf(entity), count: lines.length, lines, text: lines.join('\n') };
  });
}

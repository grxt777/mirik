// HTTP + WebSocket для игрового офиса.
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { InputFile } from 'grammy';
import { config } from './config.js';
import { store, save } from './store.js';
import { bus, recentLogs } from './bus.js';
import { AGENT_LIST, DEPARTMENTS } from './agents/registry.js';
import { agentState, createTask, runTask, cancelTask, pauseTask, resumeTask, talkToMirik } from './agents/runtime.js';
import { bot, ownerChats, homeChat, sendMedia } from './bot.js';
import { usageReport, watchBalance } from './billing.js';
import { setSecret } from './secrets.js';

const SESSION = crypto.createHash('sha256').update('mirik:' + config.adminPassword + ':' + config.botToken).digest('hex');
const authed = (token) => typeof token === 'string' && token.length === SESSION.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(SESSION));

// Проверка initData из Telegram Mini App
function checkTelegram(initData) {
  if (!config.botToken || !initData) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  if (calc !== hash) return false;
  const user = JSON.parse(params.get('user') || '{}');
  return ownerChats().includes(user.id);
}

const publicTask = (t) => ({ ...t, steps: t.steps.slice(-40) });

function snapshot() {
  return {
    departments: DEPARTMENTS,
    agents: AGENT_LIST.map(({ prompt, tools, ...a }) => ({ ...a, tools, state: agentState[a.id] })),
    tasks: store.tasks.slice(-60).map(publicTask),
    logs: recentLogs(),
    stats: store.stats,
    model: config.model,
  };
}

// Задачи из офиса: файлы/скриншоты/уведомления уходят владельцу в Telegram
function ownerIO(target) {
  const chatId = target || homeChat();
  if (!bot || !chatId) return {};
  return {
    notify: (text) => bot.api.sendMessage(chatId, '📣 ' + text).catch(() => {}),
    sendFile: (full, caption) => sendMedia(bot.api, chatId, full, caption),
    sendPhoto: (buf, caption) => bot.api.sendPhoto(chatId, new InputFile(buf, 'screen.jpg'), { caption }),
  };
}

export function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  // no-cache: браузер и Telegram каждый раз сверяются с сервером, и обновления интерфейса видны сразу
  app.use(express.static(path.resolve('public'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

  app.get('/health', (_, res) => res.send('ok'));

  app.post('/api/login', (req, res) => {
    const { password, initData } = req.body || {};
    if (password === config.adminPassword || checkTelegram(initData)) return res.json({ token: SESSION });
    res.status(401).json({ error: 'Неверный пароль' });
  });

  // Канал с Саней: отдельный токен, админская сессия ему не нужна.
  const linkAuthed = (req) => {
    const got = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
    const want = Buffer.from(config.linkToken);
    return !!config.linkToken && got.length === want.length && crypto.timingSafeEqual(got, want);
  };

  // Саня передаёт доступы (например, логин/пароль e-class при /eclass_login). Значения в LLM не попадают:
  // агенты вводят их в формы через browser_fill_secret по имени.
  app.post('/link/secrets', (req, res) => {
    if (!linkAuthed(req)) return res.status(401).json({ error: 'auth' });
    const secrets = req.body?.secrets || {};
    const names = Object.keys(secrets).filter((k) => /^[a-z0-9_]{1,40}$/.test(k) && typeof secrets[k] === 'string' && secrets[k]);
    if (!names.length) return res.status(400).json({ error: 'нет секретов' });
    for (const k of names) setSecret(k, secrets[k]);
    const from = String(req.body?.from || 'Саня').slice(0, 40);
    ownerIO(ownerChats()[0]).notify?.(`🔐 ${from} передал доступ: ${names.join(', ')}. Боря сможет заходить на сайт сам.`);
    res.json({ ok: true, saved: names });
  });

  // Саня присылает задания Мирику
  app.post('/link/ask', async (req, res) => {
    if (!linkAuthed(req)) return res.status(401).json({ error: 'auth' });
    const text = String(req.body?.text || '').trim();
    const from = String(req.body?.from || 'Саня').slice(0, 40);
    if (!text) return res.status(400).json({ error: 'Пустое задание' });
    // Саня говорит, из какого чата пришла просьба: туда и отвечаем (в группу — значит в группу)
    const target = Number.isInteger(req.body?.chat_id) ? req.body.chat_id : undefined;
    const io = ownerIO(target);
    const job = talkToMirik('sanya', { text: `[${from}]: ${text}`, source: 'sanya' }, { ...io, fromSanya: true });
    // держим запрос до 50 с; дольше — Мирик доделает и отчитается владельцу в Telegram сам
    const late = Symbol('late');
    try {
      const r = await Promise.race([job, new Promise((ok) => setTimeout(() => ok(late), 50_000))]);
      if (r !== late) return res.json({ reply: r.result });
      res.json({ pending: true });
      job.then(({ result }) => io.notify?.(`🤝 Поручение от ${from}: «${text.slice(0, 200)}»\n\n${result.slice(0, 3500)}`))
        .catch((e) => io.notify?.(`⚠️ Поручение от ${from} не выполнено: ${e.message}`));
    } catch (e) {
      res.status(503).json({ error: e.message });
    }
  });

  app.use('/api', (req, res, next) => (authed(req.headers['x-token']) ? next() : res.status(401).json({ error: 'auth' })));

  app.get('/api/state', (_, res) => res.json(snapshot()));

  app.post('/api/tasks', (req, res) => {
    const { text, agent = 'mirik' } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'Пустое задание' });
    if (!AGENT_LIST.some((a) => a.id === agent)) return res.status(400).json({ error: 'Нет такого агента' });
    const io = ownerIO();
    const notifyDone = (task, result) => io.notify?.(`✅ Задание из офиса выполнено:\n«${task.text.slice(0, 100)}»\n\n${result.slice(0, 3500)}`);
    // Мирику — с памятью диалога офиса, сотрудникам — напрямую
    if (agent === 'mirik') {
      let created;
      talkToMirik('panel', { text: text.trim(), source: 'panel', onTask: (t) => (created = t) }, io)
        .then(({ task, result }) => notifyDone(task, result))
        .catch(() => {});
      return res.json({ task: publicTask(created) });
    }
    const task = createTask({ text: text.trim(), agent, source: 'panel' });
    runTask(task, io).then((result) => notifyDone(task, result)).catch(() => {});
    res.json({ task: publicTask(task) });
  });

  app.get('/api/usage', async (_, res) => res.json(await usageReport()));

  app.post('/api/tasks/:id/cancel', (req, res) => res.json({ ok: cancelTask(req.params.id) }));
  app.post('/api/tasks/:id/pause', (req, res) => res.json({ ok: pauseTask(req.params.id) }));
  app.post('/api/tasks/:id/resume', (req, res) => res.json({ ok: resumeTask(req.params.id) }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const token = new URL(req.url, 'http://x').searchParams.get('token');
    if (!authed(token)) return ws.close(4001, 'auth');
    ws.send(JSON.stringify({ type: 'init', ...snapshot() }));
  });
  bus.on('event', (e) => {
    const msg = JSON.stringify(e.type === 'task' ? { ...e, task: publicTask(e.task) } : e);
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  });

  watchBalance((text) => ownerIO().notify?.(text) ?? Promise.resolve());

  server.listen(config.port, () => console.log(`[office] http://localhost:${config.port}`));
}

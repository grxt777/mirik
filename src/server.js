// HTTP + WebSocket для игрового офиса.
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { InputFile } from 'grammy';
import { config } from './config.js';
import { store } from './store.js';
import { bus, recentLogs } from './bus.js';
import { AGENT_LIST } from './agents/registry.js';
import { agentState, createTask, runTask, cancelTask } from './agents/runtime.js';
import { bot, ownerChats } from './bot.js';

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
    agents: AGENT_LIST.map(({ prompt, tools, ...a }) => ({ ...a, tools, state: agentState[a.id] })),
    tasks: store.tasks.slice(-40).map(publicTask),
    logs: recentLogs(),
    stats: store.stats,
    model: config.model,
  };
}

// Задачи из офиса: файлы/скриншоты/уведомления уходят владельцу в Telegram
function ownerIO() {
  const chatId = ownerChats()[0];
  if (!bot || !chatId) return {};
  return {
    notify: (text) => bot.api.sendMessage(chatId, '📣 ' + text).catch(() => {}),
    sendFile: (full, caption) => bot.api.sendDocument(chatId, new InputFile(full), { caption }),
    sendPhoto: (buf, caption) => bot.api.sendPhoto(chatId, new InputFile(buf, 'screen.jpg'), { caption }),
  };
}

export function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.resolve('public')));

  app.get('/health', (_, res) => res.send('ok'));

  app.post('/api/login', (req, res) => {
    const { password, initData } = req.body || {};
    if (password === config.adminPassword || checkTelegram(initData)) return res.json({ token: SESSION });
    res.status(401).json({ error: 'Неверный пароль' });
  });

  app.use('/api', (req, res, next) => (authed(req.headers['x-token']) ? next() : res.status(401).json({ error: 'auth' })));

  app.get('/api/state', (_, res) => res.json(snapshot()));

  app.post('/api/tasks', (req, res) => {
    const { text, agent = 'mirik' } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'Пустое задание' });
    if (!AGENT_LIST.some((a) => a.id === agent)) return res.status(400).json({ error: 'Нет такого агента' });
    const task = createTask({ text: text.trim(), agent, source: 'panel' });
    const io = ownerIO();
    runTask(task, io)
      .then((result) => io.notify?.(`✅ Задание из офиса выполнено:\n«${task.text.slice(0, 100)}»\n\n${result.slice(0, 3500)}`))
      .catch(() => {});
    res.json({ task: publicTask(task) });
  });

  app.post('/api/tasks/:id/cancel', (req, res) => res.json({ ok: cancelTask(req.params.id) }));

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

  server.listen(config.port, () => console.log(`[office] http://localhost:${config.port}`));
}

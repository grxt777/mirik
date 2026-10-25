// Простое JSON-хранилище на диске (на fly.io лежит на volume /data).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const file = path.join(config.dataDir, 'db.json');
fs.mkdirSync(config.workspaceDir, { recursive: true });

const defaults = {
  tasks: [],      // { id, text, agent, status, source, chatId, createdAt, finishedAt, result, steps[] }
  memory: [],     // долгосрочные факты { id, text, createdAt }
  chats: {},      // chatId -> история диалога с Мириком
  owners: [],     // telegram user id
  stats: { tokens: 0, cost: 0, tasksDone: 0 },
};

let db = structuredClone(defaults);
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
} catch {}

let timer = null;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.writeFileSync(file + '.tmp', JSON.stringify(db, null, 1), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }, 300);
}

export const store = db;

export function addMemory(text) {
  const item = { id: Date.now().toString(36), text, createdAt: Date.now() };
  db.memory.push(item);
  if (db.memory.length > 300) db.memory.shift();
  save();
  return item;
}

export function chatHistory(chatId) {
  return (db.chats[chatId] ||= []);
}

export function pushHistory(chatId, msg, limit = 60) {
  const h = chatHistory(chatId);
  h.push(msg);
  if (h.length > limit) h.splice(0, h.length - limit);
  save();
}

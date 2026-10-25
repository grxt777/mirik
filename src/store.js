// Простое JSON-хранилище на диске (на fly.io лежит на volume /data).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const file = path.join(config.dataDir, 'db.json');
fs.mkdirSync(config.workspaceDir, { recursive: true });

const defaults = {
  tasks: [],      // { id, text, agent, status, source, chatId, createdAt, finishedAt, result, steps[] }
  owners: [],     // telegram user id
  stats: { tokens: 0, cost: 0, tasksDone: 0 },
};

let db = structuredClone(defaults);
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
} catch {}

let timer = null;
function flush() {
  clearTimeout(timer);
  timer = null;
  fs.writeFileSync(file + '.tmp', JSON.stringify(db, null, 1), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}
// при остановке/деплое дописываем последние изменения (память — в SQLite, она и так надёжна)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { if (timer) flush(); } finally { process.exit(0); } });

export const store = db;


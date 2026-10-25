// Секреты (логины/пароли для сайтов) — отдельный файл с правами 600, вне досягаемости кода агентов.
// В LLM значения не попадают: агенты вводят их в формы по имени через browser_fill_secret.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { store, save } from './store.js';

const file = path.join(config.dataDir, 'secrets.json');
let secrets = {};
try { secrets = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}

function persist() {
  fs.writeFileSync(file + '.tmp', JSON.stringify(secrets), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
  fs.chmodSync(file, 0o600);
}

// переезд из db.json (раньше секреты лежали там)
if (store.secrets) {
  if (Object.keys(store.secrets).length) { secrets = { ...store.secrets, ...secrets }; persist(); }
  delete store.secrets;
  save();
}

export const getSecret = (name) => secrets[name];
export const secretNames = () => Object.keys(secrets);
export const secretValues = () => Object.values(secrets);
export function setSecret(name, value) { secrets[name] = value; persist(); }
export function deleteSecret(name) { delete secrets[name]; persist(); }

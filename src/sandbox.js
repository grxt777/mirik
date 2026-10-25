// Изоляция кода агентов: на сервере (Linux, root) всё, что пишут и запускают агенты, идёт от
// непривилегированного пользователя sandbox. Ему видна только рабочая папка; db.json и secrets.json — нет,
// переменных окружения с ключами у него тоже нет. Локально (macOS, не root) изоляция выключена.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from './config.js';

function detect() {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) return null;
  try {
    return { uid: Number(execFileSync('id', ['-u', 'sandbox']).toString().trim()), gid: Number(execFileSync('id', ['-g', 'sandbox']).toString().trim()) };
  } catch {
    console.warn('[sandbox] пользователя sandbox нет — код агентов идёт без изоляции');
    return null;
  }
}

export const sandbox = detect();
export const SANDBOX_HOME = path.join(config.workspaceDir, '.home');

// Чистое окружение для кода агентов: никаких токенов и ключей
export function sandboxEnv() {
  return {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: SANDBOX_HOME,
    LANG: 'C.UTF-8',
    PYTHONUSERBASE: path.join(SANDBOX_HOME, '.local'),
    PIP_BREAK_SYSTEM_PACKAGES: '1',
    npm_config_cache: path.join(SANDBOX_HOME, '.npm'),
  };
}

// Опции spawn для запуска «от имени агентов»
export const sandboxSpawn = () => (sandbox ? { uid: sandbox.uid, gid: sandbox.gid, env: sandboxEnv() } : { env: sandboxEnv() });

fs.mkdirSync(SANDBOX_HOME, { recursive: true });
if (sandbox) {
  // файлы, которые пишет сам Мирик (скачивания, решения), должны быть доступны агентам на запись
  process.umask(0o002);
  const ws = config.workspaceDir;
  execFileSync('chown', ['-R', `root:${sandbox.gid}`, ws]);
  execFileSync('chmod', ['-R', 'g+rwX', ws]);
  execFileSync('find', [ws, '-type', 'd', '-exec', 'chmod', 'g+s', '{}', '+']);
  execFileSync('chown', ['-R', `${sandbox.uid}:${sandbox.gid}`, SANDBOX_HOME]);
  // в /data агенту можно только пройти до workspace, но не читать и не листать
  fs.chmodSync(config.dataDir, 0o711);
  for (const f of ['db.json', 'secrets.json']) {
    try { fs.chmodSync(path.join(config.dataDir, f), 0o600); } catch {}
  }
  console.log(`[sandbox] код агентов изолирован: uid ${sandbox.uid}`);
}

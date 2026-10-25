// Рабочая папка агентов + выполнение кода.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import { config } from '../config.js';
import { sandboxSpawn } from '../sandbox.js';

const inside = (root, p) => { const rel = path.relative(root, p); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };

// Путь строго внутри рабочей папки — с учётом символических ссылок: агент может создать ссылку
// на чужой файл, а читает/пишет её уже сам Мирик (с правами root).
export function wsPath(p = '.') {
  const root = fsSync.realpathSync(config.workspaceDir);
  const full = path.resolve(root, String(p).replace(/^\/+/, ''));
  if (!inside(root, full)) throw new Error('Путь вне рабочей папки');
  let probe = full;
  while (!fsSync.existsSync(probe) && probe !== root) probe = path.dirname(probe);
  if (!inside(root, fsSync.realpathSync(probe))) throw new Error('Путь ведёт вне рабочей папки');
  let st = null;
  try { st = fsSync.lstatSync(full); } catch {}
  if (st?.isSymbolicLink()) {
    let real;
    try { real = fsSync.realpathSync(full); } catch { throw new Error('Битая ссылка — не трогаю'); }
    if (!inside(root, real)) throw new Error('Ссылка ведёт вне рабочей папки');
  }
  return full;
}

function exec(cmd, args, input, timeoutMs = 60000) {
  return new Promise((resolve) => {
    // от пользователя sandbox и с чистым окружением: ни секретов, ни ключей, ни db.json
    const child = spawn(cmd, args, { cwd: config.workspaceDir, ...sandboxSpawn() });
    let out = '';
    const add = (d) => { if (out.length < 20000) out += d; };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => { child.kill('SIGKILL'); out += '\n[таймаут]'; }, timeoutMs);
    child.on('error', (e) => { out += String(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve(`exit=${code}\n${out.length > 6000 ? out.slice(0, 2500) + '\n…[середина вывода пропущена]…\n' + out.slice(-3000) : out}`); });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export const fileTools = [
  {
    name: 'run_code',
    description: 'Выполнить код (python, javascript или bash) в рабочей папке. Возвращает stdout/stderr. Таймаут 60с. Для установки пакетов: bash "pip install x" или "npm i x".',
    parameters: {
      type: 'object',
      properties: { language: { type: 'string', enum: ['python', 'javascript', 'bash'] }, code: { type: 'string' } },
      required: ['language', 'code'],
    },
    async run({ language, code }) {
      if (language === 'python') return exec('python3', ['-'], code);
      if (language === 'javascript') return exec('node', ['--input-type=module', '-'], code);
      return exec('bash', ['-s'], code, 120000);
    },
  },
  {
    name: 'write_file',
    description: 'Записать текстовый файл в рабочую папку (создаёт папки).',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    async run({ path: p, content }) {
      const full = wsPath(p);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content);
      return `Записано ${content.length} символов в ${p}`;
    },
  },
  {
    name: 'read_file',
    description: 'Прочитать текстовый файл из рабочей папки.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    async run({ path: p }) {
      const text = await fs.readFile(wsPath(p), 'utf8');
      return text.length > 20000 ? text.slice(0, 20000) + '\n…[обрезано]' : text;
    },
  },
  {
    name: 'list_files',
    description: 'Список файлов в папке рабочей директории.',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
    async run({ path: p = '.' }) {
      const entries = await fs.readdir(wsPath(p), { withFileTypes: true });
      return entries.map((e) => (e.isDirectory() ? e.name + '/' : e.name)).join('\n') || '(пусто)';
    },
  },
  {
    name: 'send_file',
    description: 'Отправить файл из рабочей папки пользователю в Telegram.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, caption: { type: 'string' } }, required: ['path'] },
    async run({ path: p, caption }, ctx) {
      const full = wsPath(p);
      await fs.access(full);
      // по поручению Мирика файлы отдаёт он сам — иначе в чат придёт несколько копий
      if (ctx.depth > 0) return `Не отправляю: итоговый файл отправит Мирик. Укажи в отчёте путь ${p}.`;
      await ctx.sendFile?.(full, caption);
      return 'Файл отправлен пользователю';
    },
  },
];

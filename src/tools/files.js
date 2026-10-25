// Рабочая папка агентов + выполнение кода.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.js';

export function wsPath(p = '.') {
  const full = path.resolve(config.workspaceDir, p.replace(/^\/+/, ''));
  if (!full.startsWith(config.workspaceDir)) throw new Error('Путь вне рабочей папки');
  return full;
}

function exec(cmd, args, input, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: config.workspaceDir, env: { ...process.env, OPENROUTER_API_KEY: '', TELEGRAM_BOT_TOKEN: '', ADMIN_PASSWORD: '' } });
    let out = '';
    const add = (d) => { if (out.length < 20000) out += d; };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => { child.kill('SIGKILL'); out += '\n[таймаут]'; }, timeoutMs);
    child.on('error', (e) => { out += String(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve(`exit=${code}\n${out.slice(0, 12000)}`); });
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

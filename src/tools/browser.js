// Браузерный агент: Playwright Chromium. Один браузер, одна вкладка на задачу.
import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from '../config.js';
import { store } from '../store.js';
import { htmlToText } from './web.js';

let browserPromise = null;
const pages = new Map(); // taskId -> page

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = import('playwright').then(({ chromium }) =>
      chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    );
    browserPromise.catch(() => (browserPromise = null));
  }
  return browserPromise;
}

async function getPage(ctx) {
  let page = pages.get(ctx.taskId);
  if (page && !page.isClosed()) return page;
  const browser = await getBrowser();
  const context = await browser.newContext({ acceptDownloads: true, locale: 'ru-RU', viewport: { width: 1280, height: 860 } });
  page = await context.newPage();
  page.on('download', async (d) => {
    const dir = path.join(config.workspaceDir, 'downloads');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, d.suggestedFilename());
    await d.saveAs(file);
    ctx.notify?.(`📥 Скачан файл: downloads/${d.suggestedFilename()}`);
  });
  pages.set(ctx.taskId, page);
  return page;
}

export async function closeTaskPage(taskId) {
  const page = pages.get(taskId);
  pages.delete(taskId);
  if (page) await page.context().close().catch(() => {});
}

// Помечаем интерактивные элементы номерами, чтобы модель кликала по [id].
async function snapshot(page) {
  const elements = await page.evaluate(() => {
    const sel = 'a,button,input,select,textarea,[role=button],[role=link],[onclick],label';
    const out = [];
    let i = 0;
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || getComputedStyle(el).visibility === 'hidden') continue;
      el.setAttribute('data-mirik', String(++i));
      const label = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.name || el.title || '').trim().slice(0, 80);
      const extra = el.tagName === 'INPUT' ? ` type=${el.type}` : el.tagName === 'A' ? ` href=${el.getAttribute('href') || ''}`.slice(0, 120) : '';
      out.push(`[${i}] ${el.tagName.toLowerCase()}${extra} "${label}"`);
      if (i >= 150) break;
    }
    return out;
  });
  const text = htmlToText(await page.content()).slice(0, 8000);
  return `URL: ${page.url()}\nЗаголовок: ${await page.title()}\n\nТЕКСТ:\n${text}\n\nЭЛЕМЕНТЫ:\n${elements.join('\n')}`;
}

const el = (page, id) => page.locator(`[data-mirik="${id}"]`).first();

export const browserTools = [
  {
    name: 'browser_open',
    description: 'Открыть URL в браузере. Возвращает текст страницы и пронумерованные элементы [id].',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    async run({ url }, ctx) {
      const page = await getPage(ctx);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(1200);
      return snapshot(page);
    },
  },
  {
    name: 'browser_read',
    description: 'Прочитать текущую страницу заново (текст + элементы [id]).',
    parameters: { type: 'object', properties: {} },
    async run(_, ctx) {
      return snapshot(await getPage(ctx));
    },
  },
  {
    name: 'browser_click',
    description: 'Кликнуть по элементу с номером id из последнего снимка страницы.',
    parameters: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    async run({ id }, ctx) {
      const page = await getPage(ctx);
      await el(page, id).click({ timeout: 15000 });
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1500);
      return snapshot(page);
    },
  },
  {
    name: 'browser_type',
    description: 'Ввести текст в поле id. submit=true нажмёт Enter.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'integer' }, text: { type: 'string' }, submit: { type: 'boolean' } },
      required: ['id', 'text'],
    },
    async run({ id, text, submit }, ctx) {
      const page = await getPage(ctx);
      await el(page, id).fill(text, { timeout: 15000 });
      if (submit) {
        await el(page, id).press('Enter');
        await page.waitForTimeout(2000);
        return snapshot(page);
      }
      return 'Введено';
    },
  },
  {
    name: 'browser_fill_secret',
    description: 'Ввести в поле id сохранённый секрет (логин/пароль) по имени. Значение секрета ты не видишь. Список имён: list_secrets.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'integer' }, secret: { type: 'string' }, submit: { type: 'boolean' } },
      required: ['id', 'secret'],
    },
    async run({ id, secret, submit }, ctx) {
      const value = store.secrets[secret];
      if (value == null) return `Секрета "${secret}" нет. Попроси пользователя: /secret ${secret} значение`;
      const page = await getPage(ctx);
      await el(page, id).fill(value, { timeout: 15000 });
      if (submit) {
        await el(page, id).press('Enter');
        await page.waitForTimeout(2500);
        return snapshot(page);
      }
      return 'Секрет введён';
    },
  },
  {
    name: 'list_secrets',
    description: 'Список имён сохранённых секретов (без значений).',
    parameters: { type: 'object', properties: {} },
    async run() {
      const names = Object.keys(store.secrets);
      return names.length ? names.join(', ') : 'Секретов нет';
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Сделать скриншот текущей страницы и отправить пользователю.',
    parameters: { type: 'object', properties: { caption: { type: 'string' } } },
    async run({ caption }, ctx) {
      const page = await getPage(ctx);
      const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
      await ctx.sendPhoto?.(buf, caption);
      return 'Скриншот отправлен пользователю';
    },
  },
  {
    name: 'browser_save_page',
    description: 'Сохранить текст текущей страницы в файл рабочей папки (например, условие задания).',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    async run({ path: p }, ctx) {
      const page = await getPage(ctx);
      const full = path.resolve(config.workspaceDir, p);
      if (!full.startsWith(config.workspaceDir)) throw new Error('Путь вне рабочей папки');
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, htmlToText(await page.content()));
      return `Сохранено в ${p}`;
    },
  },
];

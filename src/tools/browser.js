// Браузерный агент: Playwright Chromium. Один браузер, одна вкладка на задачу.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import { config } from '../config.js';
import { getSecret, secretNames } from '../secrets.js';
import { wsPath } from './files.js';
import { htmlToText } from './web.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
let browserPromise = null;
const pages = new Map(); // taskId -> page

async function getBrowser() {
  // браузер мог упасть (нехватка памяти, краш вкладки) — тогда поднимаем новый, а не ломаемся навсегда
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (!b || !b.isConnected()) browserPromise = null;
  }
  if (!browserPromise) {
    browserPromise = import('playwright').then(async ({ chromium }) => {
      const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
      b.on('disconnected', () => { browserPromise = null; for (const id of [...pages.keys()]) pages.delete(id); });
      return b;
    });
    browserPromise.catch(() => (browserPromise = null));
  }
  return browserPromise;
}

async function getPage(ctx) {
  let page = pages.get(ctx.taskId);
  if (page && !page.isClosed() && page.context().browser()?.isConnected()) return page;
  const browser = await getBrowser();
  const context = await browser.newContext({ acceptDownloads: true, locale: 'ru-RU', userAgent: UA, viewport: { width: 1280, height: 860 } });
  page = await context.newPage();
  page.on('download', async (d) => {
    await fs.mkdir(wsPath('downloads'), { recursive: true });
    const file = wsPath(path.join('downloads', path.basename(d.suggestedFilename())));
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
      const label = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.name || el.title || '').trim().slice(0, 60);
      const extra = el.tagName === 'INPUT' ? ` type=${el.type}` : el.tagName === 'A' ? ` href=${el.getAttribute('href') || ''}`.slice(0, 120) : '';
      out.push(`[${i}] ${el.tagName.toLowerCase()}${extra} "${label}"`);
      if (i >= 80) break;
    }
    return out;
  });
  const text = htmlToText(await page.content()).slice(0, 3500);
  return `URL: ${page.url()}\nЗаголовок: ${await page.title()}\n\nТЕКСТ:\n${text}\n\nЭЛЕМЕНТЫ:\n${elements.join('\n')}`;
}

const el = (page, id) => page.locator(`[data-mirik="${id}"]`).first();

// Отдельная страница под рендер роликов/обложек: точный размер кадра, без масштабирования
export async function newRenderPage(width, height) {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  return context.newPage();
}

// PDF из HTML-файла рабочей папки (питч-деки: страница 1920x1080; документы: A4)
export async function pdfFromFile(htmlFull, out, format = 'a4') {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(htmlFull).href, { waitUntil: 'networkidle', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    const size = format === 'slides' ? { width: '1920px', height: '1080px', margin: { top: 0, bottom: 0, left: 0, right: 0 } } : { format: 'A4', margin: { top: '18mm', bottom: '18mm', left: '20mm', right: '16mm' } };
    await page.pdf({ path: out, printBackground: true, preferCSSPageSize: false, ...size });
  } finally {
    await page.close();
  }
}

// PDF из HTML (для make_document) — тем же Chromium
export async function htmlToPdf(html, file) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path: file, format: 'A4', margin: { top: '18mm', bottom: '18mm', left: '20mm', right: '16mm' }, printBackground: true });
  } finally {
    await page.close();
  }
}

function fileNameFrom(res, url) {
  const cd = res.headers()['content-disposition'] || '';
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  const plain = cd.match(/filename="?([^";]+)"?/i);
  let name = star ? decodeURIComponent(star[1].replace(/"/g, '')) : plain ? plain[1] : '';
  if (!name) { try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch {} }
  name = (name || 'file').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  const type = res.headers()['content-type'] || '';
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += type.includes('pdf') ? '.pdf' : type.includes('word') ? '.docx' : '';
  return name;
}

export const browserTools = [
  {
    name: 'browser_open',
    description: 'Открыть URL в браузере. Возвращает текст страницы и пронумерованные элементы [id].',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    async run({ url }, ctx) {
      const page = await getPage(ctx);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      } catch (e) {
        if (/Download is starting/i.test(e.message)) return 'По этой ссылке скачивается файл — он сохранится в downloads/. Проверь list_files("downloads").';
        throw e;
      }
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
      const value = getSecret(secret);
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
    name: 'browser_download',
    description: 'Скачать файл (PDF, DOCX и т.п.) со страницы с сохранением входа: по номеру ссылки id из снимка или по url. Файл ляжет в downloads/.',
    parameters: { type: 'object', properties: { id: { type: 'integer' }, url: { type: 'string' } } },
    async run({ id, url }, ctx) {
      const page = await getPage(ctx);
      if (id != null) url = await el(page, id).evaluate((a) => a.href || a.getAttribute('href') || a.closest('a')?.href || '');
      if (!url) return 'Нет ссылки: укажи id ссылки или url';
      url = new URL(url, page.url()).href;
      const res = await page.context().request.get(url, { timeout: 60000 });
      if (!res.ok()) return `Не скачалось: HTTP ${res.status()}`;
      const type = res.headers()['content-type'] || '';
      if (type.includes('text/html')) return 'По ссылке открывается страница, а не файл. Открой её browser_open и найди ссылку на сам файл.';
      const name = fileNameFrom(res, url);
      await fs.mkdir(wsPath('downloads'), { recursive: true });
      const body = await res.body();
      await fs.writeFile(wsPath(path.join('downloads', name)), body);
      return `Скачано: downloads/${name} (${Math.round(body.length / 1024)} КБ, ${type.split(';')[0]})`;
    },
  },
  {
    name: 'list_secrets',
    description: 'Список имён сохранённых секретов (без значений).',
    parameters: { type: 'object', properties: {} },
    async run() {
      const names = secretNames();
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
      const full = wsPath(p);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, htmlToText(await page.content()));
      return `Сохранено в ${p}`;
    },
  },
];

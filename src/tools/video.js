// Студия Департамента ютуберов: ролики собираются кодом — страница рисует кадр на момент t,
// Chromium снимает кадры, ffmpeg кодирует MP4 (+ озвучка/музыка). Плюс обложки, медиа и поиск по YouTube.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { wsPath } from './files.js';
import { newRenderPage } from './browser.js';
import { sandboxSpawn } from '../sandbox.js';
import { bus } from '../bus.js';
import { config } from '../config.js';

const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../templates/youtube/scenes.html');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FORMATS = { shorts: [1080, 1920], video: [1920, 1080], square: [1080, 1080] };
const MAX_SECONDS = 180;

// один рендер за раз: Chromium + ffmpeg на 1 ГБ памяти — тяжело
let chain = Promise.resolve();
const exclusive = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

const isUrl = (s) => /^https?:\/\//i.test(String(s || ''));
// путь из раскадровки: от корня рабочей папки или от папки проекта
async function resolveLocal(p, projectDir) {
  for (const cand of [p, path.join(path.relative(config.workspaceDir, projectDir), p)]) {
    try { const full = wsPath(cand); await fs.access(full); return full; } catch {}
  }
  throw new Error(`Файл не найден: ${p}`);
}

async function loadSpec(scenesPath) {
  const specFull = wsPath(scenesPath);
  const projectDir = path.dirname(specFull);
  let spec;
  try {
    spec = JSON.parse((await fs.readFile(specFull, 'utf8')).replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`scenes.json не читается как JSON: ${e.message}. Исправь файл (без комментариев и висячих запятых).`);
  }
  if (!Array.isArray(spec.scenes) || !spec.scenes.length) throw new Error('В scenes.json нет массива scenes');
  const total = spec.scenes.reduce((n, s) => n + Math.max(0.5, Math.min(30, Number(s.duration) || 3)), 0);
  if (total > MAX_SECONDS) throw new Error(`Слишком длинно: ${total.toFixed(1)} с (максимум ${MAX_SECONDS})`);
  for (const s of spec.scenes) if (s.image && !isUrl(s.image)) s.image = pathToFileURL(await resolveLocal(s.image, projectDir)).href;
  const audio = [];
  if (spec.voiceover) audio.push({ file: await resolveLocal(spec.voiceover, projectDir), volume: Number(spec.voiceover_volume) || 1 });
  if (spec.music) audio.push({ file: await resolveLocal(spec.music, projectDir), volume: Number(spec.music_volume) || (spec.voiceover ? 0.18 : 0.6), music: true });
  return { spec, projectDir, audio, total };
}

async function specPage(spec, projectDir) {
  const tpl = await fs.readFile(TEMPLATE, 'utf8');
  const html = tpl.replace('/*__SPEC__*/', `window.__SPEC__ = ${JSON.stringify(spec).replace(/</g, '\\u003c')};`);
  const dir = path.join(projectDir, '.render');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'index.html');
  await fs.writeFile(file, html);
  return pathToFileURL(file).href;
}

// out — итоговый размер файла; render — размер, в котором снимает браузер (финал рисуется в 2/3 и растягивается ffmpeg:
// для плоской графики на телефоне разницы не видно, а сервер без видеокарты работает в 2+ раза быстрее)
function sizeFor(format, quality) {
  const [w, h] = FORMATS[format] || FORMATS.shorts;
  const even = (k) => [Math.round((w * k) / 2) * 2, Math.round((h * k) / 2) * 2];
  if (quality === 'draft') { const d = even(0.5); return { out: d, render: d }; }
  return { out: [w, h], render: quality === 'hd' ? [w, h] : even(2 / 3) };
}

async function openPage(url, width, height) {
  const page = await newRenderPage(width, height);
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  const ok = await page.evaluate(() => typeof window.__seek === 'function');
  if (!ok) { await page.context().close(); throw new Error('На странице нет window.__seek(t) — см. инструкцию по своей вёрстке'); }
  await page.evaluate(() => Promise.race([window.__ready, new Promise((r) => setTimeout(r, 15000))]));
  return page;
}

function ffmpegArgs({ fps, width, height, duration, audio, out }) {
  const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0'];
  for (const a of audio) args.push('-i', a.file);
  if (audio.length) {
    const chains = audio.map((a, i) => {
      const fade = a.music ? `,afade=t=out:st=${Math.max(0, duration - 1.5).toFixed(2)}:d=1.5` : '';
      return `[${i + 1}:a]aresample=44100,volume=${a.volume}${fade}[a${i}]`;
    });
    const mix = audio.length > 1 ? `;${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:duration=longest:normalize=0[aout]` : '';
    args.push('-filter_complex', chains.join(';') + mix, '-map', '0:v', '-map', audio.length > 1 ? '[aout]' : '[a0]', '-c:a', 'aac', '-b:a', '160k');
  }
  args.push('-vf', `scale=${width}:${height}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-r', String(fps), '-t', duration.toFixed(3), '-movflags', '+faststart', out);
  return args;
}

async function renderMp4({ url, width, height, renderSize, fps, duration, audio = [], out, ctx, label }) {
  const page = await openPage(url, ...(renderSize || [width, height]));
  try {
    const broken = await page.evaluate(() => (window.__brokenImages ? window.__brokenImages() : []));
    const dur = Math.min(MAX_SECONDS, Number(duration) || (await page.evaluate(() => window.__duration)) || 10);
    const frames = Math.ceil(dur * fps);
    const ff = spawn(FFMPEG, ffmpegArgs({ fps, width, height, duration: dur, audio, out }), { cwd: config.workspaceDir, ...sandboxSpawn() });
    let err = '';
    ff.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    const done = new Promise((resolve) => ff.on('close', resolve));
    ff.stdin.on('error', () => {});
    let lastPct = -1;
    // кадры напрямую через CDP с быстрым JPEG — заметно легче для сервера без видеокарты
    let cdp = null;
    try { cdp = await page.context().newCDPSession(page); } catch {}
    const shot = async () => {
      if (cdp) {
        try { return Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88, optimizeForSpeed: true })).data, 'base64'); } catch { cdp = null; }
      }
      return page.screenshot({ type: 'jpeg', quality: 88 });
    };
    // наш шаблон описывает кадр целиком в DOM: если DOM не изменился — кадр тот же, снимать заново не нужно
    const dedupe = await page.evaluate(() => !!window.__dedupe);
    let prevSig = null, prevBuf = null, unique = 0;
    for (let i = 0; i < frames; i++) {
      if (ctx?.control?.cancelled) { ff.kill('SIGKILL'); throw new Error('Рендер отменён'); }
      while (ctx?.control?.paused && !ctx.control.cancelled) await new Promise((r) => setTimeout(r, 700)); // пауза задачи — замираем на кадре
      const sig = await page.evaluate((t) => { window.__seek(t); return window.__dedupe ? document.getElementById('stage').innerHTML : null; }, i / fps);
      let buf;
      if (dedupe && sig === prevSig && prevBuf) buf = prevBuf;
      else { buf = await shot(); unique++; prevSig = sig; prevBuf = buf; }
      if (!ff.stdin.write(buf)) await Promise.race([once(ff.stdin, 'drain'), done]);
      const pct = Math.floor((i / frames) * 100);
      if (pct >= lastPct + 5) { lastPct = pct; bus.emit('event', { type: 'render', agent: ctx?.agentId, pct, label }); }
    }
    ff.stdin.end();
    const code = await done;
    bus.emit('event', { type: 'render', agent: ctx?.agentId, pct: 100, label });
    if (code !== 0) throw new Error(`ffmpeg завершился с ошибкой: ${err.trim() || code}`);
    const { size } = await fs.stat(out);
    return { dur, frames, unique, size, broken };
  } finally {
    await page.context().close().catch(() => {});
  }
}

const mb = (n) => (n / 1048576).toFixed(1) + ' МБ';
const rel = (full) => path.relative(config.workspaceDir, full);

export const videoTools = [
  {
    name: 'build_video',
    description: 'Собрать MP4 по раскадровке scenes.json (шаблон с анимациями, субтитрами, переходами, прогресс-баром; озвучка/музыка из полей voiceover/music). quality="draft" — быстрый черновик в половину разрешения.',
    parameters: {
      type: 'object',
      properties: {
        scenes: { type: 'string', description: 'Путь к scenes.json, например projects/yt/myvideo/scenes.json' },
        out: { type: 'string', description: 'Куда сохранить, по умолчанию рядом: video.mp4 (или video_draft.mp4)' },
        quality: { type: 'string', enum: ['final', 'draft', 'hd'], description: 'final — по умолчанию (быстро, отлично для телефона), hd — честный 1080p (в 2+ раза дольше), draft — черновик' },
        fps: { type: 'integer', description: '12–30, по умолчанию 24' },
      },
      required: ['scenes'],
    },
    async run({ scenes, out, quality = 'final', fps }, ctx) {
      return exclusive(async () => {
        const { spec, projectDir, audio, total } = await loadSpec(scenes);
        const { out: [width, height], render: renderSize } = sizeFor(spec.format, quality);
        fps = Math.max(12, Math.min(30, Number(fps) || 24));
        const outFull = wsPath(out || rel(path.join(projectDir, quality === 'draft' ? 'video_draft.mp4' : 'video.mp4')));
        await fs.mkdir(path.dirname(outFull), { recursive: true });
        const url = await specPage(spec, projectDir);
        const t0 = Date.now();
        const r = await renderMp4({ url, width, height, renderSize, fps, duration: total, audio, out: outFull, ctx, label: spec.scenes[0]?.title || 'ролик' });
        return `Готово: ${rel(outFull)} — ${r.dur.toFixed(1)} с, ${width}x${height}, ${fps} fps, ${r.frames} кадров (снято ${r.unique}), ${mb(r.size)}, рендер ${Math.round((Date.now() - t0) / 1000)} с.` +
          (audio.length ? ` Звук: ${audio.map((a) => rel(a.file)).join(' + ')}.` : ' Без звука.') +
          (r.broken.length ? ` ⚠️ Не загрузились картинки: ${r.broken.join(', ')}` : '');
      });
    },
  },
  {
    name: 'render_video',
    description: 'Отрендерить в MP4 свою HTML-страницу (custom.html в рабочей папке) с window.__seek(t), window.__duration и window.__ready.',
    parameters: {
      type: 'object',
      properties: {
        html: { type: 'string' },
        out: { type: 'string' },
        format: { type: 'string', enum: ['shorts', 'video', 'square'] },
        duration: { type: 'number', description: 'Секунды; по умолчанию window.__duration' },
        fps: { type: 'integer' },
        voiceover: { type: 'string', description: 'Путь к голосу (необязательно)' },
        music: { type: 'string', description: 'Путь к музыке (необязательно)' },
      },
      required: ['html', 'out'],
    },
    async run({ html, out, format = 'shorts', duration, fps = 30, voiceover, music }, ctx) {
      return exclusive(async () => {
        const htmlFull = wsPath(html);
        const dir = path.dirname(htmlFull);
        const audio = [];
        if (voiceover) audio.push({ file: await resolveLocal(voiceover, dir), volume: 1 });
        if (music) audio.push({ file: await resolveLocal(music, dir), volume: voiceover ? 0.18 : 0.6, music: true });
        const { out: [width, height] } = sizeFor(format, 'hd');
        const outFull = wsPath(out);
        await fs.mkdir(path.dirname(outFull), { recursive: true });
        const r = await renderMp4({ url: pathToFileURL(htmlFull).href, width, height, fps: Math.max(12, Math.min(30, fps)), duration, audio, out: outFull, ctx, label: path.basename(dir) });
        return `Готово: ${rel(outFull)} — ${r.dur.toFixed(1)} с, ${width}x${height}, ${mb(r.size)}`;
      });
    },
  },
  {
    name: 'render_image',
    description: 'Сделать картинку PNG: обложку из своей HTML-страницы (html) или кадр ролика по раскадровке (scenes, момент t в секундах).',
    parameters: {
      type: 'object',
      properties: {
        html: { type: 'string' },
        scenes: { type: 'string' },
        t: { type: 'number' },
        out: { type: 'string' },
        width: { type: 'integer', description: 'По умолчанию 1280 (обложка) или по формату раскадровки' },
        height: { type: 'integer', description: 'По умолчанию 720' },
      },
      required: ['out'],
    },
    async run({ html, scenes, t, out, width, height }) {
      return exclusive(async () => {
        let url;
        if (scenes) {
          const { spec, projectDir } = await loadSpec(scenes);
          url = await specPage(spec, projectDir);
          if (!width) [width, height] = sizeFor(spec.format, 'hd').out;
        } else if (html) {
          url = pathToFileURL(wsPath(html)).href;
        } else return 'Укажи html или scenes';
        width ||= 1280; height ||= 720;
        const page = await newRenderPage(width, height);
        try {
          await page.goto(url, { waitUntil: 'load', timeout: 60000 });
          await page.evaluate(() => Promise.race([window.__ready || Promise.resolve(), new Promise((r) => setTimeout(r, 15000))]));
          await page.evaluate((tt) => window.__seek && window.__seek(tt), t ?? (scenes ? 1.2 : 0));
          const outFull = wsPath(out);
          await fs.mkdir(path.dirname(outFull), { recursive: true });
          await page.screenshot({ path: outFull, type: 'png' });
          return `Готово: ${rel(outFull)} (${width}x${height})`;
        } finally {
          await page.context().close().catch(() => {});
        }
      });
    },
  },
  {
    name: 'download_media',
    description: 'Скачать картинку, видео или аудио по прямой ссылке в рабочую папку (до 80 МБ).',
    parameters: { type: 'object', properties: { url: { type: 'string' }, path: { type: 'string' } }, required: ['url', 'path'] },
    async run({ url, path: p }) {
      if (!isUrl(url)) return 'Нужна ссылка http(s)';
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36' }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) return `Не скачалось: HTTP ${res.status}`;
      const type = res.headers.get('content-type') || '';
      if (!/^(image|video|audio)\/|octet-stream/.test(type)) return `По ссылке не медиа, а ${type.split(';')[0] || 'неизвестно что'} — нужна прямая ссылка на файл`;
      if (Number(res.headers.get('content-length')) > 80 * 1048576) return 'Файл больше 80 МБ';
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 80 * 1048576) return 'Файл больше 80 МБ';
      const full = wsPath(p);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, buf);
      return `Скачано: ${rel(full)} (${mb(buf.length)}, ${type.split(';')[0]})`;
    },
  },
  {
    name: 'youtube_search',
    description: 'Поиск по YouTube: названия роликов, каналы, просмотры, длительность, давность, ссылки. Для анализа трендов и конкурентов.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, shorts: { type: 'boolean', description: 'Только Shorts' } }, required: ['query'] },
    async run({ query, shorts }) {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=ru&gl=UZ${shorts ? '&sp=EgIYAQ%253D%253D' : ''}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'Accept-Language': 'ru,en;q=0.8', Cookie: 'SOCS=CAI; CONSENT=YES+' },
        signal: AbortSignal.timeout(20000),
      });
      const html = await res.text();
      const m = html.match(/var ytInitialData = (\{.+?\});<\/script>/s);
      if (!m) return 'YouTube не отдал результаты — попробуй web_search с "site:youtube.com".';
      const out = [];
      const walk = (o) => {
        if (!o || typeof o !== 'object' || out.length >= 12) return;
        const v = o.videoRenderer;
        if (v?.videoId) {
          const t = (x) => x?.simpleText || x?.runs?.map((r) => r.text).join('') || '';
          out.push(`${out.length + 1}. ${t(v.title)} — ${t(v.ownerText)} · ${t(v.viewCountText) || '?'} · ${t(v.lengthText) || 'shorts'} · ${t(v.publishedTimeText)} · https://youtu.be/${v.videoId}`);
          return;
        }
        const r = o.reelItemRenderer;
        if (r?.videoId) { out.push(`${out.length + 1}. ${r.headline?.simpleText || ''} · ${r.viewCountText?.simpleText || '?'} · shorts · https://youtube.com/shorts/${r.videoId}`); return; }
        for (const k in o) walk(o[k]);
      };
      try { walk(JSON.parse(m[1])); } catch { return 'Не разобрал ответ YouTube'; }
      return out.length ? out.join('\n') : 'Ничего не нашлось';
    },
  },
];

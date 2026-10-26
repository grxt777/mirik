// Документы: чтение PDF/DOCX/PPTX/XLSX и сборка решения в DOCX или PDF.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { wsPath } from './files.js';
import { htmlToPdf, pdfFromFile } from './browser.js';
import { sandboxSpawn } from '../sandbox.js';

const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'doctool.py');

function py(args, input = '') {
  return new Promise((resolve) => {
    const child = spawn('python3', [HELPER, ...args], sandboxSpawn()); // чужие PDF разбираем без прав
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('error', (e) => { clearTimeout(timer); resolve('Ошибка: ' + e.message); });
    child.on('close', () => { clearTimeout(timer); resolve(out); });
    child.stdin.end(input);
  });
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function mdToHtml(md) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
  const out = [];
  let list = null, code = null, table = [];
  const flushTable = () => {
    const rows = table.filter((r) => !/^[\s|:-]+$/.test(r)).map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim())));
    if (rows.length) out.push(`<table>${rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${c}</td>` : `<th>${c}</th>`)).join('')}</tr>`).join('')}</table>`);
    table = [];
  };
  for (const line of md.split('\n')) {
    if (!code && line.trim().startsWith('|')) { table.push(line); continue; }
    if (table.length) flushTable();
    if (!code && /^\s*([-*_])\1{2,}\s*$/.test(line)) continue;
    if (line.trim().startsWith('```')) {
      if (code) { out.push(`<pre>${esc(code.join('\n'))}</pre>`); code = null; } else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    const ul = line.match(/^\s*[-*•]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/), h = line.match(/^(#{1,4})\s+(.*)/);
    if (ul || ol) {
      const t = ul ? 'ul' : 'ol';
      if (list !== t) { if (list) out.push(`</${list}>`); out.push(`<${t}>`); list = t; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    if (list) { out.push(`</${list}>`); list = null; }
    if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (table.length) flushTable();
  if (list) out.push(`</${list}>`);
  if (code) out.push(`<pre>${esc(code.join('\n'))}</pre>`);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:12pt/1.5 "Times New Roman","Liberation Serif",serif;color:#111;margin:0}
    h1{font-size:18pt}h2{font-size:15pt}h3{font-size:13pt}
    pre{font:9.5pt/1.4 "DejaVu Sans Mono",monospace;background:#f4f4f4;padding:8px;white-space:pre-wrap}
    code{font-family:"DejaVu Sans Mono",monospace;font-size:10pt}
    table{border-collapse:collapse;width:100%;margin:8px 0 12px;font-size:11pt}
    th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}th{background:#eee}
  </style></head><body>${out.join('\n')}</body></html>`;
}

export const docTools = [
  {
    name: 'html_to_pdf',
    description: 'Превратить HTML-файл из рабочей папки в PDF. format="slides" — страницы 1920x1080 (питч-дек: каждый <section class="slide"> на своей странице), "a4" — документ.',
    parameters: { type: 'object', properties: { html: { type: 'string' }, out: { type: 'string' }, format: { type: 'string', enum: ['slides', 'a4'] } }, required: ['html', 'out'] },
    async run({ html, out, format = 'slides' }) {
      const outFull = wsPath(out);
      await fs.mkdir(path.dirname(outFull), { recursive: true });
      await pdfFromFile(wsPath(html), outFull, format);
      const { size } = await fs.stat(outFull);
      return `Готово: ${out} (${(size / 1048576).toFixed(1)} МБ)`;
    },
  },
  {
    name: 'read_document',
    description: 'Прочитать документ из рабочей папки: PDF, DOCX, PPTX, XLSX или текст. Возвращает текст (у PDF — по страницам).',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    async run({ path: p }) {
      const out = await py(['read', wsPath(p)]);
      return out.length > 25000 ? out.slice(0, 25000) + '\n…[обрезано, документ длинный — читай частями через run_code при необходимости]' : out || '(пусто)';
    },
  },
  {
    name: 'make_document',
    description: 'Собрать готовый документ из markdown (заголовки #, списки, **жирный**, код в ```). Формат по расширению пути: .docx или .pdf.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Например solutions/os-hw2.docx' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    async run({ path: p, content }) {
      const full = wsPath(p);
      await fs.mkdir(path.dirname(full), { recursive: true });
      const ext = path.extname(full).toLowerCase();
      if (ext === '.pdf') {
        await htmlToPdf(mdToHtml(content), full);
        return `Готово: ${p}`;
      }
      if (ext !== '.docx') return 'Укажи путь с расширением .docx или .pdf';
      const out = await py(['docx', full], content);
      return out.includes('Готово') ? `Готово: ${p}` : 'Ошибка: ' + out;
    },
  },
];

// Поиск в интернете и чтение страниц.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ');

export function htmlToText(html) {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// DuckDuckGo режет серию запросов капчей — ходим к нему по одному, с паузой
let ddgQueue = Promise.resolve();
let ddgLast = 0;
function ddg(query) {
  const run = ddgQueue.then(async () => {
    const wait = 1200 - (Date.now() - ddgLast);
    if (wait > 0) await sleep(wait);
    ddgLast = Date.now();
    const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ru,en;q=0.8' },
      signal: AbortSignal.timeout(20000),
    });
    const html = await res.text();
    const out = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && out.length < 8) {
      let url = decode(m[1]);
      const u = url.match(/uddg=([^&]+)/);
      if (u) url = decodeURIComponent(u[1]);
      out.push({ title: htmlToText(m[2]), url, snippet: htmlToText(m[3]) });
    }
    return out;
  });
  ddgQueue = run.catch(() => {});
  return run.catch(() => []);
}

async function gnews(query) {
  const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ru&gl=UZ&ceid=UZ:ru`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  const xml = await res.text();
  const tag = (s, t) => decode((s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6).map(([, it]) => ({
    title: tag(it, 'title'),
    url: tag(it, 'link'),
    source: tag(it, 'source'),
    date: new Date(tag(it, 'pubDate')).toLocaleDateString('ru-RU'),
  }));
}

async function wikipedia(query) {
  const out = [];
  for (const lang of ['ru', 'en']) {
    const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=${encodeURIComponent(query)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    for (const r of data.query?.search || []) out.push({ title: r.title, snippet: htmlToText(r.snippet), url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}` });
    if (out.length >= 3) break;
  }
  return out.slice(0, 3);
}

export const webTools = [
  {
    name: 'web_search',
    description: 'Поиск в интернете: сайты, плюс свежие новости и Википедия, если сайтов нашлось мало. Ищи короткими ключевыми словами.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async run({ query }) {
      let hits = await ddg(query);
      if (!hits.length) { await sleep(2500); hits = await ddg(query); }
      const parts = [];
      if (hits.length) parts.push('Сайты:\n' + hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join('\n'));
      if (hits.length < 4) {
        const [news, wiki] = await Promise.all([gnews(query).catch(() => []), wikipedia(query).catch(() => [])]);
        if (news.length) parts.push('Новости (Google News):\n' + news.map((n, i) => `${i + 1}. ${n.title} — ${n.source}, ${n.date}\n   ${n.url}`).join('\n'));
        if (wiki.length) parts.push('Википедия:\n' + wiki.map((w, i) => `${i + 1}. ${w.title}: ${w.snippet}\n   ${w.url}`).join('\n'));
      }
      return parts.length ? parts.join('\n\n') : 'Ничего не найдено. Попробуй другие, более общие слова или английский вариант.';
    },
  },
  {
    name: 'fetch_url',
    description: 'Скачать страницу по URL и вернуть её текст (для статей, документации, API).',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    async run({ url }) {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      const type = res.headers.get('content-type') || '';
      const body = await res.text();
      const text = type.includes('html') ? htmlToText(body) : body;
      return `HTTP ${res.status}\n` + (text.length > 6000 ? text.slice(0, 6000) + '\n…[страница длиннее — обрезано]' : text);
    },
  },
];

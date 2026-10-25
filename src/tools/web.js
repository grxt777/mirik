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

export const webTools = [
  {
    name: 'web_search',
    description: 'Поиск в интернете. Возвращает список результатов (заголовок, ссылка, описание).',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async run({ query }) {
      const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
        headers: { 'User-Agent': UA },
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
        out.push(`${out.length + 1}. ${htmlToText(m[2])}\n   ${url}\n   ${htmlToText(m[3])}`);
      }
      return out.length ? out.join('\n') : 'Ничего не найдено.';
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
      return `HTTP ${res.status}\n` + text.slice(0, 15000);
    },
  },
];

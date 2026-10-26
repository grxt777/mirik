// Энциклопедия StartupBase — отдельная страница в стиле Notion
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const COLORS = { agritech: 'green', fintech: 'blue', foodtech: 'orange', edtech: 'purple', healthtech: 'red', ecommerce: 'pink', logistics: 'brown', mobility: 'yellow', proptech: 'brown', cleantech: 'green', hrtech: 'gray', traveltech: 'blue', media: 'purple', saas: 'gray', ai: 'purple', govtech: 'gray', other: 'gray' };
const COUNCIL = [['artem', 'Артём', '🔍'], ['dina', 'Дина', '💵'], ['kamila', 'Камила', '🛒'], ['sanjar', 'Санжар', '⚖️'], ['bakhtiyor', 'Бахтиёр', '💰']];
const state = { data: null, facts: null, view: 'table', sector: null, q: '', sort: 'updated' };
let token = null;
try { token = localStorage.getItem('mirik_token'); } catch {}

// ---------- тема ----------
try { const t = localStorage.getItem('base_theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
$('#theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('base_theme', document.documentElement.dataset.theme); } catch {}
});

// ---------- API ----------
async function api(path) {
  const res = await fetch(path, { headers: { 'x-token': token || '' } });
  if (res.status === 401) { location.href = '/?next=base'; throw new Error('auth'); }
  return res.json();
}

// ---------- markdown для мнений ----------
function md(src) {
  const blocks = [];
  let s = String(src ?? '').replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => `\u0000${blocks.push(code) - 1}\u0000`);
  s = esc(s);
  const inline = (t) => t.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const out = [];
  let list = null, table = [];
  const flush = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r)).map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim())));
    out.push(`<table>${rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${c}</td>` : `<th>${c}</th>`)).join('')}</tr>`).join('')}</table>`);
    table = [];
  };
  for (const line of s.split('\n')) {
    if (line.trim().startsWith('|')) { table.push(line); continue; }
    flush();
    const ul = line.match(/^\s*[-•*]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/), h = line.match(/^(#{1,4})\s+(.*)/);
    if (ul || ol) {
      const t = ul ? 'ul' : 'ol';
      if (list !== t) { if (list) out.push(`</${list}>`); out.push(`<${t}>`); list = t; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    if (list) { out.push(`</${list}>`); list = null; }
    if (h) out.push(`<h4>${inline(h[2])}</h4>`);
    else if (/^\s*-{3,}\s*$/.test(line)) out.push('<hr>');
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  if (list) out.push(`</${list}>`);
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre><code>${esc(blocks[i])}</code></pre>`);
}

// ---------- помощники ----------
const sectorOf = (id) => state.data?.sectors.find((s) => s.id === id) || { id, name: id, emoji: '🧪' };
const sectorTag = (id) => { const s = sectorOf(id); return `<span class="tag ${COLORS[id] || 'gray'}">${s.emoji} ${esc(s.name)}</span>`; };
const scoreCls = (v) => (v == null ? 'none' : v >= 7 ? 'good' : v >= 5 ? 'mid' : 'bad');
const score = (v) => `<span class="score ${scoreCls(v)}">${v == null ? '—' : Number.isInteger(v) ? v : v.toFixed(1)}</span>`;
const date = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const opOf = (idea, agent) => idea.opinions.find((o) => o.agent === agent);
const decisionTag = (d) => {
  if (!d) return '<span class="t-muted">—</span>';
  const t = d.toLowerCase();
  const cls = /не инвест|нет\b|отказ/.test(t) ? 'red' : /при услови|если|если\b/.test(t) ? 'yellow' : /инвестир|да\b|вложу/.test(t) ? 'green' : 'gray';
  return `<span class="tag ${cls}" title="${esc(d)}">${esc(d.length > 60 ? d.slice(0, 58) + '…' : d)}</span>`;
};

function filteredIdeas() {
  const q = state.q.toLowerCase();
  let list = state.data.ideas.filter((i) => (!state.sector || i.sector === state.sector) && (!q || `${i.title} ${i.summary} ${i.tags} ${i.region}`.toLowerCase().includes(q)));
  if (state.sort === 'score') list = [...list].sort((a, b) => (b.avg_score ?? -1) - (a.avg_score ?? -1));
  else if (state.sort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  return list;
}

// ---------- рендер ----------
function renderSidebar() {
  const d = state.data;
  $('#nIdeas').textContent = d.totals.ideas;
  $('#nFacts').textContent = d.totals.facts;
  const secs = d.sectors.filter((s) => s.ideas || s.facts);
  $('#sectorNav').innerHTML = secs.length
    ? secs.map((s) => `<button class="nav-item ${state.sector === s.id ? 'on' : ''}" data-sector="${s.id}">${s.emoji} <span>${esc(s.name)}</span><i>${s.ideas}</i></button>`).join('')
    : '<div class="nav-item" style="cursor:default"><span style="color:var(--faint)">Пока пусто</span></div>';
  document.querySelectorAll('[data-nav]').forEach((b) => b.classList.toggle('on', !state.sector && ((b.dataset.nav === 'facts') === (state.view === 'facts'))));
}

function renderHeader() {
  const d = state.data;
  const s = state.sector ? sectorOf(state.sector) : null;
  $('#pageIcon').textContent = s ? s.emoji : state.view === 'facts' ? '📄' : '📚';
  $('#pageTitle').textContent = s ? s.name : state.view === 'facts' ? 'Факты' : 'Энциклопедия StartupBase';
  $('#crumbs').textContent = s ? `StartupBase / ${s.name}` : state.view === 'facts' ? 'StartupBase / Факты' : 'StartupBase';
  $('#callout').classList.toggle('hidden', !!s);
  const ideas = s ? d.ideas.filter((i) => i.sector === s.id) : d.ideas;
  const scored = ideas.filter((i) => i.avg_score != null);
  const avg = scored.length ? scored.reduce((n, i) => n + i.avg_score, 0) / scored.length : null;
  const best = [...scored].sort((a, b) => b.avg_score - a.avg_score)[0];
  $('#stats').innerHTML = [
    `<span><b>${ideas.length}</b> идей</span>`,
    `<span><b>${s ? s.facts : d.totals.facts}</b> фактов</span>`,
    avg != null ? `<span>средняя оценка <b>${avg.toFixed(1)}</b>/10</span>` : '',
    best ? `<span>лучшая: <b>${esc(best.title.slice(0, 50))}</b> (${best.avg_score.toFixed(1)})</span>` : '',
  ].join('');
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  $('#sort').closest('.view-tools').classList.toggle('hidden', state.view === 'facts');
}

function renderTable() {
  const list = filteredIdeas();
  if (!list.length) return emptyState();
  return `<div class="table-wrap"><table>
    <thead><tr><th><span class="pi">Aa</span>Идея</th><th><span class="pi">◉</span>Отрасль</th><th><span class="pi">#</span>Средняя</th>
      ${COUNCIL.map(([, n, e]) => `<th><span class="pi">${e}</span>${n}</th>`).join('')}
      <th><span class="pi">💰</span>Решение инвестора</th><th><span class="pi">📍</span>Регион</th><th><span class="pi">🗓</span>Дата</th></tr></thead>
    <tbody>${list.map((i) => `<tr data-idea="${i.id}">
      <td><div class="t-title">📄 <span>${esc(i.title)}</span><span class="open">ОТКРЫТЬ</span></div></td>
      <td>${sectorTag(i.sector)}</td>
      <td>${score(i.avg_score)}</td>
      ${COUNCIL.map(([a]) => `<td title="${esc(opOf(i, a)?.verdict || '')}">${score(opOf(i, a)?.score ?? null)}</td>`).join('')}
      <td class="t-dec">${decisionTag(i.decision)}</td>
      <td class="t-muted">${esc(i.region || '—')}</td>
      <td class="t-muted">${date(i.updated_at)}</td>
    </tr>`).join('')}</tbody></table></div>
    <div class="new-row">＋ Новая идея — напиши Мирику «оцените идею …»</div>`;
}

function renderBoard() {
  const list = filteredIdeas();
  if (!list.length) return emptyState();
  const groups = new Map();
  for (const i of list) { if (!groups.has(i.sector)) groups.set(i.sector, []); groups.get(i.sector).push(i); }
  return `<div class="board">${[...groups].map(([sec, items]) => `<div class="col">
    <div class="col-head">${sectorTag(sec)} <i>${items.length}</i></div>
    ${items.map((i) => `<div class="card" data-idea="${i.id}"><b>📄 ${esc(i.title)}</b>
      <div class="row">${score(i.avg_score)} ${COUNCIL.map(([a, n]) => { const o = opOf(i, a); return o ? `<span class="tag gray">${n[0]} ${o.score ?? '—'}</span>` : ''; }).join('')}</div>
      <small>${esc(i.region || '')}${i.region ? ' · ' : ''}${date(i.updated_at)}</small></div>`).join('')}
  </div>`).join('')}</div>`;
}

function renderFacts() {
  if (!state.facts) { loadFacts(); return '<div class="empty">Загружаю факты…</div>'; }
  const q = state.q.toLowerCase();
  const list = state.facts.filter((f) => (!state.sector || f.sector === state.sector) && (!q || `${f.text} ${f.source}`.toLowerCase().includes(q)));
  if (!list.length) return '<div class="empty">Фактов пока нет — они появятся, когда совет оценит первые идеи.</div>';
  const KIND = { market: ['Рынок', 'blue'], competitor: ['Конкурент', 'orange'], price: ['Цена', 'yellow'], regulation: ['Регулирование', 'red'], investor: ['Инвестор', 'green'], metric: ['Метрика', 'purple'], trend: ['Тренд', 'pink'], customer: ['Клиент', 'brown'] };
  return `<div class="table-wrap"><table>
    <thead><tr><th><span class="pi">Aa</span>Факт</th><th><span class="pi">◉</span>Отрасль</th><th><span class="pi">◉</span>Тип</th><th><span class="pi">🗓</span>Актуально на</th><th><span class="pi">🔗</span>Источник</th><th><span class="pi">👤</span>Добавил</th></tr></thead>
    <tbody>${list.map((f) => { const k = KIND[f.kind] || [f.kind || 'Факт', 'gray']; const who = COUNCIL.find(([a]) => a === f.agent); return `<tr style="cursor:default">
      <td style="min-width:360px">${esc(f.text)}</td><td>${sectorTag(f.sector)}</td><td><span class="tag ${k[1]}">${esc(k[0])}</span></td>
      <td class="t-muted">${esc(f.as_of || '')}</td>
      <td class="fact-src">${/^https?:/.test(f.source) ? `<a href="${esc(f.source)}" target="_blank" rel="noopener">${esc(new URL(f.source).hostname.replace(/^www\./, ''))}</a>` : esc(f.source || '—')}</td>
      <td class="t-muted">${who ? who[2] + ' ' + who[1] : esc(f.agent || '—')}</td></tr>`; }).join('')}</tbody></table></div>`;
}

const emptyState = () => `<div class="empty">${state.q ? 'Ничего не нашлось.' : 'Пока ни одной оценённой идеи.<br>Напиши Мирику: «оцените идею …» — совет StartupBase разберёт её и запишет сюда.'}</div>`;

function render() {
  if (!state.data) return;
  renderSidebar();
  renderHeader();
  $('#content').innerHTML = state.view === 'facts' ? renderFacts() : state.view === 'board' ? renderBoard() : renderTable();
}

// ---------- пик-панель идеи ----------
async function openIdea(id) {
  const peek = $('#peek');
  peek.classList.remove('hidden');
  $('#peekShade').classList.remove('hidden');
  peek.innerHTML = '<div class="peek-body"><div class="empty">Загружаю…</div></div>';
  history.replaceState(null, '', `#idea=${id}`);
  const i = await api(`/api/vc/ideas/${id}`);
  if (i.error) { peek.innerHTML = `<div class="peek-body"><div class="empty">${esc(i.error)}</div></div>`; return; }
  const ops = COUNCIL.map(([a, n, e]) => {
    const o = i.opinions.find((x) => x.agent === a);
    return o ? `<details class="toggle"><summary><span class="tri">›</span><span class="who">${e} ${n}</span>${score(o.score)}<span class="vd">${esc(o.verdict || '')}</span></summary><div class="doc">${o.text ? md(o.text) : '<p style="color:var(--muted)">Текст мнения не найден.</p>'}</div></details>`
      : `<div class="toggle"><summary style="cursor:default"><span class="tri"> </span><span class="who">${e} ${n}</span><span class="vd">мнения нет</span></summary></div>`;
  }).join('');
  const factLi = (f) => `<li>${esc(f.text)} <small>· ${esc(f.as_of || '')}${f.source ? ' · ' + (/^https?:/.test(f.source) ? `<a href="${esc(f.source)}" target="_blank" rel="noopener" style="color:var(--link)">источник</a>` : esc(f.source)) : ''}</small></li>`;
  peek.innerHTML = `
    <div class="peek-top"><button data-close>✕ Закрыть</button><button data-copy>🔗 Ссылка</button></div>
    <div class="peek-body">
      <div style="font-size:48px;line-height:1">📄</div>
      <h2>${esc(i.title)}</h2>
      <div class="props">
        <div class="k">◉ Отрасль</div><div class="v">${sectorTag(i.sector)}</div>
        <div class="k"># Средняя</div><div class="v">${score(i.avg_score)} <span style="color:var(--muted)">из 10</span></div>
        <div class="k">💰 Инвестор</div><div class="v">${decisionTag(i.decision)}</div>
        <div class="k">📍 Регион</div><div class="v">${esc(i.region || '—')}</div>
        <div class="k">🏷 Теги</div><div class="v">${(i.tags || '').split(',').map((t) => t.trim()).filter(Boolean).map((t) => `<span class="tag gray">${esc(t)}</span>`).join(' ') || '—'}</div>
        <div class="k">🗓 Оценено</div><div class="v">${date(i.updated_at)}${i.history ? ` <span style="color:var(--muted)">· переоценок: ${i.history}</span>` : ''}</div>
        <div class="k">📁 Папка</div><div class="v" style="color:var(--muted)">${esc(i.folder || '—')}</div>
      </div>
      <div class="callout"><span>💡</span><div>${esc(i.summary || '')}</div></div>
      <h3>Мнения совета</h3>
      ${ops}
      ${i.facts.length ? `<h3>Факты по идее</h3><ul class="facts-list">${i.facts.map(factLi).join('')}</ul>` : ''}
      ${i.sectorFacts.length ? `<h3>${sectorOf(i.sector).emoji} Факты отрасли</h3><ul class="facts-list">${i.sectorFacts.map(factLi).join('')}</ul>` : ''}
    </div>`;
}
function closeIdea() {
  $('#peek').classList.add('hidden');
  $('#peekShade').classList.add('hidden');
  history.replaceState(null, '', location.pathname);
}
$('#peek').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeIdea();
  if (e.target.closest('[data-copy]')) navigator.clipboard?.writeText(location.href);
});
$('#peekShade').addEventListener('click', closeIdea);
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeIdea(); });

// ---------- события ----------
$('#content').addEventListener('click', (e) => { const r = e.target.closest('[data-idea]'); if (r) openIdea(Number(r.dataset.idea)); });
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; render(); }));
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
$('#q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
$('#sidebar').addEventListener('click', (e) => {
  const s = e.target.closest('[data-sector]');
  const n = e.target.closest('[data-nav]');
  if (s) { state.sector = s.dataset.sector; if (state.view === 'facts') state.view = 'table'; }
  if (n) { state.sector = null; state.view = n.dataset.nav === 'facts' ? 'facts' : 'table'; }
  if (s || n) { render(); $('#sidebar').classList.remove('open'); $('#main').scrollTo({ top: 0 }); }
});
$('#burger').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

async function loadFacts() { state.facts = await api('/api/vc/facts'); if (state.view === 'facts') render(); }

// ---------- старт ----------
(async () => {
  if (!token && tg?.initData) {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: tg.initData }) });
    if (res.ok) { token = (await res.json()).token; try { localStorage.setItem('mirik_token', token); } catch {} }
  }
  if (!token) { location.href = '/?next=base'; return; }
  state.data = await api('/api/vc');
  render();
  const m = location.hash.match(/idea=(\d+)/);
  if (m) openIdea(Number(m[1]));
})();

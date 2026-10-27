// Сеть — доска людей вокруг владельца. Чем теплее отношение, тем ближе к центру и ярче линия.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const NS = 'http://www.w3.org/2000/svg';
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let token = null;
try { token = localStorage.getItem('mirik_token'); } catch {}

const state = { people: [], pos: store.get('net_pos', {}), view: { x: 0, y: 0, k: 1 }, sel: null, filter: 'all', q: '' };
const key = (n) => String(n || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const tier = (s) => (s >= 8 ? 'warm' : s >= 5 ? 'mid' : 'cold');
const color = (s) => getComputedStyle(document.documentElement).getPropertyValue('--' + tier(s)).trim();
const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const date = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const WORD = { warm: 'тепло', mid: 'ровно', cold: 'холодно' };

// ---------- тема ----------
const theme = store.get('net_theme', null);
if (theme) document.documentElement.dataset.theme = theme;
$('#theme').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark';
  store.set('net_theme', document.documentElement.dataset.theme);
  draw();
});

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'x-token': token || '', ...(opts.headers || {}) } });
  if (res.status === 401) { location.href = '/?next=net'; throw new Error('auth'); }
  return res.json();
}

// ---------- раскладка ----------
// Новые люди встают по кругу: радиус по оценке, соседство по роли; потом расталкиваем, чтобы не налезали.
// Перетащенные вручную остаются там, куда их поставили.
function layout() {
  const fresh = state.people.filter((p) => !state.pos[p.id]);
  if (!fresh.length) return;
  const all = [...state.people].sort((a, b) => (a.role || '').localeCompare(b.role || '', 'ru') || b.score - a.score);
  const radius = (p) => 150 + (10 - p.score) * 42;
  const pts = new Map();
  all.forEach((p, i) => {
    if (state.pos[p.id]) return pts.set(p.id, { ...state.pos[p.id], fixed: true });
    const a = (i / all.length) * Math.PI * 2 - Math.PI / 2;
    pts.set(p.id, { x: Math.cos(a) * radius(p), y: Math.sin(a) * radius(p), r: radius(p) });
  });
  const list = [...pts.values()];
  for (let it = 0; it < 120; it++) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      if (d >= 112) continue;
      const push = (112 - d) / 2, ux = dx / d, uy = dy / d;
      if (!a.fixed) { a.x -= ux * push; a.y -= uy * push; }
      if (!b.fixed) { b.x += ux * push; b.y += uy * push; }
    }
    for (const p of list) {
      if (p.fixed) continue;
      const d = Math.hypot(p.x, p.y) || 1, k = 1 + ((p.r - d) / d) * 0.1;
      p.x *= k; p.y *= k;
    }
  }
  for (const p of fresh) { const { x, y } = pts.get(p.id); state.pos[p.id] = { x: Math.round(x), y: Math.round(y) }; }
  store.set('net_pos', state.pos);
}

// ---------- рисование ----------
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};

function visible(p) {
  if (state.filter !== 'all' && tier(p.score) !== state.filter) return false;
  const q = key(state.q);
  return !q || key(`${p.name} ${p.role} ${p.relation}`).includes(q);
}

function curve(a, b, bend = 0.12) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
  return `M${a.x},${a.y} Q${mx - dy * bend},${my + dx * bend} ${b.x},${b.y}`;
}

function draw() {
  const edges = $('#edges'), nodes = $('#nodes');
  edges.replaceChildren();
  nodes.replaceChildren();
  $('#empty').classList.toggle('hidden', state.people.length > 0);
  const me = { x: 0, y: 0 };
  const byKey = new Map(state.people.map((p) => [key(p.name), p]));
  const focus = state.sel ? new Set([state.sel, ...linked(state.people.find((p) => p.id === state.sel))]) : null;
  const dim = (p) => !visible(p) || (focus && !focus.has(p.id));

  // знакомы между собой — пунктир, по одному на пару
  const seen = new Set();
  for (const p of state.people) for (const n of p.knows || []) {
    const o = byKey.get(key(n));
    if (!o) continue;
    const pair = [p.id, o.id].sort().join('-');
    if (seen.has(pair)) continue;
    seen.add(pair);
    el('path', { d: curve(state.pos[p.id], state.pos[o.id], 0.08), class: 'edge knows' + (dim(p) || dim(o) ? ' dim' : '') }, edges);
  }
  // от меня к каждому: цвет и толщина — отношение
  for (const p of state.people) {
    el('path', {
      d: curve(me, state.pos[p.id]), class: 'edge' + (dim(p) ? ' dim' : ''),
      stroke: color(p.score), 'stroke-width': (1 + p.score * 0.38).toFixed(1), opacity: (0.3 + p.score * 0.05).toFixed(2),
    }, edges);
  }

  const m = el('g', { class: 'node me' }, nodes);
  el('circle', { class: 'pulse', r: 50 }, m);
  el('circle', { class: 'pulse', r: 68, opacity: 0.12 }, m);
  el('circle', { class: 'disc', r: 34 }, m);
  el('text', { class: 'ini' }, m).textContent = 'Я';

  for (const p of state.people) {
    const { x, y } = state.pos[p.id];
    const c = color(p.score);
    const g = el('g', { class: 'node' + (p.id === state.sel ? ' sel' : '') + (dim(p) ? ' dim' : ''), transform: `translate(${x},${y})`, 'data-id': p.id }, nodes);
    el('circle', { class: 'halo', r: 38, fill: c }, g);
    el('circle', { class: 'disc', r: 27, stroke: c }, g);
    el('text', { class: 'ini' }, g).textContent = initials(p.name);
    el('text', { class: 'nm', y: 46 }, g).textContent = p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name;
    if (p.role) el('text', { class: 'rl', y: 61 }, g).textContent = p.role;
    const b = el('g', { class: 'badge', transform: 'translate(21,-21)' }, g);
    el('rect', { x: -13, y: -10, width: 26, height: 20, rx: 10, fill: c }, b);
    el('text', {}, b).textContent = p.score;
  }
  applyView();
  $('#sub').textContent = state.people.length ? `${state.people.length} ${plural(state.people.length, 'человек', 'человека', 'человек')} · средняя ${avg()}/10` : 'люди вокруг тебя';
  if (!$('#list').classList.contains('hidden')) renderList();
}

const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
const avg = () => (state.people.reduce((s, p) => s + p.score, 0) / state.people.length).toFixed(1);
function linked(p) {
  if (!p) return [];
  const k = key(p.name), mine = new Set((p.knows || []).map(key));
  return state.people.filter((o) => mine.has(key(o.name)) || (o.knows || []).some((n) => key(n) === k)).map((o) => o.id);
}

// ---------- вид: сдвиг и масштаб ----------
function applyView() {
  const { x, y, k } = state.view;
  const r = $('#svg').getBoundingClientRect();
  $('#world').setAttribute('transform', `translate(${r.width / 2 + x},${r.height / 2 + y}) scale(${k})`);
  $('#board').style.backgroundPosition = `${r.width / 2 + x}px ${r.height / 2 + y}px`;
  $('#board').style.backgroundSize = `${26 * k}px ${26 * k}px`;
}
function fit() {
  const pts = [{ x: 0, y: 0 }, ...state.people.map((p) => state.pos[p.id])];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const r = $('#svg').getBoundingClientRect();
  const w = Math.max(...xs) - Math.min(...xs) + 200, h = Math.max(...ys) - Math.min(...ys) + 240;
  const k = Math.min(1.4, Math.max(0.25, Math.min(r.width / w, (r.height - 90) / h)));
  state.view = { k, x: -((Math.max(...xs) + Math.min(...xs)) / 2) * k, y: -((Math.max(...ys) + Math.min(...ys)) / 2) * k + 30 };
  applyView();
}
function zoomAt(cx, cy, factor) {
  const r = $('#svg').getBoundingClientRect();
  const v = state.view, k = Math.min(3, Math.max(0.2, v.k * factor));
  const ox = cx - r.left - r.width / 2, oy = cy - r.top - r.height / 2;
  v.x = ox - ((ox - v.x) * k) / v.k;
  v.y = oy - ((oy - v.y) * k) / v.k;
  v.k = k;
  applyView();
}

const pointers = new Map();
let drag = null;
const board = $('#board');
board.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.legend')) return;
  board.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y) }; return; }
  const n = e.target.closest('.node:not(.me)');
  drag = n ? { id: Number(n.dataset.id), sx: e.clientX, sy: e.clientY, moved: false } : { pan: true, sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y, moved: false };
  if (drag.pan) board.classList.add('panning');
});
board.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId) || !drag) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (drag.pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / drag.pinch);
    drag.pinch = d;
    return;
  }
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (Math.hypot(dx, dy) > 4) drag.moved = true;
  if (!drag.moved) return;
  if (drag.pan) { state.view.x = drag.vx + dx; state.view.y = drag.vy + dy; applyView(); return; }
  const p = state.pos[drag.id];
  p.x += dx / state.view.k; p.y += dy / state.view.k;
  drag.sx = e.clientX; drag.sy = e.clientY;
  draw();
});
const up = (e) => {
  pointers.delete(e.pointerId);
  board.classList.remove('panning');
  if (!drag || drag.pinch) { if (!pointers.size) drag = null; return; }
  if (!drag.moved) drag.id ? openCard(drag.id) : closeCard();
  else if (drag.id) store.set('net_pos', state.pos);
  drag = null;
};
board.addEventListener('pointerup', up);
board.addEventListener('pointercancel', up);
board.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
addEventListener('resize', applyView);

// ---------- карточка ----------
function openCard(id) {
  const p = state.people.find((x) => x.id === id);
  if (!p) return;
  state.sel = id;
  draw();
  const c = color(p.score), t = tier(p.score);
  const hist = p.history || [];
  const friends = linked(p).map((i) => state.people.find((o) => o.id === i));
  const card = $('#card');
  card.classList.remove('hidden');
  card.innerHTML = `
    <button class="x" data-close>✕</button>
    <div class="ava" style="border-color:${c}">${esc(initials(p.name))}</div>
    <h2>${esc(p.name)}</h2>
    ${p.role ? `<div class="role">${esc(p.role)}</div>` : ''}
    <div class="score-big"><b style="color:${c}">${p.score}</b><span>/ 10</span><em>${WORD[t]}</em></div>
    <div class="meter">${Array.from({ length: 10 }, (_, i) => `<i style="${i < p.score ? `background:${c}` : ''}"></i>`).join('')}</div>
    <h4>Отношение ко мне</h4>
    <p class="rel">${esc(p.relation)}</p>
    ${hist.length > 1 ? `<h4>Как менялась оценка</h4>
      <div class="trend">${hist.map((h) => `<i title="${date(h.t)}: ${h.score}/10" style="height:${h.score * 10}%;background:${color(h.score)}"></i>`).join('')}</div>
      <div class="trend-dates"><span>${date(hist[0].t)}</span><span>${date(hist.at(-1).t)}</span></div>` : ''}
    ${friends.length ? `<h4>Связан(а) с</h4><div class="knows-list">${friends.map((f) => `<button data-open="${f.id}">${esc(f.name)}</button>`).join('')}</div>` : ''}
    <div class="foot"><span>Обновлено ${date(p.updated_at)}</span><button class="del" data-del>Убрать из сети</button></div>`;
}
function closeCard() {
  if (state.sel == null) return;
  state.sel = null;
  $('#card').classList.add('hidden');
  draw();
}
$('#card').addEventListener('click', async (e) => {
  if (e.target.closest('[data-close]')) return closeCard();
  const o = e.target.closest('[data-open]');
  if (o) return openCard(Number(o.dataset.open));
  const d = e.target.closest('[data-del]');
  if (!d) return;
  // без confirm(): первый клик — предупреждение, второй — удаление
  if (!d.classList.contains('confirm')) { d.classList.add('confirm'); d.textContent = 'Точно убрать?'; return; }
  await api(`/api/network/${state.sel}`, { method: 'DELETE' });
  delete state.pos[state.sel];
  store.set('net_pos', state.pos);
  state.people = state.people.filter((p) => p.id !== state.sel);
  closeCard();
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCard(); });

// ---------- список ----------
function renderList() {
  const list = state.people.filter(visible);
  $('#list').innerHTML = `<div class="list-head"><span>${list.length} в списке</span><span>по оценке</span></div>` + (list.length
    ? list.map((p) => `<button class="row ${p.id === state.sel ? 'sel' : ''}" data-open="${p.id}">
        <span class="mini" style="border-color:${color(p.score)}">${esc(initials(p.name))}</span>
        <div><b>${esc(p.name)}</b><small>${esc(p.role || p.relation)}</small></div>
        <span class="sc" style="color:${color(p.score)}">${p.score}</span></button>`).join('')
    : '<div class="list-head">Никого не нашлось</div>');
}
$('#listBtn').addEventListener('click', () => {
  const open = $('#list').classList.toggle('hidden') === false;
  $('#listBtn').classList.toggle('on', open);
  if (open) renderList();
});
$('#list').addEventListener('click', (e) => {
  const r = e.target.closest('[data-open]');
  if (!r) return;
  const p = state.pos[r.dataset.open];
  state.view.x = -p.x * state.view.k; state.view.y = -p.y * state.view.k;
  openCard(Number(r.dataset.open));
});

// ---------- фильтры ----------
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  state.filter = b.dataset.f;
  document.querySelectorAll('#chips button').forEach((x) => x.classList.toggle('on', x === b));
  draw();
});
$('#q').addEventListener('input', (e) => { state.q = e.target.value; draw(); });
$('#fit').addEventListener('click', fit);

// ---------- старт ----------
async function load(first) {
  state.people = await api('/api/network');
  layout();
  draw();
  if (first) fit();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && token) load(false); });
(async () => {
  if (!token && tg?.initData) {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: tg.initData }) });
    if (res.ok) { token = (await res.json()).token; try { localStorage.setItem('mirik_token', token); } catch {} }
  }
  if (!token) { location.href = '/?next=net'; return; }
  await load(true);
})();

import { Office, avatarURL } from './office.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const AGENT_STATUS = { idle: 'свободен', thinking: 'думает', working: 'работает', managing: 'раздаёт задачи' };
const state = { agents: {}, tasks: new Map(), openSteps: new Set(), to: 'mirik', stats: null };
const coarse = matchMedia('(pointer: coarse)').matches;
let token = null;
try { token = localStorage.getItem('mirik_token'); } catch {}

const office = new Office($('#office'), { onSelect: (id) => { showCard(id); renderCrew(); } });

// ---------- markdown ----------
function md(src) {
  const blocks = [];
  let s = String(src ?? '').replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => `\u0000${blocks.push(code) - 1}\u0000`);
  s = esc(s);
  const inline = (t) => t
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const out = [];
  let list = null;
  for (const line of s.split('\n')) {
    const ul = line.match(/^\s*[-•*]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/), h = line.match(/^#{1,6}\s+(.*)/);
    if (ul || ol) {
      const type = ul ? 'ul' : 'ol';
      if (list !== type) { if (list) out.push(`</${list}>`); out.push(`<${type}>`); list = type; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    if (list) { out.push(`</${list}>`); list = null; }
    if (h) out.push(`<h4>${inline(h[1])}</h4>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`</${list}>`);
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre><code>${esc(blocks[i])}</code></pre>`);
}

// ---------- API ----------
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-token': token || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error('auth'); }
  return res.json();
}

async function login(payload) {
  const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error((await res.json()).error || 'Ошибка входа');
  token = (await res.json()).token;
  try { localStorage.setItem('mirik_token', token); } catch {}
}

function showLogin() {
  $('#login').classList.remove('hidden');
  setTimeout(() => $('#password').focus(), 50);
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await login({ password: $('#password').value });
    $('#login').classList.add('hidden');
    connect();
  } catch (err) {
    $('#loginErr').textContent = err.message;
  }
});

// ---------- WebSocket ----------
let ws, retry = 0;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  ws.onopen = () => { retry = 0; $('#connDot').classList.add('on'); $('#connDot').title = 'На связи'; };
  ws.onclose = (e) => {
    $('#connDot').classList.remove('on');
    $('#connDot').title = 'Нет соединения';
    if (e.code === 4001) return showLogin();
    setTimeout(connect, Math.min(10000, 1000 * 2 ** retry++));
  };
  ws.onmessage = (m) => handle(JSON.parse(m.data));
}

function handle(e) {
  switch (e.type) {
    case 'init':
      e.agents.forEach((a) => (state.agents[a.id] = a));
      office.setAgents(e.agents);
      state.tasks = new Map(e.tasks.map((t) => [t.id, t]));
      $('#v-feed').innerHTML = '';
      e.logs.forEach((l) => addLog(l, true));
      state.stats = e.stats;
      renderAll();
      scrollChat(true);
      break;
    case 'agent':
      if (state.agents[e.agent.id]) state.agents[e.agent.id].state = e.agent;
      office.applyState(e.agent);
      scheduleRender('agents');
      break;
    case 'task': {
      const prev = state.tasks.get(e.task.id);
      state.tasks.set(e.task.id, e.task);
      if (prev?.status === 'running' && e.task.status === 'done') {
        toast(`✅ ${state.agents[e.task.agent]?.name}: «${e.task.text.slice(0, 60)}» — готово`);
        office.taskDone(e.task.agent);
        if (state.stats) state.stats.tasksDone++;
      }
      if (prev?.status === 'running' && e.task.status === 'failed') toast(`❌ ${e.task.result?.slice(0, 120)}`, true);
      upsertMessage(e.task);
      scheduleRender('stats');
      break;
    }
    case 'delegate': office.delegate(e.from, e.to, e.text); break;
    case 'report': office.report(e.from); break;
    case 'log': addLog(e.entry); break;
  }
}

const pending = new Set();
function scheduleRender(what) {
  if (!pending.size) requestAnimationFrame(() => {
    if (pending.has('agents')) { renderCrew(); renderTeam(); if (office.selected) showCard(office.selected); }
    renderStats();
    pending.clear();
  });
  pending.add(what);
}

function renderAll() {
  renderCrew();
  renderTo();
  renderTeam();
  renderStats();
  renderChat();
}

// ---------- шапка ----------
function renderStats() {
  const list = [...state.tasks.values()];
  office.running = list.filter((t) => t.status === 'running').length;
  office.done = list.filter((t) => t.status === 'done').length;
  $('#sRunning').textContent = office.running;
  $('#pRunning').classList.toggle('active', office.running > 0);
  if (state.stats) {
    $('#sDone').textContent = Math.max(state.stats.tasksDone, office.done);
    $('#sCost').textContent = '$' + state.stats.cost.toFixed(3);
  }
}

const statusColor = (s) => ({ thinking: '#f1c40f', working: '#2ecc71', managing: '#ff9f43' })[s] || '#7d7896';

function renderCrew() {
  $('#crew').innerHTML = Object.values(state.agents).map((a) =>
    `<button data-focus="${a.id}" class="${office.selected === a.id ? 'on' : ''}" title="${esc(a.name)} — ${esc(a.state.activity)}">
      <img src="${avatarURL(a.id, a.look)}" alt=""><i style="background:${statusColor(a.state.status)}"></i></button>`).join('');
}
$('#crew').addEventListener('click', (e) => {
  const b = e.target.closest('[data-focus]');
  if (!b) return;
  office.focus(b.dataset.focus);
  showCard(b.dataset.focus);
  renderCrew();
  if (matchMedia('(max-width: 900px)').matches) $('#app').classList.remove('expanded');
});

// ---------- карточка агента ----------
function currentTask(id) {
  return [...state.tasks.values()].reverse().find((t) => t.status === 'running' && (t.agent === id || t.steps.some((s) => s.agent === id)));
}

function showCard(id) {
  const card = $('#card');
  const a = state.agents[id];
  if (!a) { card.classList.add('hidden'); return; }
  const task = currentTask(id);
  const following = office.follow === id;
  card.classList.remove('hidden');
  card.innerHTML = `
    <button class="x" data-close aria-label="Закрыть">✕</button>
    <div class="card-head"><img src="${avatarURL(a.id, a.look, 112)}" alt="">
      <div class="card-id"><h3>${esc(a.name)}</h3><div class="role">${esc(a.role)}</div>
      <div class="card-mini"><span class="status ${a.state.status}">${AGENT_STATUS[a.state.status] || a.state.status}</span> ${/^(думает|отдыхает)/.test(a.state.activity) ? '' : esc(a.state.activity)}</div></div></div>
    <div class="now"><span class="status ${a.state.status}">${AGENT_STATUS[a.state.status] || a.state.status}</span>
      <div style="margin-top:6px">${esc(a.state.activity)}</div>
      ${task ? `<small>Задание: ${esc(task.text.slice(0, 90))}</small>` : ''}</div>
    <div class="actions">
      <button class="btn primary" data-assign="${a.id}">✍️ <span>Поручить</span></button>
      <button class="btn ghost" data-follow="${a.id}">🎯 <span>${following ? 'Следим' : 'Следить'}</span></button>
    </div>`;
}
$('#card').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { $('#card').classList.add('hidden'); office.selected = null; office.follow = null; renderCrew(); }
  const as = e.target.closest('[data-assign]');
  if (as) { setTo(as.dataset.assign); switchTab('chat'); $('#app').classList.remove('expanded'); $('#msg').focus(); }
  const f = e.target.closest('[data-follow]');
  if (f) { if (office.follow === f.dataset.follow) office.follow = null; else office.focus(f.dataset.follow); showCard(f.dataset.follow); }
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#card').classList.add('hidden'); office.selected = null; } });

// ---------- чат ----------
const plain = (s) => String(s).replace(/\*\*|`|#{1,6}\s/g, '').replace(/\n+/g, ' ');
function stepLine(s) {
  const a = state.agents[s.agent];
  return `<li>${a?.emoji || '•'} <b>${esc(a?.name || s.agent)}</b> ${esc(plain(s.text).slice(0, 220))}</li>`;
}

function messageHTML(t) {
  const a = state.agents[t.agent] || {};
  const time = new Date(t.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const src = t.source === 'telegram' ? '✈️ Telegram' : '🏢 Офис';
  const to = t.agent !== 'mirik' ? `<span>→ ${esc(a.name)}</span>` : '';
  const running = t.status === 'running' || t.status === 'queued';
  const last = t.steps.at(-1);
  const steps = t.steps.length
    ? `<details class="steps" data-steps="${t.id}" ${state.openSteps.has(t.id) ? 'open' : ''}><summary>Ход работы · ${t.steps.length}</summary><ol>${t.steps.map(stepLine).join('')}</ol></details>`
    : '';
  let body;
  if (running) {
    const la = last && state.agents[last.agent];
    body = `<div class="typing"><span></span><span></span><span></span></div>${last ? `<div class="live">${la?.emoji || ''} ${esc(la?.name || '')}: ${esc(plain(last.text).slice(0, 140))}</div>` : ''}`;
  } else body = `<div class="md">${md(t.result || (t.status === 'cancelled' ? 'Остановлено.' : '—'))}</div>`;
  const status = running ? '<span class="status working">в работе</span>' : t.status === 'failed' ? '<span class="status" style="color:var(--red)">ошибка</span>' : t.status === 'cancelled' ? '<span class="status">остановлено</span>' : '';
  const actions = running
    ? `<div class="bubble-actions"><button class="stop" data-cancel="${t.id}">⛔ Остановить</button></div>`
    : `<div class="bubble-actions"><button data-copy="${t.id}">📋 Копировать</button><button data-retry="${t.id}">↻ Повторить</button></div>`;
  return `<div class="msg me"><div><div class="bubble">${esc(t.text)}</div><div class="meta"><span>${src}</span>${to}<span>${time}</span></div></div></div>
    <div class="msg bot"><img class="ava" src="${avatarURL(a.id, a.look)}" alt="">
      <div class="bubble ${t.status === 'failed' ? 'failed' : ''}"><div class="who">${esc(a.name)} ${status}</div>${body}${steps}${actions}</div></div>`;
}

function welcomeHTML() {
  const m = state.agents.mirik;
  const ideas = ['Зайди на сайт школы, выгрузи домашку на завтра и реши её', 'Найди 5 лучших бесплатных курсов по Python и сравни их', 'Напиши скрипт, который переименует фото по дате съёмки', 'Сделай краткий конспект темы «Фотосинтез» для 7 класса'];
  return `<div class="welcome">${m ? `<img src="${avatarURL('mirik', m.look, 144)}" alt="">` : ''}
    <h2>Привет, босс!</h2><p>Дай задание — я раздам его команде и пришлю результат.</p>
    <div class="suggest">${ideas.map((i) => `<button data-idea="${esc(i)}">${esc(i)}</button>`).join('')}</div></div>`;
}

const nearBottom = () => { const v = $('#v-chat'); return v.scrollHeight - v.scrollTop - v.clientHeight < 120; };
function scrollChat(force) {
  const v = $('#v-chat');
  if (force || nearBottom()) { v.scrollTop = v.scrollHeight; $('#jump').classList.add('hidden'); }
  else $('#jump').classList.remove('hidden');
}

function renderChat() {
  const list = [...state.tasks.values()].sort((a, b) => a.createdAt - b.createdAt);
  $('#chat').innerHTML = list.length ? list.map((t) => `<div class="turn" data-task="${t.id}">${messageHTML(t)}</div>`).join('') : welcomeHTML();
}

function upsertMessage(t) {
  const stick = nearBottom();
  const el = $(`#chat [data-task="${t.id}"]`);
  if (el) el.innerHTML = messageHTML(t);
  else {
    if (!$('#chat .turn')) $('#chat').innerHTML = '';
    $('#chat').insertAdjacentHTML('beforeend', `<div class="turn" data-task="${t.id}">${messageHTML(t)}</div>`);
  }
  if (stick) scrollChat(true); else $('#jump').classList.remove('hidden');
}

$('#chat').addEventListener('toggle', (e) => {
  const d = e.target.closest?.('[data-steps]');
  if (d) d.open ? state.openSteps.add(d.dataset.steps) : state.openSteps.delete(d.dataset.steps);
}, true);
$('#chat').addEventListener('click', async (e) => {
  const idea = e.target.closest('[data-idea]');
  if (idea) { $('#msg').value = idea.dataset.idea; autosize(); $('#msg').focus(); return; }
  const c = e.target.closest('[data-cancel]');
  if (c) { c.disabled = true; await api(`/api/tasks/${c.dataset.cancel}/cancel`, {}); return; }
  const cp = e.target.closest('[data-copy]');
  if (cp) { await navigator.clipboard?.writeText(state.tasks.get(cp.dataset.copy)?.result || ''); toast('Скопировано'); return; }
  const r = e.target.closest('[data-retry]');
  if (r) { const t = state.tasks.get(r.dataset.retry); if (t) send(t.text, t.agent); }
});
$('#v-chat').addEventListener('scroll', () => { if (nearBottom()) $('#jump').classList.add('hidden'); });
$('#jump').addEventListener('click', () => scrollChat(true));

// ---------- команда ----------
function renderTeam() {
  const tasks = [...state.tasks.values()];
  $('#v-team').innerHTML = Object.values(state.agents).map((a) => {
    const done = tasks.reduce((n, t) => n + t.steps.filter((s) => s.agent === a.id && s.text.startsWith('✅')).length, 0);
    return `<div class="member">
      <img src="${avatarURL(a.id, a.look, 104)}" alt="">
      <div>
        <h4>${esc(a.name)} <span class="status ${a.state.status}">${AGENT_STATUS[a.state.status]}</span><span class="count">✅ ${done}</span></h4>
        <div class="role">${esc(a.role)}</div>
        <div class="act">${esc(a.state.activity)}</div>
        <div class="actions"><button class="btn primary" data-assign="${a.id}">✍️ Поручить</button><button class="btn ghost" data-show="${a.id}">📍 В офисе</button></div>
      </div></div>`;
  }).join('');
}
$('#v-team').addEventListener('click', (e) => {
  const as = e.target.closest('[data-assign]');
  if (as) { setTo(as.dataset.assign); switchTab('chat'); $('#msg').focus(); }
  const sh = e.target.closest('[data-show]');
  if (sh) { office.focus(sh.dataset.show); showCard(sh.dataset.show); renderCrew(); }
});

// ---------- лента ----------
function addLog(entry, silent) {
  const feed = $('#v-feed');
  const a = state.agents[entry.agent];
  const el = document.createElement('div');
  el.className = 'log ' + entry.kind;
  el.innerHTML = `<time>${new Date(entry.t).toLocaleTimeString('ru-RU')}</time><span>${a?.emoji || '•'} <b>${esc(a?.name || entry.agent)}</b> ${esc(entry.text)}</span>`;
  feed.prepend(el);
  while (feed.children.length > 200) feed.lastChild.remove();
  if (!silent && $('#v-feed').classList.contains('hidden')) $('#feedDot').classList.remove('hidden');
}

// ---------- вкладки ----------
function switchTab(tab) {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'v-' + tab));
  if (tab === 'feed') $('#feedDot').classList.add('hidden');
  $('#composer').classList.toggle('hidden', tab === 'feed');
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

// ---------- композер ----------
function renderTo() {
  $('#to').innerHTML = Object.values(state.agents).map((a) =>
    `<button type="button" data-to="${a.id}" class="${state.to === a.id ? 'on' : ''}"><img src="${avatarURL(a.id, a.look)}" alt="">${esc(a.name)}</button>`).join('');
  const a = state.agents[state.to];
  $('#msg').placeholder = state.to === 'mirik' ? 'Задание для Мирика…' : `${a?.name}, вот задание…`;
}
function setTo(id) { state.to = id; renderTo(); }
$('#to').addEventListener('click', (e) => { const b = e.target.closest('[data-to]'); if (b) setTo(b.dataset.to); });

function autosize() { const m = $('#msg'); m.style.height = 'auto'; m.style.height = Math.min(140, m.scrollHeight) + 'px'; }
$('#msg').addEventListener('input', autosize);
$('#msg').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (!coarse && !e.shiftKey))) { e.preventDefault(); $('#composer').requestSubmit(); }
});

async function send(text, agent) {
  const r = await api('/api/tasks', { text, agent });
  if (r.error) return toast(r.error, true);
  if (r.task) { state.tasks.set(r.task.id, r.task); upsertMessage(r.task); scrollChat(true); }
  tg?.HapticFeedback?.impactOccurred('light');
}
$('#composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#msg').value.trim();
  if (!text) return;
  $('#msg').value = '';
  autosize();
  await send(text, state.to);
});

// ---------- офис: кнопки ----------
document.querySelector('.world-tools').addEventListener('click', (e) => {
  const z = e.target.closest('[data-z]')?.dataset.z;
  if (z === 'in') office.zoomBy(1.35);
  if (z === 'out') office.zoomBy(1 / 1.35);
  if (z === 'fit') office.fit();
  if (z === 'expand') $('#app').classList.toggle('expanded');
});
const hideHint = () => $('#hint').style.opacity = '0';
setTimeout(hideHint, 7000);
$('#office').addEventListener('pointerdown', hideHint, { once: true });

function toast(text, err) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4500);
}

setInterval(async () => {
  if (ws?.readyState === 1) { state.stats = (await api('/api/state')).stats; renderStats(); }
}, 20000);

// ---------- старт ----------
(async () => {
  if (tg?.initData) {
    try { await login({ initData: tg.initData }); } catch {}
  }
  if (!token) return showLogin();
  connect();
})();

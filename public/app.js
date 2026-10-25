import { Office } from './office.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const STATUS_RU = { queued: 'в очереди', running: 'в работе', done: 'готово', failed: 'ошибка', cancelled: 'отменено' };
const state = { agents: {}, tasks: new Map(), open: new Set() };
let token = null;
try { token = localStorage.getItem('mirik_token'); } catch {}

const office = new Office($('#office'), { onSelect: showCard });

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
  $('#password').focus();
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
  ws.onopen = () => { retry = 0; $('#connDot').classList.add('on'); };
  ws.onclose = (e) => {
    $('#connDot').classList.remove('on');
    if (e.code === 4001) return showLogin();
    setTimeout(connect, Math.min(10000, 1000 * 2 ** retry++));
  };
  ws.onmessage = (m) => handle(JSON.parse(m.data));
}

function handle(e) {
  switch (e.type) {
    case 'init':
      $('#model').textContent = e.model;
      e.agents.forEach((a) => (state.agents[a.id] = a));
      office.setAgents(e.agents);
      state.tasks = new Map(e.tasks.map((t) => [t.id, t]));
      $('#tab-feed').innerHTML = '';
      e.logs.forEach(addLog);
      fillSelect();
      renderStats(e.stats);
      renderTasks();
      renderTeam();
      break;
    case 'agent':
      if (state.agents[e.agent.id]) state.agents[e.agent.id].state = e.agent;
      office.applyState(e.agent);
      renderTeam();
      if (office.selected === e.agent.id) showCard(e.agent.id);
      break;
    case 'task': {
      const prev = state.tasks.get(e.task.id);
      state.tasks.set(e.task.id, e.task);
      if (prev?.status === 'running' && e.task.status === 'done') toast(`✅ ${state.agents[e.task.agent]?.name}: «${e.task.text.slice(0, 60)}» готово`);
      if (e.task.status === 'failed') toast(`❌ ${e.task.result?.slice(0, 100)}`, true);
      scheduleRender();
      break;
    }
    case 'delegate':
      office.delegate(e.from, e.to, e.text);
      break;
    case 'report':
      office.report(e.from);
      break;
    case 'log':
      addLog(e.entry);
      break;
  }
}

let renderPending = false;
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => { renderPending = false; renderTasks(); renderStatsFromTasks(); });
}

// ---------- рендер ----------
function renderStats(s) {
  state.stats = s;
  $('#sTokens').textContent = s.tokens > 9999 ? Math.round(s.tokens / 1000) + 'k' : s.tokens;
  $('#sCost').textContent = '$' + s.cost.toFixed(3);
  renderStatsFromTasks();
}
function renderStatsFromTasks() {
  const list = [...state.tasks.values()];
  office.running = list.filter((t) => t.status === 'running').length;
  office.done = list.filter((t) => t.status === 'done').length;
  $('#sRunning').textContent = office.running;
  $('#sDone').textContent = state.stats ? Math.max(state.stats.tasksDone, office.done) : office.done;
}

function fillSelect() {
  $('#cmdAgent').innerHTML = Object.values(state.agents).map((a) => `<option value="${a.id}">${a.emoji} ${esc(a.name)}${a.id === 'mirik' ? ' (раздаст сам)' : ''}</option>`).join('');
}

function renderTasks() {
  const list = [...state.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  if (!list.length) { $('#tab-tasks').innerHTML = '<div class="empty">Заданий пока нет.<br>Напиши первое внизу 👇</div>'; return; }
  $('#tab-tasks').innerHTML = list.map((t) => {
    const a = state.agents[t.agent] || {};
    const open = state.open.has(t.id);
    const steps = open ? `<div class="steps">${t.steps.map((s) => `<div>${state.agents[s.agent]?.emoji || '•'} ${esc(s.text)}</div>`).join('') || '…'}</div>` : '';
    const result = open && t.result ? `<div class="result">${esc(t.result)}</div>` : '';
    const cancel = open && t.status === 'running' ? `<button class="cancel" data-cancel="${t.id}">⛔ Остановить</button>` : '';
    return `<div class="task" data-id="${t.id}">
      <div class="task-head"><span>${a.emoji || ''}</span><div class="txt">${esc(t.text.slice(0, open ? 2000 : 110))}</div><span class="badge ${t.status}">${STATUS_RU[t.status]}</span></div>
      <div class="task-meta"><span>${esc(a.name)}</span><span>${t.source === 'telegram' ? '✈️ Telegram' : '🏢 Офис'}</span><span>${new Date(t.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span></div>
      ${steps}${result}${cancel}</div>`;
  }).join('');
}

$('#tab-tasks').addEventListener('click', async (e) => {
  const c = e.target.closest('[data-cancel]');
  if (c) { e.stopPropagation(); await api(`/api/tasks/${c.dataset.cancel}/cancel`, {}); return; }
  const el = e.target.closest('.task');
  if (!el || e.target.closest('.steps,.result')) return;
  const id = el.dataset.id;
  state.open.has(id) ? state.open.delete(id) : state.open.add(id);
  renderTasks();
});

function renderTeam() {
  $('#tab-team').innerHTML = Object.values(state.agents).map((a) => `
    <div class="member" data-agent="${a.id}">
      <div class="avatar" style="background:${a.look.shirt}55">${a.emoji}</div>
      <div><b>${esc(a.name)}</b><small>${esc(a.role)}</small>
      <div class="act"><span class="dot ${a.state.status}"></span>${esc(a.state.activity)}</div></div>
    </div>`).join('');
}
$('#tab-team').addEventListener('click', (e) => {
  const m = e.target.closest('[data-agent]');
  if (m) { office.selected = m.dataset.agent; showCard(m.dataset.agent); }
});

function addLog(entry) {
  const feed = $('#tab-feed');
  const a = state.agents[entry.agent];
  const el = document.createElement('div');
  el.className = 'log ' + entry.kind;
  el.innerHTML = `<time>${new Date(entry.t).toLocaleTimeString('ru-RU')}</time><span>${a?.emoji || '•'} <b>${esc(a?.name || entry.agent)}</b> ${esc(entry.text)}</span>`;
  feed.prepend(el);
  while (feed.children.length > 200) feed.lastChild.remove();
}

function showCard(id) {
  const card = $('#card');
  const a = state.agents[id];
  if (!a) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  card.innerHTML = `
    <button class="x" data-close>✕</button>
    <h3>${a.emoji} ${esc(a.name)}</h3>
    <div class="role">${esc(a.role)}</div>
    <div><span class="dot ${a.state.status}"></span>${esc(a.state.activity)}</div>
    <div class="tools">${a.tools.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
    <button data-assign="${a.id}">Дать задание ${esc(a.name)}</button>`;
}
$('#card').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { $('#card').classList.add('hidden'); office.selected = null; }
  const as = e.target.closest('[data-assign]');
  if (as) { $('#cmdAgent').value = as.dataset.assign; $('#cmdText').focus(); }
});

document.querySelectorAll('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + b.dataset.tab));
  })
);

$('#cmdForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#cmdText').value.trim();
  if (!text) return;
  $('#cmdText').value = '';
  const r = await api('/api/tasks', { text, agent: $('#cmdAgent').value });
  if (r.task) { state.open.add(r.task.id); state.tasks.set(r.task.id, r.task); renderTasks(); }
  tg?.HapticFeedback?.impactOccurred('light');
});

function toast(text, err) {
  const el = document.createElement('div');
  el.className = 'toast';
  if (err) el.style.borderLeftColor = 'var(--red)';
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 5000);
}

setInterval(async () => {
  if (ws?.readyState === 1) renderStats((await api('/api/state')).stats);
}, 15000);

// ---------- старт ----------
document.fonts?.ready.then(() => (office.bg = null));
(async () => {
  if (tg?.initData) {
    try { await login({ initData: tg.initData }); } catch {}
  }
  if (!token) return showLogin();
  connect();
})();

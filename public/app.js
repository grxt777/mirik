import { Office, avatarURL } from './office.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const AGENT_STATUS = { idle: 'свободен', thinking: 'думает', working: 'работает', managing: 'раздаёт задачи', paused: 'на паузе' };
const ACTIVE = new Set(['running', 'queued', 'paused']);
const TASK_STATUS = { running: ['в работе', 'working'], queued: ['в очереди', 'thinking'], paused: ['на паузе', 'paused'], done: ['готово', 'done'], failed: ['ошибка', 'failed'], cancelled: ['отменено', 'cancelled'], interrupted: ['прервано', 'failed'] };
const state = { agents: {}, departments: {}, tasks: new Map(), openSteps: new Set(), to: 'mirik', stats: null };
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
    loadUsage();
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
      state.departments = e.departments || {};
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
    case 'render': office.setRender(e); break;
    case 'report': office.report(e.from); break;
    case 'log': addLog(e.entry); break;
  }
}

const pending = new Set();
function scheduleRender(what) {
  if (!pending.size) requestAnimationFrame(() => {
    if (pending.has('agents')) { renderCrew(); renderTeam(); if (office.selected) showCard(office.selected); }
    renderStats();
    renderPopup();
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
  office.running = list.filter((t) => ACTIVE.has(t.status)).length;
  office.done = list.filter((t) => t.status === 'done').length;
  $('#sRunning').textContent = office.running;
  $('#pRunning').classList.toggle('active', office.running > 0);
  if (state.stats) $('#sDone').textContent = Math.max(state.stats.tasksDone, office.done);
}

const statusColor = (s) => ({ thinking: '#f1c40f', working: '#2ecc71', managing: '#ff9f43', paused: '#74b9ff' })[s] || '#7d7896';

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
      <div class="card-id"><h3>${esc(a.name)}</h3><div class="role">${esc(a.role)} · ${esc(state.departments[a.dept]?.name || '')}</div>
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
  const running = ACTIVE.has(t.status);
  const last = t.steps.at(-1);
  const steps = t.steps.length
    ? `<details class="steps" data-steps="${t.id}" ${state.openSteps.has(t.id) ? 'open' : ''}><summary>Ход работы · ${t.steps.length}</summary><ol>${t.steps.map(stepLine).join('')}</ol></details>`
    : '';
  let body;
  if (running) {
    const la = last && state.agents[last.agent];
    body = `<div class="typing"><span></span><span></span><span></span></div>${last ? `<div class="live">${la?.emoji || ''} ${esc(la?.name || '')}: ${esc(plain(last.text).slice(0, 140))}</div>` : ''}`;
  } else body = `<div class="md">${md(t.result || (t.status === 'cancelled' ? 'Остановлено.' : '—'))}</div>`;
  const [stLabel, stCls] = TASK_STATUS[t.status] || ['', ''];
  const status = t.status !== 'done' && stLabel ? `<span class="status ${stCls}">${stLabel}</span>` : '';
  const actions = `<div class="bubble-actions">${taskButtons(t, false)}</div>`;
  return `<div class="msg me"><div><div class="bubble">${esc(t.text)}</div><div class="meta"><span>${src}</span>${to}<span>${time}</span></div></div></div>
    <div class="msg bot"><img class="ava" src="${avatarURL(a.id, a.look)}" alt="">
      <div class="bubble ${t.status === 'failed' ? 'failed' : ''}"><div class="who">${esc(a.name)} ${status}</div>${body}${steps}${actions}</div></div>`;
}

// Кнопки управления задачей — одинаковые в чате и во всплывающем окне
function taskButtons(t, withOpen) {
  const open = withOpen ? `<button data-act="open" data-id="${t.id}">💬 В чат</button>` : '';
  if (ACTIVE.has(t.status)) {
    const pr = t.status === 'paused' ? `<button class="go" data-act="resume" data-id="${t.id}">▶ Продолжить</button>` : `<button data-act="pause" data-id="${t.id}">⏸ Пауза</button>`;
    return `${pr}<button class="stop" data-act="cancel" data-id="${t.id}">⛔ Отменить</button>${open}`;
  }
  return `<button data-act="retry" data-id="${t.id}">↻ Повторить</button>${open}<button data-act="copy" data-id="${t.id}">📋 Копировать</button>`;
}

async function taskAction(act, id, btn) {
  const t = state.tasks.get(id);
  if (!t) return;
  if (act === 'copy') { await navigator.clipboard?.writeText(t.result || ''); toast('Скопировано'); return; }
  if (act === 'retry') { closePopup(); switchTab('chat'); await send(t.text, t.agent); return; }
  if (act === 'open') { closePopup(); openInChat(id); return; }
  if (btn) btn.disabled = true;
  const r = await api(`/api/tasks/${id}/${act}`, {});
  if (!r.ok) toast('Задача уже не выполняется', true);
  else toast({ pause: '⏸ Пауза — сотрудники доделают текущий шаг и замрут', resume: '▶ Продолжаем', cancel: '⛔ Отменяю…' }[act]);
}

function openInChat(id) {
  switchTab('chat');
  $('#app').classList.remove('expanded');
  const el = $(`#chat [data-task="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1600);
}

// ---------- всплывающее окно «В работе / Готово» ----------
const pop = { open: false, tab: 'active', timer: null };
const fmtDur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} с` : s < 3600 ? `${Math.floor(s / 60)} мин ${s % 60} с` : `${Math.floor(s / 3600)} ч ${Math.floor((s % 3600) / 60)} мин`; };

function popItem(t) {
  const a = state.agents[t.agent] || {};
  const who = [...new Set(t.steps.map((s) => s.agent))].map((id) => state.agents[id]).filter(Boolean);
  const last = t.steps.at(-1);
  const [stLabel, stCls] = TASK_STATUS[t.status] || ['', ''];
  const active = ACTIVE.has(t.status);
  const time = active ? `идёт ${fmtDur(Date.now() - t.createdAt)}` : `${new Date(t.finishedAt || t.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · ${fmtDur((t.finishedAt || Date.now()) - t.createdAt)}`;
  const detail = active
    ? (last ? `${state.agents[last.agent]?.emoji || '•'} ${esc(plain(last.text).slice(0, 140))}` : 'ждёт начала')
    : esc(plain(t.result || '—').slice(0, 160));
  return `<div class="pitem ${t.status}">
    <div class="pitem-top"><img src="${avatarURL(a.id, a.look)}" alt=""><div class="pitem-text">${esc(t.text.slice(0, 140))}</div><span class="status ${stCls}">${stLabel}</span></div>
    <div class="pitem-meta"><span>${time}</span>${who.length ? `<span class="who-row">${who.map((w) => `<img title="${esc(w.name)}" src="${avatarURL(w.id, w.look)}" alt="">`).join('')}</span>` : ''}</div>
    <div class="pitem-detail">${detail}</div>
    <div class="bubble-actions">${taskButtons(t, true)}</div>
  </div>`;
}

function renderPopup() {
  if (!pop.open) return;
  const all = [...state.tasks.values()];
  const active = all.filter((t) => ACTIVE.has(t.status)).sort((a, b) => b.createdAt - a.createdAt);
  const done = all.filter((t) => !ACTIVE.has(t.status)).sort((a, b) => (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt)).slice(0, 30);
  $('#popActiveN').textContent = active.length;
  $('#popDoneN').textContent = done.length;
  document.querySelectorAll('[data-ptab]').forEach((b) => b.classList.toggle('on', b.dataset.ptab === pop.tab));
  const list = pop.tab === 'active' ? active : done;
  $('#tasksPopBody').innerHTML = list.length ? list.map(popItem).join('') : `<div class="empty">${pop.tab === 'active' ? 'Сейчас ничего не выполняется 😴' : 'Готовых задач пока нет'}</div>`;
}

function openPopup(tab) {
  pop.open = true;
  pop.tab = tab;
  $('#tasksPop').classList.remove('hidden');
  $('#popShade').classList.remove('hidden');
  renderPopup();
  clearInterval(pop.timer);
  pop.timer = setInterval(() => pop.tab === 'active' && renderPopup(), 1000); // «идёт 1 мин 12 с»
}
function closePopup() {
  pop.open = false;
  clearInterval(pop.timer);
  $('#tasksPop').classList.add('hidden');
  $('#popShade').classList.add('hidden');
}
document.querySelectorAll('[data-tasks]').forEach((b) => b.addEventListener('click', () => (pop.open && pop.tab === b.dataset.tasks ? closePopup() : openPopup(b.dataset.tasks))));
document.querySelectorAll('[data-ptab]').forEach((b) => b.addEventListener('click', () => { pop.tab = b.dataset.ptab; renderPopup(); }));
$('#popShade').addEventListener('click', closePopup);
$('[data-popclose]').addEventListener('click', closePopup);
addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopup(); });
$('#tasksPop').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) taskAction(b.dataset.act, b.dataset.id, b); });

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
  const b = e.target.closest('[data-act]');
  if (b) taskAction(b.dataset.act, b.dataset.id, b);
});
$('#v-chat').addEventListener('scroll', () => { if (nearBottom()) $('#jump').classList.add('hidden'); });
$('#jump').addEventListener('click', () => scrollChat(true));

// ---------- команда ----------
function renderTeam() {
  const tasks = [...state.tasks.values()];
  let lastDept = null;
  $('#v-team').innerHTML = Object.values(state.agents).map((a) => {
    const d = state.departments[a.dept];
    const head = a.dept !== lastDept && d ? `<div class="dept-head">${d.emoji} ${esc(d.name)}${a.dept !== 'hq' ? `<button class="dept-go" data-area="${a.dept}">📍 на карте</button>` : ''}</div>` : '';
    lastDept = a.dept;
    const done = tasks.reduce((n, t) => n + t.steps.filter((s) => s.agent === a.id && s.text.startsWith('✅')).length, 0);
    return `${head}<div class="member">
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
  const ar = e.target.closest('[data-area]');
  if (ar) office.goToArea(ar.dataset.area);
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
  if (tab === 'budget') loadUsage();
  $('#composer').classList.toggle('hidden', tab === 'feed' || tab === 'budget');
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

// ---------- композер ----------
function renderTo() {
  let lastDept = null;
  $('#to').innerHTML = Object.values(state.agents).map((a) => {
    const sep = lastDept && a.dept !== lastDept ? `<span class="sep">${state.departments[a.dept]?.emoji || '·'}</span>` : '';
    lastDept = a.dept;
    return `${sep}<button type="button" data-to="${a.id}" class="${state.to === a.id ? 'on' : ''}"><img src="${avatarURL(a.id, a.look)}" alt="">${esc(a.name)}</button>`;
  }).join('');
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

// ---------- бюджет ----------
const money = (n) => (n == null ? '—' : '$' + (Math.abs(n) >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : n.toFixed(4)));
const bigNum = (n) => (n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' млрд' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' млн' : n >= 1e3 ? Math.round(n / 1e3) + ' тыс.' : String(Math.round(n)));
const todayKey = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });

async function loadUsage() {
  try {
    const r = await api('/api/usage');
    state.usage = r;
    renderBalancePill();
    if (!$('#v-budget').classList.contains('hidden')) renderBudget();
  } catch (e) {
    if (e.message !== 'auth') $('#v-budget').innerHTML = `<div class="empty">Не удалось загрузить: ${esc(e.message)}</div>`;
  }
}

function balanceLevel(b) { return b < 1 ? 'critical' : b < 3 ? 'warning' : 'good'; }

function renderBalancePill() {
  const or = state.usage?.openrouter;
  if (!or || or.error) return;
  $('#sBalance').textContent = money(or.balance);
  $('#pBalance').dataset.level = balanceLevel(or.balance);
}

function lastDays(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    out.push(d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' }));
  }
  return out;
}

function barsHTML(points, fmt) {
  const max = Math.max(...points.map((p) => p.v), 0);
  const bars = points.map((p, i) => {
    const h = max > 0 ? Math.max(p.v > 0 ? 3 : 0, (p.v / max) * 100) : 0;
    const label = i % 3 === (points.length - 1) % 3 ? p.label : '';
    return `<div class="b" data-tip="${esc(p.tip)}"><i style="height:${h}%"></i><span>${label}</span></div>`;
  }).join('');
  return `<div class="chart"><div class="chart-max">${max > 0 ? 'макс. ' + fmt(max) : 'пока нет данных'}</div><div class="bars">${bars}</div></div>`;
}

function renderBudget() {
  const r = state.usage;
  if (!r) return;
  const or = r.openrouter, est = r.estimate, m = r.mirik;
  const parts = [];
  if (or.error) parts.push(`<section class="bcard"><h4>Баланс OpenRouter</h4><div class="empty">Недоступен: ${esc(or.error)}</div></section>`);
  else {
    const usedPct = or.totalCredits > 0 ? Math.min(100, (or.totalUsage / or.totalCredits) * 100) : 0;
    const lvl = balanceLevel(or.balance);
    const lvlText = { good: '✓ всё в порядке', warning: '⚠ скоро закончится', critical: '⛔ почти пусто — пополни' }[lvl];
    parts.push(`<section class="bcard hero">
      <div class="eyebrow">Баланс OpenRouter</div>
      <div class="big">${money(or.balance)}</div>
      <div class="meter"><i style="width:${usedPct.toFixed(1)}%"></i></div>
      <div class="sub">потрачено ${money(or.totalUsage)} из ${money(or.totalCredits)} · <span class="lvl ${lvl}">${lvlText}</span></div>
      <div class="kpis">
        <div><b>≈ ${bigNum(est?.tokensLeft)}</b><span>токенов хватит</span></div>
        <div><b>${est?.tasksLeft ? '≈ ' + bigNum(est.tasksLeft) : '—'}</b><span>заданий хватит</span></div>
        <div><b>${money(est?.avgTaskCost)}</b><span>среднее задание</span></div>
      </div>
      ${or.keyLimit != null ? `<div class="note">У ключа Мирика свой лимит: осталось ${money(or.keyRemaining)} из ${money(or.keyLimit)}. Сегодня по ключу ${money(or.keyUsageDaily)}, за месяц ${money(or.keyUsageMonthly)}.</div>` : ''}
    </section>`);
  }
  const days = lastDays(14);
  const today = m.daily[todayKey()] || {};
  parts.push(`<section class="bcard">
    <h4>👑 Мирик — расход по дням</h4>
    <div class="kpis small">
      <div><b>${money(today.cost || 0)}</b><span>сегодня</span></div>
      <div><b>${bigNum(today.tokens || 0)}</b><span>токенов сегодня</span></div>
      <div><b>${money(m.cost)}</b><span>всего</span></div>
    </div>
    ${barsHTML(days.map((d) => {
      const x = m.daily[d] || {};
      const dd = new Date(d + 'T12:00:00');
      return { v: x.cost || 0, label: dd.getDate(), tip: `${dd.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}: ${money(x.cost || 0)} · ${bigNum(x.tokens || 0)} токенов · ${x.calls || 0} запросов` };
    }), money)}
    <div class="note">Всего ${bigNum(m.tokens)} токенов. Входные (агенты читают страницы и контекст): ${bigNum(m.prompt)}, выходные: ${bigNum(m.completion)}${m.prompt + m.completion < m.tokens * 0.95 ? ' — разбивка на вход/выход ведётся с 25 октября' : ''}.</div>
  </section>`);
  const agents = Object.values(state.agents);
  const maxCost = Math.max(...agents.map((a) => m.byAgent[a.id]?.cost || 0), 0);
  parts.push(`<section class="bcard"><h4>Кто сколько тратит</h4>
    ${agents.map((a) => {
      const x = m.byAgent[a.id] || {};
      const w = maxCost > 0 ? ((x.cost || 0) / maxCost) * 100 : 0;
      return `<div class="spend"><img src="${avatarURL(a.id, a.look)}" alt=""><div class="spend-main"><div class="spend-top"><b>${esc(a.name)}</b><span>${money(x.cost || 0)} · ${bigNum(x.tokens || 0)} ток.</span></div><div class="hbar"><i style="width:${w}%"></i></div></div></div>`;
    }).join('')}
    ${Object.keys(m.byAgent).length ? '' : '<div class="note">Разбивка по агентам начнёт копиться с новых заданий.</div>'}
  </section>`);
  const s = r.sanya;
  if (s.error) parts.push(`<section class="bcard"><h4>🤝 Саня</h4><div class="note">Нет данных: ${esc(s.error)}</div></section>`);
  else {
    const models = Object.entries(s.by_model).sort((a, b) => b[1].total - a[1].total);
    const total = models.reduce((n, [, x]) => n + x.total, 0);
    const todayS = s.by_day[todayKey()] || 0;
    parts.push(`<section class="bcard"><h4>🤝 Саня — 14 дней</h4>
      <div class="kpis small"><div><b>${bigNum(todayS)}</b><span>токенов сегодня</span></div><div><b>${bigNum(total)}</b><span>за 14 дней</span></div><div><b>$0</b><span>с OpenRouter</span></div></div>
      <table class="tbl"><thead><tr><th>Модель</th><th>Запросов</th><th>Токенов</th><th></th></tr></thead><tbody>
      ${models.map(([name, x]) => `<tr><td>${esc(name)}</td><td>${x.calls}</td><td>${bigNum(x.total)}</td><td class="muted">${name.includes('/') ? (name.endsWith(':free') ? 'бесплатно' : 'OpenRouter') : 'Google Gemini'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Пока пусто</td></tr>'}
      </tbody></table>
      <div class="note">Саня работает на Gemini от Google и бесплатных моделях — баланс OpenRouter он не тратит.</div>
    </section>`);
  }
  if (r.price) {
    const p4 = (n) => '$' + n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    const basis = { real7d: 'по твоим реальным тратам за 7 дней', real: 'по твоим реальным тратам', list: 'по прайсу провайдера' }[est?.basis] || '';
    parts.push(`<section class="bcard"><h4>💲 Цена ${esc(r.model)}</h4>
      <div class="kpis small">
        <div><b>${est ? p4(est.blendedPerM) : '—'}</b><span>за 1 млн токенов — фактически</span></div>
        <div><b>${p4(r.price.prompt)}</b><span>1 млн входных</span></div>
        <div><b>${p4(r.price.completion)}</b><span>1 млн выходных</span></div>
      </div>
      <div class="note">Запросы идут к самому дешёвому провайдеру — сейчас это ${esc(r.price.provider)}. Если он недоступен, OpenRouter сам берёт следующего по цене.${r.price.official ? ` Официальная цена Z.AI для сравнения: ${p4(r.price.official.prompt)} / ${p4(r.price.official.completion)}.` : ''} Прогноз «на сколько хватит» посчитан ${basis}.</div>
      <div class="note">Обновлено ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div></section>`);
  }
  $('#v-budget').innerHTML = parts.join('');
}

// подсказка над столбиками
const tip = document.createElement('div');
tip.className = 'tip hidden';
document.body.append(tip);
$('#v-budget').addEventListener('pointerover', (e) => {
  const b = e.target.closest('[data-tip]');
  if (!b) return tip.classList.add('hidden');
  tip.textContent = b.dataset.tip;
  tip.classList.remove('hidden');
  const r = b.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, r.left + r.width / 2 - tip.offsetWidth / 2)) + 'px';
  tip.style.top = r.top - tip.offsetHeight - 8 + 'px';
});
$('#v-budget').addEventListener('pointerleave', () => tip.classList.add('hidden'));
$('#pBalance').addEventListener('click', () => { switchTab('budget'); $('#app').classList.remove('expanded'); });
setInterval(loadUsage, 60000);

// ---------- офис: кнопки ----------
document.querySelector('.world-tools').addEventListener('click', (e) => {
  const z = e.target.closest('[data-z]')?.dataset.z;
  if (z === 'in') office.zoomBy(1.35);
  if (z === 'out') office.zoomBy(1 / 1.35);
  if (z === 'fit') office.fit();
  if (z === 'expand') $('#app').classList.toggle('expanded');
  const area = e.target.closest('[data-area]')?.dataset.area;
  if (area) office.goToArea(area);
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
  loadUsage();
})();

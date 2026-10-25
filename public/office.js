// Игровой офис: карта, мебель, пиксельные персонажи, поиск пути и поведение.
export const T = 32;
export const W = 24;
export const H = 17;

const FONT = '"Pixelify Sans", monospace';

// ---------- карта ----------
const blocked = new Set();
const key = (x, y) => x + ',' + y;
const block = (x, y, w = 1, h = 1) => {
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) blocked.add(key(x + i, y + j));
};
for (let x = 0; x < W; x++) { block(x, 0); block(x, 1); block(x, H - 1); }
for (let y = 0; y < H; y++) { block(0, y); block(W - 1, y); }
// стекло кабинета Мирика (дверь в (19,7))
for (let y = 2; y <= 7; y++) block(15, y);
for (let x = 15; x < W; x++) if (x !== 19) block(x, 7);

const furniture = [];
function add(kind, x, y, w = 1, h = 1, extra = {}) {
  furniture.push({ kind, x, y, w, h, ...extra });
  if (!extra.walkable) block(x, y, w, h);
}
add('bookshelf', 21, 2, 2, 1);
add('plant', 16, 2);
add('couch', 16, 5, 2, 1);
add('plant', 1, 2);
add('plant', 14, 2);
add('printer', 13, 4);
add('cooler', 13, 9);
add('meeting', 17, 9, 4, 2);
add('sofa', 11, 15, 3, 1);
add('plant', 1, 15);
add('plant', 14, 15);
add('counter', 18, 15, 5, 1);
add('fridge', 22, 13, 1, 2);
add('bistro', 16, 13);
add('pingpong', 4, 13, 3, 1);
add('arcade', 1, 8);

const POIS = [
  { x: 20, y: 14, say: '☕ кофе', who: 'all' },
  { x: 19, y: 14, say: '☕ эспрессо', who: 'all' },
  { x: 12, y: 9, say: '💧 водичка', who: 'staff' },
  { x: 12, y: 14, say: '🛋 перерыв', who: 'staff' },
  { x: 3, y: 2, say: '🌤 красота', who: 'staff' },
  { x: 8, y: 2, say: '🌤 смотрю в окно', who: 'staff' },
  { x: 12, y: 4, say: '🖨 печатаю', who: 'staff' },
  { x: 21, y: 13, say: '🍪 печенька', who: 'all' },
  { x: 17, y: 11, say: '🗣 обсуждаем', who: 'all' },
  { x: 2, y: 14, say: '🌱 полить', who: 'staff' },
  { x: 3, y: 13, say: '🏓 пинг!', who: 'staff' },
  { x: 7, y: 13, say: '🏓 понг!', who: 'all' },
  { x: 2, y: 8, say: '🕹 рекорд!', who: 'staff' },
  { x: 17, y: 2, say: '🌇 думаю о вечном', who: 'mirik' },
  { x: 17, y: 4, say: '📊 планирую', who: 'mirik' },
];

const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !blocked.has(key(x, y));

function findPath(sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  const prev = new Map([[key(sx, sy), null]]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    if (x === tx && y === ty) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (prev.has(k) || (!free(nx, ny) && !(nx === tx && ny === ty))) continue;
      prev.set(k, [x, y]);
      q.push([nx, ny]);
    }
  }
  if (!prev.has(key(tx, ty))) return [];
  const path = [];
  for (let c = [tx, ty]; c && !(c[0] === sx && c[1] === sy); c = prev.get(key(c[0], c[1]))) path.unshift(c);
  return path;
}

const tileFeet = (tx, ty) => ({ x: (tx + 0.5) * T, y: (ty + 0.75) * T });

// ---------- персонаж ----------
function drawChar(c, fx, fy, look, o) {
  const u = 2;
  const sit = o.sitting ? 4 : 0;
  const bob = o.walking ? Math.abs(Math.sin(o.t * 12)) * 1.2 : o.sitting ? 0 : Math.sin(o.t * 2) * 0.3;
  const ox = Math.round(fx - 6 * u);
  const oy = Math.round(fy - 20 * u + sit * u - bob * u);
  const r = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(ox + x * u, oy + y * u, w * u, h * u); };
  const back = o.dir === 'up';
  const side = o.dir === 'left' ? -1 : o.dir === 'right' ? 1 : 0;

  if (!o.sitting) {
    c.fillStyle = 'rgba(0,0,0,.28)';
    c.beginPath(); c.ellipse(fx, fy, 7 * u, 2 * u, 0, 0, Math.PI * 2); c.fill();
    const ph = o.walking ? Math.sin(o.t * 12) : 0;
    const pants = look.pants || '#2d3142';
    r(3, 16, 2.5, 4 - Math.max(0, ph) * 1.2, pants);
    r(6.5, 16, 2.5, 4 - Math.max(0, -ph) * 1.2, pants);
    r(3, 19 - Math.max(0, ph) * 1.2, 2.5, 1, '#15151c');
    r(6.5, 19 - Math.max(0, -ph) * 1.2, 2.5, 1, '#15151c');
  }
  // руки
  const tA = o.typing ? Math.sin(o.t * 22) * 0.7 : 0;
  const swing = o.walking ? Math.sin(o.t * 12) * 1 : 0;
  r(1, 9 + swing, 1.6, 6, look.shirt);
  r(9.4, 9 - swing, 1.6, 6, look.shirt);
  r(1, 14.4 + swing + tA, 1.6, 1.4, look.skin);
  r(9.4, 14.4 - swing - tA, 1.6, 1.4, look.skin);
  // туловище
  r(2.4, 9, 7.2, 7.4, look.shirt);
  r(8.2, 9, 1.4, 7.4, 'rgba(0,0,0,.15)');
  if (look.tie && !back) { r(5.5, 9, 1, 0.8, '#fff'); r(5.6, 9.6, 0.9, 4.6, look.tie); }
  r(5, 8, 2, 1.2, look.skin);
  // голова
  r(3, 2, 6, 6.4, look.skin);
  r(3, 1, 6, 2.2, look.hair);
  if (back) r(3, 1, 6, 6.6, look.hair);
  else {
    r(3, 2.4, 1, 2.6, look.hair);
    r(8, 2.4, 1, 2.6, look.hair);
    if (look.longHair) { r(2.2, 2.4, 1.4, 8, look.hair); r(8.4, 2.4, 1.4, 8, look.hair); }
    const eh = o.blink ? 0.3 : 1.1;
    r(4.4 + side * 0.6, 5 + (1.1 - eh) / 2, 1, eh, '#1a1a22');
    r(6.6 + side * 0.6, 5 + (1.1 - eh) / 2, 1, eh, '#1a1a22');
    if (look.longHair) { r(3.6, 6.4, 1, 0.6, 'rgba(255,120,140,.45)'); r(7.4, 6.4, 1, 0.6, 'rgba(255,120,140,.45)'); }
    if (look.glasses) {
      c.strokeStyle = '#222'; c.lineWidth = 1;
      c.strokeRect(ox + (3.9 + side * 0.6) * u, oy + 4.5 * u, 2 * u, 2 * u);
      c.strokeRect(ox + (6.1 + side * 0.6) * u, oy + 4.5 * u, 2 * u, 2 * u);
    }
    if (o.talking) r(5.3, 7, 1.4, 0.6, '#7a3b3b');
  }
  if (look.cap) { r(2.6, 0.4, 6.8, 2.2, look.cap); r(side >= 0 ? 4 : 1.6, 2.2, 6.4, 0.8, look.cap); }
  if (look.crown) {
    r(3.6, -1.2, 4.8, 1.4, '#ffd23f');
    r(3.6, -2.4, 1, 1.4, '#ffd23f'); r(5.5, -2.8, 1, 1.8, '#ffd23f'); r(7.4, -2.4, 1, 1.4, '#ffd23f');
    r(5.7, -0.9, 0.6, 0.6, '#e74c3c');
  }
  if (o.glow) {
    const g = c.createRadialGradient(fx, oy + 6 * u, 2, fx, oy + 6 * u, 26);
    g.addColorStop(0, o.glow); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(fx - 26, oy - 20, 52, 52);
  }
}

// ---------- офис ----------
const GLYPHS = {
  timur: ['{ }', '</>', '01', '=>', 'fn()', ';'],
  liza: ['🔎', '📄', 'www', '?', '📚'],
  borya: ['🖱', '🌐', '⌨', '↗', '🔑'],
  nika: ['∑', '✎', 'π', 'A+', '√x', '📐'],
  mirik: ['📣', '✔', '💼', '📊'],
};
const GLOW = { timur: 'rgba(80,200,255,.35)', liza: 'rgba(190,120,255,.35)', borya: 'rgba(90,255,150,.3)', nika: 'rgba(255,120,200,.32)', mirik: 'rgba(255,210,80,.35)' };

export class Office {
  constructor(canvas, { onSelect } = {}) {
    this.cv = canvas;
    this.c = canvas.getContext('2d');
    this.agents = new Map();
    this.particles = [];
    this.selected = null;
    this.hover = null;
    this.onSelect = onSelect;
    this.running = 0;
    this.t = 0;
    this.last = performance.now();
    this.resize();
    addEventListener('resize', () => this.resize());
    canvas.addEventListener('mousemove', (e) => {
      this.hover = this.hit(e);
      canvas.style.cursor = this.hover ? 'pointer' : 'default';
    });
    canvas.addEventListener('click', (e) => {
      const a = this.hit(e);
      this.selected = a?.id || null;
      this.onSelect?.(this.selected);
    });
    requestAnimationFrame((n) => this.frame(n));
  }

  resize() {
    const box = this.cv.parentElement.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    this.scale = Math.min(box.width / (W * T), box.height / (H * T));
    this.cv.style.width = W * T * this.scale + 'px';
    this.cv.style.height = H * T * this.scale + 'px';
    this.cv.width = Math.round(W * T * this.scale * dpr);
    this.cv.height = Math.round(H * T * this.scale * dpr);
    this.px = this.scale * dpr;
    this.bg = null;
  }

  hit(e) {
    const r = this.cv.getBoundingClientRect();
    const x = (e.clientX - r.left) / this.scale, y = (e.clientY - r.top) / this.scale;
    let best = null;
    for (const a of this.agents.values()) {
      if (Math.abs(x - a.x) < 14 && y < a.y + 4 && y > a.y - 44) if (!best || a.y > best.y) best = a;
    }
    return best;
  }

  setAgents(list) {
    for (const def of list) {
      let a = this.agents.get(def.id);
      if (!a) {
        const w = def.id === 'mirik' ? 3 : 2;
        const seatTile = { x: def.desk.x + Math.floor(w / 2), y: def.desk.y - 1 };
        const seat = { x: (def.desk.x + w / 2) * T - (w === 2 ? 8 : 0), y: def.desk.y * T + 8 };
        a = { ...def, w, seatTile, seat, x: seat.x, y: seat.y, path: [], plan: [], sitting: true, dir: 'down', bubble: null, nextGlyph: 0, blinkAt: Math.random() * 4 };
        this.agents.set(def.id, a);
        furniture.push({ kind: 'desk', x: def.desk.x, y: def.desk.y, w, h: 1, owner: def.id });
        block(def.desk.x, def.desk.y, w, 1);
      }
      this.applyState(def.state);
    }
  }

  applyState(s) {
    const a = this.agents.get(s.id);
    if (!a) return;
    const wasBusy = a.busy;
    a.status = s.status;
    a.activity = s.activity;
    a.busy = s.status !== 'idle';
    if (wasBusy !== a.busy && !a.plan.some((p) => p.priority)) a.plan = [];
  }

  delegate(from, to, text) {
    const boss = this.agents.get(from), a = this.agents.get(to);
    if (!a || !boss) return;
    this.say(boss, `${a.name}, на тебе: ${text}`, 5000);
    a.plan = [
      { type: 'goto', tile: { x: 19, y: 5 }, priority: true },
      { type: 'face', dir: 'up', priority: true },
      { type: 'say', text: 'Есть, босс! 🫡', ms: 1600, priority: true },
      { type: 'wait', ms: 1400, priority: true },
    ];
  }

  report(from) {
    const a = this.agents.get(from);
    if (!a || from === 'mirik') return;
    a.plan = [
      { type: 'goto', tile: { x: 18 + Math.floor(Math.random() * 3), y: 5 }, priority: true },
      { type: 'face', dir: 'up', priority: true },
      { type: 'say', text: 'Готово! ✅', ms: 1800, priority: true },
      { type: 'wait', ms: 1600, priority: true },
    ];
    setTimeout(() => this.say(this.agents.get('mirik'), 'Отлично, спасибо! 👍', 2200), 900);
  }

  say(a, text, ms = 3000) {
    if (a) a.bubble = { text, until: this.t + ms / 1000 };
  }

  think(a) {
    if (a.busy) {
      a.plan = [{ type: 'goto', tile: a.seatTile }, { type: 'sit', ms: Infinity }];
      return;
    }
    const pois = POIS.filter((p) => p.who === 'all' || (a.id === 'mirik' ? p.who === 'mirik' : p.who === 'staff'));
    if (Math.random() < 0.45) {
      const p = pois[Math.floor(Math.random() * pois.length)];
      a.plan = [
        { type: 'goto', tile: p },
        { type: 'say', text: p.say, ms: 2500 },
        { type: 'wait', ms: 3000 + Math.random() * 5000 },
        { type: 'goto', tile: a.seatTile },
        { type: 'sit', ms: 6000 + Math.random() * 10000 },
      ];
    } else {
      a.plan = [{ type: 'goto', tile: a.seatTile }, { type: 'sit', ms: 5000 + Math.random() * 9000 }];
    }
  }

  step(a, dt) {
    if (!a.plan.length) this.think(a);
    const act = a.plan[0];
    if (!act) return;
    switch (act.type) {
      case 'goto': {
        a.sitting = false;
        if (!act.started) {
          act.started = true;
          const sx = Math.floor(a.x / T), sy = Math.floor(a.y / T - 0.25);
          a.path = findPath(free(sx, sy) ? sx : a.seatTile.x, free(sx, sy) ? sy : a.seatTile.y, act.tile.x, act.tile.y).map(([x, y]) => tileFeet(x, y));
          if (!free(sx, sy)) a.path.unshift(tileFeet(a.seatTile.x, a.seatTile.y));
        }
        if (this.moveAlong(a, dt)) a.plan.shift();
        break;
      }
      case 'sit': {
        const dx = a.seat.x - a.x, dy = a.seat.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 1) {
          const s = Math.min(d, 90 * dt);
          a.x += (dx / d) * s; a.y += (dy / d) * s;
          return;
        }
        a.sitting = true;
        a.dir = 'down';
        act.left = (act.left ?? act.ms) - dt * 1000;
        if (act.left <= 0) a.plan.shift();
        break;
      }
      case 'wait':
        act.left = (act.left ?? act.ms) - dt * 1000;
        if (act.left <= 0) a.plan.shift();
        break;
      case 'say':
        this.say(a, act.text, act.ms);
        a.plan.shift();
        break;
      case 'face':
        a.dir = act.dir;
        a.plan.shift();
        break;
    }
  }

  moveAlong(a, dt) {
    const target = a.path[0];
    if (!target) { a.walking = false; return true; }
    const dx = target.x - a.x, dy = target.y - a.y;
    const d = Math.hypot(dx, dy);
    const speed = 78 * dt;
    a.walking = true;
    a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    if (d <= speed) { a.x = target.x; a.y = target.y; a.path.shift(); }
    else { a.x += (dx / d) * speed; a.y += (dy / d) * speed; }
    if (!a.path.length) { a.walking = false; return true; }
    return false;
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    for (const a of this.agents.values()) {
      this.step(a, dt);
      if (a.busy && a.sitting && this.t > a.nextGlyph) {
        a.nextGlyph = this.t + 0.5 + Math.random() * 0.6;
        const g = GLYPHS[a.id] || GLYPHS.timur;
        this.particles.push({ x: a.seat.x + (Math.random() - 0.5) * 30, y: a.seat.y - 6, text: g[Math.floor(Math.random() * g.length)], born: this.t, color: GLOW[a.id] });
      }
    }
    this.particles = this.particles.filter((p) => this.t - p.born < 2.2);
    this.draw();
    requestAnimationFrame((n) => this.frame(n));
  }

  // ---------- отрисовка ----------
  sky() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    if (h < 5 || h >= 21) return { top: '#0b1030', bot: '#1d2550', night: true };
    if (h < 7) return { top: '#3b4a8a', bot: '#f6a26b' };
    if (h < 18) return { top: '#5fb6f2', bot: '#bfe6ff' };
    return { top: '#4b3d8f', bot: '#ff8a5b' };
  }

  drawBackground() {
    const cv = document.createElement('canvas');
    cv.width = W * T; cv.height = H * T;
    const c = cv.getContext('2d');
    const sky = this.sky();
    // пол open space — доски
    for (let y = 2; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const office = x >= 16 && y <= 6;
      const kitchen = x >= 16 && y >= 12;
      if (office) c.fillStyle = (x + y) % 2 ? '#4a3355' : '#523a5e';
      else if (kitchen) c.fillStyle = (x + y) % 2 ? '#e9e4da' : '#d8d1c4';
      else c.fillStyle = ((y % 2 ? x + 1 : x) >> 1) % 2 ? '#a77b55' : '#b3875f';
      c.fillRect(x * T, y * T, T, T);
      if (!office && !kitchen) { c.fillStyle = 'rgba(0,0,0,.08)'; c.fillRect(x * T, y * T + T - 2, T, 2); }
    }
    // ковёр в open space
    c.fillStyle = '#3f6b75'; c.fillRect(2 * T, 7 * T + 8, 10 * T, 1 * T + 16);
    c.fillStyle = '#4f818c'; c.fillRect(2 * T + 6, 7 * T + 14, 10 * T - 12, T + 4);
    // ковёр у Мирика
    c.fillStyle = '#7b2d43'; c.fillRect(17 * T, 3 * T - 6, 5 * T, 3 * T);
    c.strokeStyle = '#e0b04a'; c.lineWidth = 2; c.strokeRect(17 * T + 4, 3 * T - 2, 5 * T - 8, 3 * T - 8);
    // стены
    for (let x = 0; x < W; x++) {
      c.fillStyle = x >= 15 ? '#3a3350' : '#e8dcc6'; c.fillRect(x * T, 0, T, 2 * T);
      c.fillStyle = x >= 15 ? '#2a2440' : '#cbbd9f'; c.fillRect(x * T, 2 * T - 6, T, 6);
    }
    c.fillStyle = '#2b2b3a';
    c.fillRect(0, 2 * T, T, H * T); c.fillRect((W - 1) * T, 2 * T, T, H * T);
    c.fillStyle = '#3b3a4f'; c.fillRect(T - 6, 2 * T, 6, (H - 3) * T); c.fillRect((W - 1) * T, 2 * T, 6, (H - 3) * T);
    c.fillStyle = '#2b2b3a';
    c.fillRect(0, 0, 6, H * T); c.fillRect(W * T - 6, 0, 6, H * T); c.fillRect(0, (H - 1) * T + 20, W * T, 12);
    c.fillStyle = '#efe6d4'; c.fillRect(6, (H - 1) * T, W * T - 12, 20);
    // окна
    const win = (x, w) => {
      const g = c.createLinearGradient(0, 8, 0, 52);
      g.addColorStop(0, sky.top); g.addColorStop(1, sky.bot);
      c.fillStyle = '#5b4a3a'; c.fillRect(x - 3, 5, w + 6, 50);
      c.fillStyle = g; c.fillRect(x, 8, w, 44);
      if (sky.night) { c.fillStyle = '#fff'; for (let i = 0; i < 6; i++) c.fillRect(x + ((i * 37) % w), 12 + ((i * 17) % 30), 2, 2); c.fillStyle = '#f4f1c9'; c.beginPath(); c.arc(x + w - 14, 20, 6, 0, 7); c.fill(); }
      else { c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(x + 8, 18, 22, 6); c.fillRect(x + 14, 14, 12, 6); }
      c.fillStyle = '#2b3b52'; c.fillRect(x, 40, w, 12);
      for (let i = 0; i < w; i += 9) { c.fillStyle = '#3c5272'; c.fillRect(x + i, 30 + ((i * 7) % 10), 7, 22); c.fillStyle = sky.night ? '#ffd86b' : '#9fb7d4'; c.fillRect(x + i + 2, 36 + ((i * 7) % 10), 2, 2); }
      c.fillStyle = '#5b4a3a'; c.fillRect(x + w / 2 - 1, 8, 3, 44);
    };
    win(2 * T, 2 * T); win(7 * T + 16, 2 * T); win(11 * T, 2 * T - 8); win(16 * T + 8, T + 16); win(19 * T + 8, T + 8);
    // стеклянная стена кабинета
    c.fillStyle = 'rgba(170,220,255,.18)';
    c.fillRect(15 * T + 10, 2 * T, 12, 6 * T);
    c.fillStyle = 'rgba(200,235,255,.55)'; c.fillRect(15 * T + 10, 2 * T, 2, 6 * T); c.fillRect(15 * T + 20, 2 * T, 2, 6 * T);
    // табличка
    c.fillStyle = '#e0b04a'; c.fillRect(19 * T - 22, 7 * T + 4, 12, 0);
    this.bg = cv;
    this.bgHour = new Date().getHours();
  }

  draw() {
    const c = this.c;
    if (!this.bg || this.bgHour !== new Date().getHours()) this.drawBackground();
    c.setTransform(this.px, 0, 0, this.px, 0, 0);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.bg, 0, 0);
    this.drawWallStuff(c);

    const items = [];
    for (const f of furniture) items.push({ y: (f.y + f.h) * T - 2, draw: () => this.drawFurniture(c, f) });
    items.push({ y: 8 * T - 4, draw: () => this.drawGlassFront(c) });
    for (const a of this.agents.values()) items.push({ y: a.y, draw: () => this.drawAgent(c, a) });
    items.sort((p, q) => p.y - q.y).forEach((i) => i.draw());

    for (const p of this.particles) {
      const k = (this.t - p.born) / 2.2;
      c.globalAlpha = 1 - k;
      c.font = `12px ${FONT}`;
      c.textAlign = 'center';
      c.fillStyle = '#fff';
      c.fillText(p.text, p.x + Math.sin(p.born * 9 + k * 4) * 6, p.y - k * 36);
      c.globalAlpha = 1;
    }
    if (this.sky().night) { c.fillStyle = 'rgba(10,15,40,.28)'; c.fillRect(0, 0, W * T, H * T); }
    for (const a of this.agents.values()) this.drawLabel(c, a);
    for (const a of this.agents.values()) this.drawBubble(c, a);
  }

  drawWallStuff(c) {
    // доска задач
    c.fillStyle = '#6d5844'; c.fillRect(4 * T + 10, 10, 3 * T - 8, 46);
    c.fillStyle = '#f7f7f2'; c.fillRect(4 * T + 13, 13, 3 * T - 14, 40);
    c.font = `11px ${FONT}`; c.textAlign = 'left'; c.fillStyle = '#c0392b';
    c.fillText('ЗАДАЧИ', 4 * T + 18, 26);
    c.fillStyle = '#2c3e50';
    c.fillText(`в работе: ${this.running}`, 4 * T + 18, 39);
    c.fillStyle = '#27ae60'; c.fillText(`готово: ${this.done || 0}`, 4 * T + 18, 50);
    // часы
    const d = new Date(), cx = 10 * T + 4, cy = 30;
    c.fillStyle = '#fff'; c.beginPath(); c.arc(cx, cy, 11, 0, 7); c.fill();
    c.strokeStyle = '#333'; c.lineWidth = 2; c.stroke();
    const hand = (ang, len, w) => { c.lineWidth = w; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(ang) * len, cy - Math.cos(ang) * len); c.stroke(); };
    hand(((d.getHours() % 12) + d.getMinutes() / 60) * Math.PI / 6, 5, 2);
    hand(d.getMinutes() * Math.PI / 30, 8, 1);
    // табличка у кабинета
    c.fillStyle = '#e0b04a'; c.fillRect(17 * T + 6, 2 * T - 26, 64, 14);
    c.fillStyle = '#2a2440'; c.font = `10px ${FONT}`; c.textAlign = 'center'; c.fillText('👑 БОСС', 17 * T + 38, 2 * T - 15);
  }

  drawGlassFront(c) {
    c.fillStyle = 'rgba(170,220,255,.16)';
    c.fillRect(15 * T, 7 * T + 10, 4 * T, 12);
    c.fillRect(20 * T, 7 * T + 10, 3 * T, 12);
    c.fillStyle = 'rgba(210,240,255,.6)';
    c.fillRect(15 * T, 7 * T + 10, 4 * T, 2); c.fillRect(20 * T, 7 * T + 10, 3 * T, 2);
    c.fillStyle = '#9aa7b8'; c.fillRect(19 * T - 3, 7 * T, 3, 24); c.fillRect(20 * T, 7 * T, 3, 24);
  }

  drawFurniture(c, f) {
    const X = f.x * T, Y = f.y * T, w = f.w * T, h = f.h * T;
    const shadow = () => { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(X + 3, Y + h - 4, w - 2, 6); };
    switch (f.kind) {
      case 'desk': {
        const a = this.agents.get(f.owner);
        const boss = f.owner === 'mirik';
        shadow();
        c.fillStyle = boss ? '#5a3a22' : '#8a6a4a'; c.fillRect(X, Y + 2, w, 14);
        c.fillStyle = boss ? '#462c18' : '#6e5238'; c.fillRect(X, Y + 16, w, h - 10);
        c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(X, Y + 2, w, 2);
        // монитор (видим с обратной стороны)
        const mx = X + w - 26;
        if (a?.busy) { c.fillStyle = GLOW[f.owner]; c.beginPath(); c.ellipse(mx + 11, Y - 2, 18, 12, 0, 0, 7); c.fill(); }
        c.fillStyle = '#2b2d36'; c.fillRect(mx, Y - 10, 22, 15);
        c.fillStyle = '#3b3e4a'; c.fillRect(mx + 8, Y + 5, 6, 3); c.fillRect(mx + 5, Y + 7, 12, 2);
        c.fillStyle = '#9aa0ad'; c.fillRect(mx + 9, Y - 5, 4, 4);
        // клавиатура, кружка и бумаги
        c.fillStyle = '#d9dce3'; c.fillRect(X + w / 2 - 22, Y + 8, 18, 5);
        c.fillStyle = '#fff'; c.fillRect(X + 4, Y + 4, 6, 7); c.fillStyle = '#c0392b'; c.fillRect(X + 4, Y + 4, 6, 2);
        if (boss) { c.fillStyle = '#f4f0e6'; c.fillRect(X + 12, Y + 5, 12, 8); c.fillStyle = '#d4cfc4'; c.fillRect(X + 14, Y + 7, 8, 1); }
        if (boss) { c.fillStyle = '#ffd23f'; c.fillRect(X + 30, Y + 6, 10, 4); }
        // кресло за столом (спинка видна, если агент ушёл)
        if (!a?.sitting) { const cx = a ? a.seat.x : X + w / 2; c.fillStyle = '#333846'; c.fillRect(cx - 9, Y - 16, 18, 16); c.fillStyle = '#454b5c'; c.fillRect(cx - 7, Y - 14, 14, 4); }
        break;
      }
      case 'plant':
        c.fillStyle = 'rgba(0,0,0,.2)'; c.beginPath(); c.ellipse(X + 16, Y + 28, 10, 3, 0, 0, 7); c.fill();
        c.fillStyle = '#b5651d'; c.fillRect(X + 8, Y + 16, 16, 13);
        c.fillStyle = '#2e8b57';
        for (const [dx, dy, r] of [[16, 6, 9], [9, 11, 7], [23, 11, 7], [16, 0, 6]]) { c.beginPath(); c.arc(X + dx, Y + dy, r, 0, 7); c.fill(); }
        c.fillStyle = '#3cb371'; c.beginPath(); c.arc(X + 13, Y + 4, 4, 0, 7); c.fill();
        break;
      case 'bookshelf':
        c.fillStyle = '#4a2f1d'; c.fillRect(X, Y - 26, w, h + 22);
        for (let s = 0; s < 3; s++) for (let b = 0; b < 9; b++) {
          c.fillStyle = ['#c0392b', '#2980b9', '#f1c40f', '#27ae60', '#8e44ad', '#e67e22'][(b + s * 2) % 6];
          c.fillRect(X + 4 + b * 6.6, Y - 22 + s * 16, 5, 13);
        }
        break;
      case 'couch':
        shadow();
        c.fillStyle = '#2c5d8f'; c.fillRect(X, Y - 4, w, 12); c.fillStyle = '#3a76b0'; c.fillRect(X + 2, Y + 8, w - 4, 16);
        c.fillStyle = '#244d78'; c.fillRect(X, Y + 2, 6, 22); c.fillRect(X + w - 6, Y + 2, 6, 22);
        break;
      case 'sofa':
        shadow();
        c.fillStyle = '#c0504d'; c.fillRect(X, Y - 2, w, 12); c.fillStyle = '#d9625e'; c.fillRect(X + 2, Y + 10, w - 4, 16);
        c.fillStyle = '#a5403d'; c.fillRect(X, Y + 4, 7, 22); c.fillRect(X + w - 7, Y + 4, 7, 22);
        break;
      case 'printer':
        shadow();
        c.fillStyle = '#d6d9de'; c.fillRect(X + 2, Y + 4, 28, 22); c.fillStyle = '#9aa0a6'; c.fillRect(X + 2, Y + 4, 28, 6);
        c.fillStyle = '#fff'; c.fillRect(X + 8, Y + 14 + Math.sin(this.t * 2) * 1, 16, 6);
        c.fillStyle = '#2ecc71'; c.fillRect(X + 24, Y + 20, 3, 3);
        break;
      case 'cooler':
        shadow();
        c.fillStyle = '#ecf0f1'; c.fillRect(X + 8, Y + 8, 16, 20);
        c.fillStyle = 'rgba(110,190,255,.85)'; c.fillRect(X + 9, Y - 10, 14, 18);
        c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(X + 11, Y - 8, 3, 12);
        break;
      case 'meeting':
        c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(X + 4, Y + h - 6, w - 4, 8);
        for (let i = 0; i < 4; i++) { c.fillStyle = '#3b3f4c'; c.fillRect(X + i * T + 8, Y - 10, 16, 10); c.fillRect(X + i * T + 8, Y + h - 2, 16, 8); }
        c.fillStyle = '#e8e2d6'; c.fillRect(X, Y + 2, w, h - 8); c.fillStyle = '#cfc7b8'; c.fillRect(X, Y + h - 8, w, 6);
        c.fillStyle = '#fff'; c.fillRect(X + 20, Y + 14, 14, 10); c.fillRect(X + 70, Y + 22, 14, 10);
        c.fillStyle = '#34495e'; c.fillRect(X + 48, Y + 18, 20, 12); c.fillStyle = '#5dade2'; c.fillRect(X + 50, Y + 20, 16, 8);
        break;
      case 'counter':
        c.fillStyle = '#6b4f3a'; c.fillRect(X, Y + 4, w, h - 2); c.fillStyle = '#d0d3d4'; c.fillRect(X, Y, w, 8);
        c.fillStyle = '#2c2c2c'; c.fillRect(X + 2 * T + 6, Y - 18, 20, 22);
        c.fillStyle = '#e74c3c'; c.fillRect(X + 2 * T + 10, Y - 14, 4, 3);
        c.fillStyle = '#fff'; c.fillRect(X + 2 * T + 12, Y - 2, 6, 6);
        if (Math.sin(this.t) > 0) { c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(X + 2 * T + 14, Y - 26 - (this.t * 10) % 8, 2, 6); }
        c.fillStyle = '#c0392b'; c.fillRect(X + 3 * T + 8, Y - 6, 16, 10);
        c.fillStyle = '#ff6f61'; c.fillRect(X + 10, Y - 4, 8, 8); c.fillStyle = '#f9e79f'; c.fillRect(X + 22, Y - 4, 8, 8);
        break;
      case 'fridge':
        shadow();
        c.fillStyle = '#dfe6e9'; c.fillRect(X + 2, Y - 20, 28, h + 18);
        c.fillStyle = '#b2bec3'; c.fillRect(X + 2, Y + 10, 28, 2); c.fillRect(X + 24, Y - 12, 2, 16);
        c.fillStyle = '#fdcb6e'; c.fillRect(X + 8, Y - 14, 6, 6);
        break;
      case 'pingpong': {
        shadow();
        c.fillStyle = '#555'; c.fillRect(X + 8, Y + 20, 4, 10); c.fillRect(X + w - 12, Y + 20, 4, 10);
        c.fillStyle = '#1e7a4c'; c.fillRect(X, Y + 2, w, 20); c.fillStyle = '#fff'; c.fillRect(X, Y + 2, w, 1); c.fillRect(X, Y + 11, w, 1);
        c.fillStyle = '#ddd'; c.fillRect(X + w / 2 - 1, Y - 4, 2, 26);
        const bx = X + w / 2 + Math.sin(this.t * 3) * (w / 2 - 8);
        c.fillStyle = '#ff9f43'; c.beginPath(); c.arc(bx, Y + 6 - Math.abs(Math.sin(this.t * 6)) * 10, 2.5, 0, 7); c.fill();
        break;
      }
      case 'arcade':
        shadow();
        c.fillStyle = '#6c3fc4'; c.fillRect(X + 4, Y - 18, 24, 46);
        c.fillStyle = '#111'; c.fillRect(X + 7, Y - 14, 18, 14);
        c.fillStyle = `hsl(${(this.t * 80) % 360},80%,60%)`; c.fillRect(X + 10, Y - 11, 4, 4); c.fillRect(X + 17, Y - 6 + Math.sin(this.t * 4) * 2, 4, 3);
        c.fillStyle = '#e74c3c'; c.fillRect(X + 10, Y + 4, 4, 4); c.fillStyle = '#f1c40f'; c.fillRect(X + 18, Y + 4, 4, 4);
        break;
      case 'bistro':
        c.fillStyle = 'rgba(0,0,0,.2)'; c.beginPath(); c.ellipse(X + 16, Y + 28, 12, 4, 0, 0, 7); c.fill();
        c.fillStyle = '#555'; c.fillRect(X + 14, Y + 14, 4, 14);
        c.fillStyle = '#f5f5f5'; c.beginPath(); c.ellipse(X + 16, Y + 12, 14, 7, 0, 0, 7); c.fill();
        c.fillStyle = '#8e5a3c'; c.fillRect(X + 10, Y + 7, 5, 5);
        break;
    }
  }

  drawAgent(c, a) {
    if (this.selected === a.id || this.hover === a) {
      c.strokeStyle = this.selected === a.id ? '#ffd23f' : 'rgba(255,255,255,.6)';
      c.lineWidth = 2;
      c.beginPath(); c.ellipse(a.x, a.y, 16, 6, 0, 0, 7); c.stroke();
    }
    if (this.t > a.blinkAt + 0.15) a.blinkAt = this.t + 2 + Math.random() * 4;
    drawChar(c, a.x, a.y, a.look, {
      t: this.t + a.x * 0.01,
      walking: a.walking,
      sitting: a.sitting,
      dir: a.sitting ? 'down' : a.dir,
      blink: this.t > a.blinkAt,
      typing: a.sitting && a.status === 'working',
      talking: a.bubble && this.t < a.bubble.until && Math.sin(this.t * 14) > 0,
      glow: a.sitting && a.busy ? GLOW[a.id] : null,
    });
  }

  drawLabel(c, a) {
    c.font = `11px ${FONT}`;
    const text = a.name;
    const w = c.measureText(text).width + 12;
    const y = a.sitting ? a.seat.y + 14 : a.y + 6;
    c.fillStyle = 'rgba(20,18,30,.75)';
    c.beginPath(); c.roundRect(a.x - w / 2, y, w, 14, 7); c.fill();
    const dot = { idle: '#7f8c8d', thinking: '#f1c40f', working: '#2ecc71', managing: '#e67e22' }[a.status] || '#7f8c8d';
    c.fillStyle = dot; c.beginPath(); c.arc(a.x - w / 2 + 7, y + 7, 3, 0, 7); c.fill();
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(text, a.x + 3, y + 11);
  }

  drawBubble(c, a) {
    let text = null;
    if (a.bubble && this.t < a.bubble.until) text = a.bubble.text;
    else if (a.busy && a.sitting) text = a.status === 'thinking' ? '💭 думает' + '.'.repeat(1 + (Math.floor(this.t * 3) % 3)) : a.activity;
    if (!text) return;
    if (text.length > 42) text = text.slice(0, 40) + '…';
    c.font = `11px ${FONT}`;
    const w = Math.min(230, c.measureText(text).width + 14);
    const top = (a.sitting ? a.seat.y - 40 : a.y - 44) - 22;
    const x = Math.max(4, Math.min(W * T - w - 4, a.x - w / 2));
    c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.roundRect(x + 2, top + 2, w, 18, 6); c.fill();
    c.fillStyle = '#fffdf5'; c.beginPath(); c.roundRect(x, top, w, 18, 6); c.fill();
    c.beginPath(); c.moveTo(a.x - 4, top + 18); c.lineTo(a.x + 4, top + 18); c.lineTo(a.x, top + 24); c.fill();
    c.fillStyle = '#222'; c.textAlign = 'left'; c.fillText(text, x + 7, top + 13, w - 12);
  }
}

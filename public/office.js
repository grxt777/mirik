// Игровой офис v2: детальная пиксельная графика, освещение, камера (зум/панорама), агенты и кот.
export const T = 32;
export const W = 36;
// x < 23 — операционный департамент и кабинет Мирика, x = 23 — стена с дверью, x > 23 — студия ютуберов
const STUDIO_X = 24;
const DOOR_Y = 10;
export const H = 29;
// y 16–17 — стена со входами (x=10 из лаунжа, x=30 из студии), y >= 18 — светлый венчурный офис StartupBase
const VC_WALL = 16;
const VC_Y = 18;
const VC_DOORS = [10, 30];
const WW = W * T;
const WH = H * T;
const OUT = '#1b1726';
const UI_FONT = '600 12px Inter, system-ui, sans-serif';

// ---------- утилиты ----------
const px = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
function box(c, x, y, w, h, col, o = {}) {
  if (o.outline !== false) px(c, x - 1, y - 1, w + 2, h + 2, o.outline || OUT);
  px(c, x, y, w, h, col);
  if (o.hi) px(c, x, y, w, o.hiH || 2, o.hi);
  if (o.lo) px(c, x, y + h - (o.loH || 3), w, o.loH || 3, o.lo);
}
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
const ellipse = (c, x, y, rx, ry, col) => { c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); };

// ---------- карта ----------
const blocked = new Set();
const key = (x, y) => x + ',' + y;
const block = (x, y, w = 1, h = 1) => { for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) blocked.add(key(x + i, y + j)); };
for (let x = 0; x < W; x++) { block(x, 0); block(x, 1); block(x, H - 1); }
for (let y = 0; y < H; y++) { block(0, y); block(W - 1, y); }
for (let y = 2; y <= 7; y++) block(15, y);              // стекло кабинета (вертикаль)
for (let x = 16; x < 23; x++) if (x !== 19) block(x, 7); // стекло кабинета (низ), дверь x=19
for (let y = 2; y < VC_WALL; y++) if (y !== DOOR_Y) block(23, y); // стена между департаментами, дверь из переговорки
for (let x = 1; x < W - 1; x++) if (!VC_DOORS.includes(x)) { block(x, VC_WALL); block(x, VC_WALL + 1); } // стена StartupBase

const furniture = [];
function add(kind, x, y, w = 1, h = 1, extra = {}) {
  const f = { kind, x, y, w, h, ...extra };
  furniture.push(f);
  if (!extra.walkable) block(x, y, w, h);
  return f;
}
// open space
add('plant', 1, 2);
add('plant', 14, 2, 1, 1, { big: true });
add('server', 13, 2);
add('printer', 13, 5);
add('cooler', 13, 8);
add('plant', 1, 10, 1, 1, { big: true });
// лаунж
add('rug', 1, 12, 6, 4, { walkable: true, flat: true });
add('coffeetable', 2, 13, 3, 1);
add('sofa', 2, 15, 3, 1);
add('pingpong', 8, 13, 3, 1);
add('arcade', 13, 12);
add('catbed', 12, 15, 1, 1, { walkable: true, flat: true });
add('plant', 14, 15);
add('bookcase', 7, 15, 1, 1);
// кабинет Мирика
add('rug', 17, 3, 5, 3, { walkable: true, flat: true, boss: true });
add('bookshelf', 21, 2, 2, 1);
add('plant', 16, 2, 1, 1, { big: true });
add('couch', 21, 6, 2, 1);
add('plant', 16, 6);
// переговорка
add('meeting', 17, 9, 4, 2);
add('plant', 22, 8);
// кухня
add('counter', 17, 15, 5, 1);
add('fridge', 22, 15);
add('vending', 16, 15);
add('bistro', 18, 13);
add('plant', 22, 12);
// студия Департамента ютуберов
add('greenscreen', 32, 2, 3, 1);
add('ringlight', 33, 5);
add('camera', 34, 6);
add('editbay', 29, 9, 3, 1);
add('rug', 28, 12, 5, 3, { walkable: true, flat: true, studio: true });
add('beanbag', 25, 14, 1, 1, { color: '#e84393' });
add('beanbag', 27, 14, 1, 1, { color: '#00b894' });
add('minifridge', 34, 13);
add('plant', 24, 15);
add('plant', 34, 15, 1, 1, { big: true });
add('plant', 24, 2, 1, 1, { big: true });
add('tripod', 33, 9);
// StartupBase — светлый венчурный офис
add('rug', 13, 23, 6, 4, { walkable: true, flat: true, vc: true });
add('stage', 23, 19, 6, 2, { walkable: true, flat: true });
add('podium', 27, 19);
add('audience', 23, 22, 6, 1);
add('audience', 23, 24, 6, 1);
add('pod', 14, 19, 4, 3);
add('cowork', 2, 24, 4, 1);
add('cowork', 7, 24, 4, 1);
add('sofa', 14, 27, 3, 1, { color: '#5b8def' });
add('coffeetable', 14, 25, 3, 1);
add('coffeebar', 30, 27, 4, 1);
add('booth', 33, 19);
add('booth', 34, 19);
add('flipchart', 20, 20);
add('beanbag', 19, 25, 1, 1, { color: '#ff9f43' });
add('beanbag', 21, 26, 1, 1, { color: '#1abc9c' });
add('plant', 1, 18, 1, 1, { big: true });
add('plant', 13, 18);
add('plant', 21, 18);
add('plant', 34, 23, 1, 1, { big: true });
add('plant', 1, 27);
add('plant', 20, 27);
add('plant', 29, 27, 1, 1, { big: true });

// точки интереса: tile — куда идти, dir — куда смотреть, sit — сесть (px)
const POIS = [
  { x: 19, y: 14, dir: 'down', say: '☕ кофе', who: 'all' },
  { x: 20, y: 14, dir: 'down', say: '🍵 чай', who: 'all' },
  { x: 22, y: 14, dir: 'down', say: '🍪 печенька', who: 'all' },
  { x: 16, y: 14, dir: 'down', say: '🥤 газировка', who: 'staff' },
  { x: 17, y: 13, dir: 'right', say: '🥐 перекус', who: 'all' },
  { x: 12, y: 8, dir: 'right', say: '💧 водичка', who: 'staff' },
  { x: 3, y: 14, dir: 'down', say: '🛋 перерыв', who: 'staff', sit: { x: 3.5 * T, y: 15 * T + 12 } },
  { x: 2, y: 14, dir: 'down', say: '📱 листаю ленту', who: 'staff', sit: { x: 2.5 * T, y: 15 * T + 12 } },
  { x: 4, y: 14, dir: 'down', say: '😌 отдыхаю', who: 'staff', sit: { x: 4.5 * T, y: 15 * T + 12 } },
  { x: 7, y: 13, dir: 'right', say: '🏓 пинг!', who: 'staff' },
  { x: 11, y: 13, dir: 'left', say: '🏓 понг!', who: 'all' },
  { x: 13, y: 13, dir: 'up', say: '🕹 новый рекорд!', who: 'staff' },
  { x: 12, y: 5, dir: 'right', say: '🖨 печатаю', who: 'staff' },
  { x: 3, y: 2, dir: 'up', say: '🌤 красота', who: 'staff' },
  { x: 8, y: 2, dir: 'up', say: '🏙 вид огонь', who: 'staff' },
  { x: 12, y: 2, dir: 'right', say: '🖥 сервер шуршит', who: 'staff' },
  { x: 7, y: 14, dir: 'down', say: '📖 почитаю', who: 'staff' },
  { x: 16, y: 9, dir: 'right', say: '🗣 обсуждаем', who: 'all' },
  { x: 21, y: 10, dir: 'left', say: '📊 созвон', who: 'all' },
  { x: 18, y: 2, dir: 'up', say: '🌇 думаю о вечном', who: 'mirik' },
  { x: 21, y: 3, dir: 'up', say: '📚 перечитываю', who: 'mirik' },
  { x: 17, y: 5, dir: 'right', say: '📞 переговоры', who: 'mirik' },
  // студия
  { x: 33, y: 3, dir: 'down', say: '🎥 пишем дубль', who: 'yt' },
  { x: 32, y: 5, dir: 'right', say: '💡 свет норм?', who: 'yt' },
  { x: 33, y: 13, dir: 'right', say: '⚡ энергетик', who: 'yt' },
  { x: 26, y: 13, dir: 'down', say: '🧠 мозговой штурм', who: 'yt' },
  { x: 30, y: 11, dir: 'up', say: '🎞 смотрю монтаж', who: 'yt' },
  { x: 29, y: 13, dir: 'down', say: '📱 листаю шортсы', who: 'yt' },
  { x: 31, y: 2, dir: 'up', say: '🏆 когда золотая кнопка?', who: 'yt' },
  { x: 21, y: 10, dir: 'right', say: '🚪 к соседям', who: 'yt' },
  // StartupBase
  { x: 24, y: 20, dir: 'down', say: '🎤 разбор на сцене', who: 'vc' },
  { x: 26, y: 21, dir: 'up', say: '👏 сильный питч', who: 'vc' },
  { x: 19, y: 21, dir: 'right', say: '📊 рисую воронку', who: 'vc' },
  { x: 33, y: 21, dir: 'up', say: '📞 созвон с фондом', who: 'vc' },
  { x: 31, y: 26, dir: 'down', say: '☕ флэт уайт', who: 'all' },
  { x: 32, y: 26, dir: 'down', say: '🥐 круассан', who: 'all' },
  { x: 15, y: 26, dir: 'down', say: '🤝 встреча с инвестором', who: 'vc', sit: { x: 15.5 * T, y: 27 * T + 12 } },
  { x: 16, y: 26, dir: 'down', say: '💼 обсуждаем термшит', who: 'vc', sit: { x: 16.5 * T, y: 27 * T + 12 } },
  { x: 4, y: 23, dir: 'down', say: '💻 коворкинг', who: 'all' },
  { x: 9, y: 25, dir: 'up', say: '🧑‍💻 фаундеры пишут', who: 'vc' },
  { x: 18, y: 22, dir: 'up', say: '🗣 переговорка', who: 'vc' },
  { x: 10, y: 18, dir: 'up', say: '🚀 Demo Day скоро', who: 'all' },
];
const CAT_SPOTS = [{ x: 15, y: 24 }, { x: 22, y: 23 }, { x: 6, y: 22 }, { x: 12, y: 14 }, { x: 4, y: 12 }, { x: 18, y: 12 }, { x: 9, y: 11 }, { x: 20, y: 8 }, { x: 5, y: 6 }, { x: 29, y: 12 }, { x: 25, y: 11 }, { x: 33, y: 7 }];
// подписи департаментов (в мировых координатах)
const DEPT_SIGNS = [{ x: 8 * T, y: 2.1 * T, text: '🏢 Операционный департамент' }, { x: 29.5 * T, y: 2.1 * T, text: '🎬 Департамент ютуберов' }, { x: 7 * T, y: 18.15 * T, text: '💼 StartupBase · венчурный офис' }];
export const AREAS = { ops: { x: 11.5 * T, y: 8.5 * T, w: 24 * T, h: 16 * T }, yt: { x: 29.5 * T, y: 8.5 * T, w: 13 * T, h: 16 * T }, vc: { x: 18 * T, y: 22.5 * T, w: 35 * T, h: 13 * T } };

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
      if (prev.has(k) || !free(nx, ny)) continue;
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
function nearestFree(x, y) {
  const tx = Math.floor(x / T), ty = Math.floor(y / T - 0.25);
  if (free(tx, ty)) return [tx, ty];
  for (let r = 1; r < 4; r++) for (const [dx, dy] of [[0, r], [0, -r], [r, 0], [-r, 0], [r, r], [-r, r]]) if (free(tx + dx, ty + dy)) return [tx + dx, ty + dy];
  return [tx, ty];
}

// ---------- персонаж ----------
export function drawChar(c, fx, fy, look, o = {}) {
  const u = 2;
  const dir = o.dir || 'down';
  const sit = !!o.sitting;
  const t = o.t || 0;
  const walk = o.walking ? Math.sin(t * 11) : 0;
  const bob = o.walking ? Math.abs(Math.sin(t * 11)) * 0.8 : sit ? Math.sin(t * 1.6) * 0.15 : Math.sin(t * 2.2) * 0.25;
  const lift = sit ? 5 : 0;
  if (!sit && !o.noShadow) ellipse(c, fx, fy, 8 * u, 2.2 * u, 'rgba(0,0,0,.28)');
  c.save();
  c.translate(Math.round(fx), Math.round(fy));
  if (dir === 'left') c.scale(-1, 1);
  const ox = -7 * u, oy = -23 * u + lift * u - bob * u;
  const parts = [];
  const P = (x, y, w, h, col, ol = true) => parts.push([x, y, w, h, col, ol]);

  const skin = look.skin, skinS = shade(skin, -0.14), hair = look.hair, hairS = shade(hair, -0.3);
  const top = look.jacket || look.shirt, topS = shade(top, -0.22);
  const pants = look.pants || '#2f3447', shoes = '#1d1b24';
  const eh = o.blink ? 0.3 : 1.4;
  const typ = o.typing ? Math.sin(t * 20) * 0.5 : 0;
  const sw = walk * 1.1;

  if (dir === 'down' || dir === 'up') {
    const back = dir === 'up';
    if (!sit) {
      const l1 = Math.max(0, walk) * 1.4, l2 = Math.max(0, -walk) * 1.4;
      P(4.2, 16.5, 2.6, 5 - l1, pants); P(7.2, 16.5, 2.6, 5 - l2, pants);
      P(3.8, 21.2 - l1, 3.2, 1.6, shoes); P(7, 21.2 - l2, 3.2, 1.6, shoes);
    } else if (!back) {
      P(4.2, 16.5, 2.6, 2.4, pants); P(7.2, 16.5, 2.6, 2.4, pants);
    }
    P(1.8, 10.6 + sw, 1.8, 5, top); P(10.4, 10.6 - sw, 1.8, 5, top);
    P(1.8, 15.4 + sw + typ, 1.8, 1.4, skin); P(10.4, 15.4 - sw - typ, 1.8, 1.4, skin);
    P(3.4, 10, 7.2, 6.8, top);
    P(9.2, 10, 1.4, 6.8, topS, false);
    if (!back) {
      if (look.jacket) {
        P(6, 10, 2, 5.6, look.shirt || '#ffffff', false);
        if (look.tie) { P(6.55, 10.3, 0.9, 4.8, look.tie, false); P(6.3, 10.1, 1.4, 0.9, shade(look.tie, -0.2), false); }
        P(5.4, 10, 0.6, 6.6, topS, false); P(8, 10, 0.6, 6.6, topS, false);
      } else P(5.6, 10, 2.8, 0.8, shade(top, -0.32), false);
      if (look.hood) { P(4.6, 10.6, 0.4, 2.4, '#eeeeee', false); P(9, 10.6, 0.4, 2.4, '#eeeeee', false); }
    } else if (look.hood) P(4, 9.4, 6, 2.2, shade(top, -0.12), false);
    P(3.4, 16.2, 7.2, 0.8, '#2a2433', false);
    P(6, 9, 2, 1.4, skinS, false);
    P(3.6, 2.6, 6.8, 6.8, skin);
    P(9.4, 3, 1, 6, skinS, false);
    P(3, 5.6, 0.8, 1.6, skin); P(10.2, 5.6, 0.8, 1.6, skin);
    if (!back) {
      P(5, 6 + (1.4 - eh) / 2, 1, eh, '#1f1a2b', false); P(8, 6 + (1.4 - eh) / 2, 1, eh, '#1f1a2b', false);
      if (!o.blink) { P(5, 6, 0.45, 0.45, '#ffffff', false); P(8, 6, 0.45, 0.45, '#ffffff', false); }
      P(4.8, 4.9, 1.4, 0.5, hairS, false); P(7.8, 4.9, 1.4, 0.5, hairS, false);
      if (o.talking) P(6.3, 8, 1.4, 0.9, '#7a3340', false); else P(6.2, 8.2, 1.6, 0.45, '#b5655a', false);
      if (look.blush) { P(4, 7.4, 1.2, 0.6, 'rgba(255,110,140,.45)', false); P(8.8, 7.4, 1.2, 0.6, 'rgba(255,110,140,.45)', false); }
      if (look.stubble) P(4.4, 7.7, 5.2, 1.5, 'rgba(70,45,30,.22)', false);
      if (look.glasses) {
        for (const lx of [4.4, 7.4]) { P(lx, 5.5, 2.2, 0.4, '#222', false); P(lx, 7.3, 2.2, 0.4, '#222', false); P(lx, 5.5, 0.4, 2.2, '#222', false); P(lx + 1.8, 5.5, 0.4, 2.2, '#222', false); }
        P(6.6, 6.1, 0.8, 0.35, '#222', false);
      }
    }
    // волосы
    const st = look.hairStyle || 'short';
    if (look.cap) {
      if (back) P(3.2, 2.2, 7.6, 5.6, hair);
      P(3, 1.2, 8, 3.2, look.cap);
      P(3, 3.6, 8, 0.8, shade(look.cap, -0.25), false);
      if (look.capBack === back) P(3.6, 4, 6.8, 1, shade(look.cap, -0.3));
      if (!back) { P(3.2, 4.2, 1, 1.6, hair, false); P(9.8, 4.2, 1, 1.6, hair, false); }
    } else if (back) {
      if (st === 'long') P(2.8, 2.4, 8.4, 10.6, hair);
      P(3.2, 1.8, 7.6, 7.2, hair);
      P(3.6, 2.2, 3, 1, shade(hair, 0.15), false);
      P(5, 3.6, 0.5, 4.6, hairS, false); P(7.6, 3.4, 0.5, 5, hairS, false);
      if (st === 'long') { P(4, 9, 0.5, 3.6, hairS, false); P(9.4, 9, 0.5, 3.6, hairS, false); }
    } else {
      if (st === 'long') { P(2.6, 3, 1.8, 9.5, hair); P(9.6, 3, 1.8, 9.5, hair); }
      P(3.2, 1.8, 7.6, 2.6, hair);
      P(3.2, 3.6, 1.2, 2.6, hair, false); P(9.6, 3.6, 1.2, 2.6, hair, false);
      P(4.4, 4, 2.4, 0.8, hair, false);
      P(4, 2.2, 3, 0.8, shade(hair, 0.18), false);
    }
    if (!look.cap) {
      if (st === 'bun') P(5.4, -0.2, 3.2, 2.6, hair);
      if (st === 'spiky') { P(3.6, 1, 1.2, 1.2, hair); P(5.8, 0.5, 1.2, 1.5, hair); P(8, 1, 1.2, 1.2, hair); }
    }
    if (look.headphones) {
      P(3.2, 1.1, 7.6, 0.9, '#2b2b33');
      P(2.1, 5, 1.6, 3, '#2b2b33'); P(10.3, 5, 1.6, 3, '#2b2b33');
      P(2.4, 5.6, 1, 1.6, look.headphones, false); P(10.6, 5.6, 1, 1.6, look.headphones, false);
    }
  } else {
    // вид сбоку (вправо; влево — зеркально)
    const pS = shade(pants, -0.2);
    if (!sit) {
      P(6.6 - walk * 1.6, 16.5, 2.4, 5, pS); P(5.4 + walk * 1.6, 16.5, 2.4, 5, pants);
      P(6.6 - walk * 1.6, 21.2, 3.2, 1.6, shoes); P(5.4 + walk * 1.6, 21.2, 3.2, 1.6, shoes);
    }
    P(4.4, 10, 5.6, 6.8, top);
    P(4.4, 16.2, 5.6, 0.8, '#2a2433', false);
    if (look.jacket) { P(9.2, 10, 0.8, 5.6, look.shirt || '#ffffff', false); if (look.tie) P(9.5, 10.4, 0.6, 4.4, look.tie, false); }
    if (look.hood) P(4.4, 9.6, 2.6, 2, shade(top, -0.12), false);
    P(6.2 + sw, 10.6, 1.9, 5, shade(top, -0.1)); P(6.2 + sw, 15.4, 1.9, 1.4, skin);
    P(6.2, 9, 2, 1.4, skinS, false);
    P(4, 2.6, 6.6, 6.8, skin);
    P(10.5, 6.4, 0.7, 1.1, skin);
    P(8.6, 6 + (1.4 - eh) / 2, 1, eh, '#1f1a2b', false);
    P(8.4, 4.9, 1.4, 0.5, hairS, false);
    P(9, 8.2, 1.2, 0.45, '#b5655a', false);
    P(6, 5.6, 1, 1.6, skinS, false);
    if (look.stubble) P(7.4, 7.7, 3, 1.5, 'rgba(70,45,30,.22)', false);
    if (look.blush) P(8.4, 7.4, 1, 0.6, 'rgba(255,110,140,.45)', false);
    if (look.glasses) { P(8, 5.5, 2.4, 0.4, '#222', false); P(8, 7.3, 2.4, 0.4, '#222', false); P(10.2, 5.5, 0.4, 2.2, '#222', false); P(6.4, 6, 1.8, 0.35, '#222', false); }
    const st = look.hairStyle || 'short';
    if (look.cap) {
      P(3.6, 1.2, 7, 3.2, look.cap);
      if (look.capBack) P(2, 3.6, 2.4, 0.9, shade(look.cap, -0.3)); else P(9.6, 3.6, 2.6, 0.9, shade(look.cap, -0.3));
      P(3.6, 3.6, 2.4, 3, hair, false);
    } else {
      if (st === 'long') P(3.2, 3, 3, 9.5, hair);
      P(3.6, 1.8, 6.8, 2.4, hair);
      P(3.6, 3, 2.6, 4.6, hair, false);
      P(9, 3.6, 1.4, 0.9, hair, false);
      if (st === 'bun') P(3.4, 0, 3, 2.6, hair);
      if (st === 'spiky') { P(4.4, 0.8, 1.4, 1.4, hair); P(6.6, 0.4, 1.4, 1.6, hair); P(8.6, 1, 1.2, 1.2, hair); }
    }
    if (look.headphones) { P(4.6, 1.1, 4.6, 0.9, '#2b2b33'); P(5.4, 5, 1.9, 3, '#2b2b33'); P(5.7, 5.6, 1.2, 1.6, look.headphones, false); }
  }
  if (look.crown) {
    P(4.2, -0.8, 5.6, 1.6, '#ffd23f');
    P(4.2, -2, 1, 1.4, '#ffd23f'); P(6.5, -2.5, 1, 1.9, '#ffd23f'); P(8.8, -2, 1, 1.4, '#ffd23f');
    P(6.6, -0.4, 0.8, 0.8, '#e74c3c', false); P(4.6, -0.5, 0.6, 0.6, '#5dade2', false); P(8.8, -0.5, 0.6, 0.6, '#5dade2', false);
  }
  c.fillStyle = OUT;
  for (const [x, y, w, h, , ol] of parts) if (ol) c.fillRect(ox + x * u - 1, oy + y * u - 1, w * u + 2, h * u + 2);
  for (const [x, y, w, h, col] of parts) { c.fillStyle = col; c.fillRect(ox + x * u, oy + y * u, w * u, h * u); }
  c.restore();
}

// Аватар (голова и плечи) для интерфейса
const avatarCache = new Map();
export function avatarURL(id, look, size = 64) {
  const k = id + size;
  if (avatarCache.has(k)) return avatarCache.get(k);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d');
  const s = size / 30;
  c.scale(s, s);
  drawChar(c, 15, 41, look, { dir: 'down', noShadow: true });
  const url = cv.toDataURL();
  avatarCache.set(k, url);
  return url;
}

function drawCat(c, x, y, o) {
  const f = o.dir === 'left' ? -1 : 1;
  c.save();
  c.translate(Math.round(x), Math.round(y));
  c.scale(f, 1);
  ellipse(c, 0, 0, 10, 3, 'rgba(0,0,0,.25)');
  const orange = '#e8913a', dark = '#b8641e';
  if (o.sleeping) {
    box(c, -9, -8, 18, 8, orange); px(c, -9, -8, 18, 2, '#f3ae62');
    box(c, 4, -11, 7, 6, orange);
    px(c, 4, -13, 2, 2, orange); px(c, 9, -13, 2, 2, orange);
    px(c, 6, -8, 3, 1, OUT);
    px(c, -12, -3, 6, 3, dark);
  } else {
    const step = o.walking ? Math.sin(o.t * 14) * 1.5 : 0;
    px(c, -7, -4 + step, 2, 4, dark); px(c, 4, -4 - step, 2, 4, dark);
    box(c, -8, -11, 15, 7, orange); px(c, -8, -11, 15, 2, '#f3ae62');
    px(c, -5, -11, 2, 7, dark); px(c, -1, -11, 2, 7, dark);
    const tail = Math.sin(o.t * 3) * 3;
    box(c, -12, -17 + tail, 3, 8 - tail, orange);
    box(c, 4, -17, 9, 8, orange);
    px(c, 4, -19, 3, 3, orange); px(c, 10, -19, 3, 3, orange); px(c, 5, -18, 1, 1, '#f7a1b0'); px(c, 11, -18, 1, 1, '#f7a1b0');
    px(c, 9, -14, 1.5, 1.6, OUT); px(c, 12, -12, 1, 1, '#f7a1b0');
  }
  c.restore();
}

// ---------- экраны мониторов ----------
const SCREEN = { timur: 'code', liza: 'search', borya: 'browser', nika: 'doc', mirik: 'dash', vlad: 'trends', arina: 'script', gosha: 'timeline', artem: 'dash', dina: 'sheet', kamila: 'browser', bakhtiyor: 'dash' };
function drawScreen(c, x, y, w, h, kind, busy, t, seed) {
  if (!kind) { px(c, x, y, w, h, '#0e1018'); px(c, x + 2, y + 2, 4, 1, 'rgba(255,255,255,.08)'); return; }
  if (!busy) {
    px(c, x, y, w, h, '#101426');
    const bx = x + 2 + ((Math.sin(t * 0.7 + seed) + 1) / 2) * (w - 8), by = y + 2 + ((Math.cos(t * 0.9 + seed) + 1) / 2) * (h - 7);
    px(c, bx, by, 4, 3, `hsl(${(t * 40 + seed * 50) % 360},70%,60%)`);
    return;
  }
  const r = rng(seed * 97 + Math.floor(t * 2));
  if (kind === 'code') {
    px(c, x, y, w, h, '#14182a');
    const off = Math.floor(t * 6) % 3;
    for (let i = 0; i < 6; i++) {
      const ly = y + 2 + i * 3 - off;
      if (ly < y + 1 || ly > y + h - 2) continue;
      const rr = rng(seed + i + Math.floor(t * 2));
      const ind = Math.floor(rr() * 3) * 2;
      px(c, x + 2 + ind, ly, 3 + rr() * 6, 1.4, ['#ff79c6', '#8be9fd', '#50fa7b', '#f1fa8c'][Math.floor(rr() * 4)]);
      px(c, x + 7 + ind + rr() * 4, ly, rr() * 7, 1.4, '#c8cbe0');
    }
    if (Math.sin(t * 8) > 0) px(c, x + w - 6, y + h - 4, 1, 2, '#fff');
  } else if (kind === 'search') {
    px(c, x, y, w, h, '#f4f6fb');
    px(c, x + 3, y + 2, w - 6, 3, '#dfe4ef'); px(c, x + 4, y + 3, 6 + ((t * 8) % 8), 1, '#7a8199');
    for (let i = 0; i < 3; i++) { px(c, x + 3, y + 7 + i * 3.5, 9, 1.2, '#3b6fe0'); px(c, x + 3, y + 8.6 + i * 3.5, 6 + r() * 10, 0.9, '#9aa1b5'); }
  } else if (kind === 'browser') {
    px(c, x, y, w, h, '#ffffff');
    px(c, x, y, w, 3, '#d9dde7'); px(c, x + 2, y + 1, 2, 1, '#ff5f56'); px(c, x + 5, y + 1, 2, 1, '#ffbd2e');
    px(c, x + 2, y + 5, w - 4, 4, '#4b7bec'); px(c, x + 2, y + 10, (w - 6) / 2, 6, '#dfe6f5'); px(c, x + w / 2 + 1, y + 10, (w - 6) / 2, 6, '#dfe6f5');
    const cx = x + 4 + ((Math.sin(t * 1.3) + 1) / 2) * (w - 8), cy = y + 6 + ((Math.cos(t * 1.7) + 1) / 2) * (h - 9);
    px(c, cx, cy, 1.5, 2.5, '#111');
  } else if (kind === 'doc') {
    px(c, x, y, w, h, '#fffaf0');
    px(c, x + 3, y + 2, 10, 1.6, '#e84393');
    for (let i = 0; i < 4; i++) px(c, x + 3, y + 6 + i * 3, i === 3 ? ((t * 6) % (w - 6)) : w - 6 - (i % 2) * 5, 1, '#6b6478');
    px(c, x + w - 8, y + 2, 5, 3, '#ffeaa7');
  } else if (kind === 'trends') {
    px(c, x, y, w, h, '#181818');
    px(c, x + 2, y + 2, 6, 4, '#ff0033'); px(c, x + 4, y + 3, 2, 2, '#fff');
    let py = y + h - 3;
    for (let i = 0; i < 6; i++) { const ny = y + h - 3 - (i * 2 + ((Math.sin(t * 1.4 + i) + 1) * 1.5)); px(c, x + 3 + i * 3.6, Math.min(py, ny), 2, Math.abs(py - ny) + 1, '#2ecc71'); py = ny; }
    px(c, x + w - 9, y + 2, 7, 1.2, '#aaa');
  } else if (kind === 'script') {
    px(c, x, y, w, h, '#fffdf7');
    px(c, x + 3, y + 2, 8, 1.4, '#e17055');
    for (let i = 0; i < 4; i++) px(c, x + (i % 2 ? 7 : 3), y + 6 + i * 3, i === 3 ? ((t * 7) % (w - 10)) : w - 10 - (i % 2) * 4, 1, i % 2 ? '#636e72' : '#2d3436');
    px(c, x + w - 6, y + 6, 3, 8, 'rgba(255,200,60,.5)');
  } else if (kind === 'sheet') {
    px(c, x, y, w, h, '#ffffff');
    px(c, x, y, w, 3, '#1abc9c');
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
      px(c, x + 1 + k * (w / 4), y + 4 + r * 3.2, w / 4 - 1, 2.6, r === 0 ? '#d5f5ec' : (r + k + Math.floor(t * 2)) % 7 === 0 ? '#ffeaa7' : '#f1f2f6');
    }
  } else if (kind === 'slides') {
    px(c, x, y, w, h, '#f7f7f2');
    const n = Math.floor(t / 2.5) % 3;
    if (n === 0) { px(c, x + 3, y + 3, 12, 2, '#ff9f43'); px(c, x + 3, y + 7, w - 6, 1, '#636e72'); px(c, x + 3, y + 10, w - 10, 1, '#636e72'); }
    else if (n === 1) { for (let i = 0; i < 4; i++) { const bh = 3 + i * 2.5; px(c, x + 4 + i * 5, y + h - 2 - bh, 3, bh, '#ff9f43'); } }
    else { c.fillStyle = '#ff9f43'; c.beginPath(); c.arc(x + w / 2, y + h / 2, 5, 0, Math.PI * 1.3); c.lineTo(x + w / 2, y + h / 2); c.fill(); }
  } else if (kind === 'timeline') {
    px(c, x, y, w, h, '#1b1d26');
    px(c, x + 2, y + 2, w - 4, 6, '#2d3142');
    const cols = ['#ff7a2f', '#2ec4b6', '#6c5ce7', '#ffd23f'];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) px(c, x + 2 + k * 8 + r * 2, y + 9 + r * 2.4, 6, 1.8, cols[(r + k) % 4]);
    px(c, x + 2 + ((t * 6) % (w - 4)), y + 8, 0.8, h - 9, '#fff');
  } else {
    px(c, x, y, w, h, '#151a2c');
    for (let i = 0; i < 5; i++) { const bh = 3 + ((Math.sin(t * 1.5 + i * 1.3) + 1) / 2) * (h - 8); px(c, x + 3 + i * 4, y + h - 2 - bh, 3, bh, i % 2 ? '#ffd23f' : '#5dade2'); }
  }
}

// ---------- офис ----------
const GLYPHS = {
  timur: ['{ }', '</>', '01', '=>', 'fn()', ';'],
  liza: ['🔎', '📄', 'www', '?', '📚'],
  borya: ['🖱', '🌐', '⌨', '↗', '🔑'],
  nika: ['∑', '✎', 'π', 'A+', '√x', '📐'],
  mirik: ['📣', '✔', '💼', '📊'],
  vlad: ['📈', '🔥', '👀', '#'],
  arina: ['✍️', '🎬', '💡', '“ ”'],
  gosha: ['🎞', '✂️', '▶', '🎧'],
  artem: ['📊', '🔍', 'TAM', '📈'],
  dina: ['💵', '%', 'Σ', 'LTV'],
  kamila: ['🛒', '🤔', '💸', '👎', '👍'],
  bakhtiyor: ['💰', '📈', '🤝', 'x10'],
};
const GLOW = { timur: '80,200,255', liza: '190,120,255', borya: '90,255,150', nika: '255,120,200', mirik: '255,210,80', vlad: '255,80,90', arina: '255,200,60', gosha: '255,140,50', artem: '93,173,226', dina: '46,204,113', kamila: '253,121,168', bakhtiyor: '255,200,60' };
const EMPTY_DESKS = [{ x: 10, y: 4 }, { x: 10, y: 8 }];

export class Office {
  constructor(canvas, { onSelect } = {}) {
    this.cv = canvas;
    this.c = canvas.getContext('2d');
    this.agents = new Map();
    this.particles = [];
    this.selected = null;
    this.follow = null;
    this.hover = null;
    this.onSelect = onSelect;
    this.running = 0;
    this.done = 0;
    this.t = 0;
    this.last = performance.now();
    this.cam = { x: WW / 2, y: WH / 2, z: 1 };
    this.camT = { ...this.cam };
    for (const d of EMPTY_DESKS) this.addDesk(null, d.x, d.y, 2);
    this.cat = { id: 'cat', isCat: true, x: tileFeet(12, 14).x, y: tileFeet(12, 14).y, plan: [], path: [], dir: 'right', name: 'Барсик' };
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    requestAnimationFrame((n) => this.frame(n));
  }

  addDesk(owner, x, y, w) {
    const ex = furniture.find((f) => f.kind === 'desk' && f.x === x && f.y === y);
    if (ex) { ex.owner = owner; return ex; }
    const boss = owner === 'mirik';
    const desk = add('desk', x, y, w, 1, { owner, boss });
    if (!boss) furniture.push({ kind: 'chair', x, y, w: 0, h: 0, cx: (x + 1) * T, cy: (y + 1) * T + 14, walkable: true, owner });
    else furniture.push({ kind: 'bosschair', x, y, w: 0, h: 0, cx: (x + w / 2) * T, cy: y * T + 5, walkable: true, owner });
    return desk;
  }

  // ---------- камера ----------
  resize() {
    const box = this.cv.parentElement.getBoundingClientRect();
    this.vw = Math.max(1, box.width);
    this.vh = Math.max(1, box.height);
    this.dpr = devicePixelRatio || 1;
    this.cv.width = Math.round(this.vw * this.dpr);
    this.cv.height = Math.round(this.vh * this.dpr);
    this.cv.style.width = this.vw + 'px';
    this.cv.style.height = this.vh + 'px';
    const fitBoth = Math.min(this.vw / WW, this.vh / WH);
    this.minZ = fitBoth * 0.95;
    this.maxZ = Math.max(2.6, fitBoth * 4);
    if (!this.userMoved) this.fit();
  }

  fit() {
    const fitBoth = Math.min(this.vw / WW, this.vh / WH);
    // весь офис, если он помещается читаемо (компьютер); иначе (телефон) — крупно операционный отдел
    const narrow = fitBoth < 0.55;
    const z = narrow ? Math.min(this.vh / WH, fitBoth * 1.9) : fitBoth;
    this.camT = { x: narrow ? 8.5 * T : WW / 2, y: narrow ? 8.5 * T : WH / 2, z };
    this.follow = null;
    this.userMoved = false;
  }

  zoomBy(k, sx = this.vw / 2, sy = this.vh / 2) {
    const before = this.toWorld(sx, sy, this.camT);
    this.camT.z = Math.max(this.minZ, Math.min(this.maxZ, this.camT.z * k));
    const after = this.toWorld(sx, sy, this.camT);
    this.camT.x += before.x - after.x;
    this.camT.y += before.y - after.y;
    this.userMoved = true;
  }

  clampCam(cam) {
    const hw = this.vw / 2 / cam.z, hh = this.vh / 2 / cam.z;
    cam.x = WW < hw * 2 ? WW / 2 : Math.max(hw - 20, Math.min(WW - hw + 20, cam.x));
    cam.y = WH < hh * 2 ? WH / 2 : Math.max(hh - 20, Math.min(WH - hh + 20, cam.y));
  }

  toWorld(sx, sy, cam = this.cam) { return { x: (sx - this.vw / 2) / cam.z + cam.x, y: (sy - this.vh / 2) / cam.z + cam.y }; }
  toScreen(wx, wy) { return { x: (wx - this.cam.x) * this.cam.z + this.vw / 2, y: (wy - this.cam.y) * this.cam.z + this.vh / 2 }; }

  focus(id, zoom = true) {
    const a = id === 'cat' ? this.cat : this.agents.get(id);
    if (!a) return;
    this.selected = id === 'cat' ? null : id;
    this.follow = id;
    if (zoom) this.camT.z = Math.max(this.camT.z, Math.min(this.maxZ, Math.min(this.vw / WW, this.vh / WH) * 2.2));
    this.userMoved = true;
  }

  bindInput() {
    const cv = this.cv;
    const pts = new Map();
    let drag = null, pinch = null, moved = false;
    const local = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, local(e));
      moved = false;
      if (pts.size === 1) drag = { ...local(e), cx: this.camT.x, cy: this.camT.y };
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.camT.z };
        drag = null;
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (!pts.has(e.pointerId)) {
        this.hover = this.hit(p.x, p.y);
        cv.style.cursor = this.hover ? 'pointer' : 'grab';
        return;
      }
      pts.set(e.pointerId, p);
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const k = (pinch.z * (d / pinch.d)) / this.camT.z;
        this.zoomBy(k, (a.x + b.x) / 2, (a.y + b.y) / 2);
        moved = true;
      } else if (drag) {
        const dx = p.x - drag.x, dy = p.y - drag.y;
        if (Math.hypot(dx, dy) > 6) moved = true;
        if (moved) {
          this.follow = null;
          this.camT.x = drag.cx - dx / this.camT.z;
          this.camT.y = drag.cy - dy / this.camT.z;
          this.userMoved = true;
          cv.style.cursor = 'grabbing';
        }
      }
    });
    const up = (e) => {
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) {
        if (!moved && p) {
          const a = this.hit(p.x, p.y);
          if (a === this.cat) { this.say(this.cat, 'мяу 🐾', 1500); return; }
          this.selected = a?.id || null;
          if (a) this.follow = a.id;
          this.onSelect?.(this.selected);
        }
        drag = null;
        cv.style.cursor = 'grab';
      }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), p.x, p.y);
    }, { passive: false });
    cv.addEventListener('dblclick', (e) => { const p = local(e); this.zoomBy(1.7, p.x, p.y); });
  }

  hit(sx, sy) {
    const { x, y } = this.toWorld(sx, sy);
    let best = null;
    for (const a of [...this.agents.values(), this.cat]) {
      const top = a.isCat ? 22 : a.sitting ? 34 : 48;
      if (Math.abs(x - a.x) < 15 && y < a.y + 5 && y > a.y - top) if (!best || a.y > best.y) best = a;
    }
    return best;
  }

  // ---------- агенты ----------
  setAgents(list) {
    for (const def of list) {
      let a = this.agents.get(def.id);
      if (!a) {
        const boss = def.id === 'mirik';
        const w = boss ? 3 : 2;
        this.addDesk(def.id, def.desk.x, def.desk.y, w);
        const seatTile = boss ? { x: def.desk.x + 1, y: def.desk.y - 1 } : { x: def.desk.x, y: def.desk.y + 1 };
        const seat = boss ? { x: (def.desk.x + w / 2) * T, y: def.desk.y * T + 6, dir: 'down' } : { x: (def.desk.x + 1) * T, y: (def.desk.y + 1) * T + 14, dir: 'up' };
        a = { ...def, boss, w, seatTile, seat, x: seat.x, y: seat.y, path: [], plan: [], sitting: true, dir: seat.dir, bubble: null, nextGlyph: 0, blinkAt: Math.random() * 4 };
        this.agents.set(def.id, a);
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
    if (wasBusy !== a.busy) {
      if (!a.plan.some((p) => p.priority)) a.plan = [];
      if (a.busy && !wasBusy) this.emote(a, '❗');
    }
  }

  delegate(from, to, text) {
    const boss = this.agents.get(from), a = this.agents.get(to);
    if (!a || !boss) return;
    this.say(boss, `${a.name}, на тебе: ${text}`, 5000);
    const spot = { x: 18 + Math.floor(Math.random() * 3), y: 5 };
    a.plan = [
      { type: 'goto', tile: spot, priority: true, run: true },
      { type: 'face', dir: 'up', priority: true },
      { type: 'say', text: 'Есть, босс! 🫡', ms: 1800, priority: true },
      { type: 'wait', ms: 1500, priority: true },
    ];
  }

  report(from) {
    const a = this.agents.get(from);
    if (!a || from === 'mirik') return;
    this.confetti(a);
    a.plan = [
      { type: 'goto', tile: { x: 18 + Math.floor(Math.random() * 3), y: 5 }, priority: true },
      { type: 'face', dir: 'up', priority: true },
      { type: 'say', text: 'Готово! ✅', ms: 1800, priority: true },
      { type: 'wait', ms: 1600, priority: true },
    ];
    setTimeout(() => this.say(this.agents.get('mirik'), 'Отлично, спасибо! 👍', 2200), 900);
  }

  taskDone(agentId) { const a = this.agents.get(agentId); if (a) this.confetti(a); }

  say(a, text, ms = 3000) { if (a) a.bubble = { text, until: this.t + ms / 1000 }; }
  emote(a, icon) { a.emote = { icon, until: this.t + 1.6 }; }

  confetti(a) {
    for (let i = 0; i < 28; i++) {
      this.particles.push({ type: 'confetti', x: a.x, y: a.y - 40, vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 90, born: this.t, life: 1.6, color: ['#ffd23f', '#ff6b6b', '#5dade2', '#2ecc71', '#e84393'][i % 5] });
    }
  }

  think(a) {
    if (a.isCat) {
      if (Math.random() < 0.35) a.plan = [{ type: 'goto', tile: { x: 12, y: 14 } }, { type: 'sit', at: { x: 12.5 * T, y: 15 * T + 18 }, ms: 15000 + Math.random() * 20000, sleep: true }];
      else {
        const s = CAT_SPOTS[Math.floor(Math.random() * CAT_SPOTS.length)];
        a.plan = [{ type: 'goto', tile: s }, { type: 'wait', ms: 3000 + Math.random() * 6000 }];
      }
      return;
    }
    a.poi = null;
    if (a.busy) {
      a.plan = [{ type: 'goto', tile: a.seatTile }, { type: 'sit', at: a.seat, dir: a.seat.dir, ms: Infinity }];
      return;
    }
    const taken = new Set([...this.agents.values()].map((x) => x.poi).filter(Boolean));
    const mine = a.boss ? 'mirik' : a.dept === 'yt' ? 'yt' : a.dept === 'vc' ? 'vc' : 'staff';
    const pois = POIS.filter((p) => !taken.has(p) && (p.who === 'all' || p.who === mine));
    if (Math.random() < 0.5 && pois.length) {
      const p = pois[Math.floor(Math.random() * pois.length)];
      a.poi = p;
      a.plan = [{ type: 'goto', tile: p }, { type: 'face', dir: p.dir }, { type: 'say', text: p.say, ms: 2600 }];
      if (p.sit) a.plan.push({ type: 'sit', at: p.sit, dir: 'down', ms: 6000 + Math.random() * 6000 });
      else a.plan.push({ type: 'wait', ms: 3500 + Math.random() * 5000 });
      a.plan.push({ type: 'goto', tile: a.seatTile }, { type: 'sit', at: a.seat, dir: a.seat.dir, ms: 6000 + Math.random() * 12000 });
    } else {
      a.plan = [{ type: 'goto', tile: a.seatTile }, { type: 'sit', at: a.seat, dir: a.seat.dir, ms: 5000 + Math.random() * 9000 }];
    }
  }

  step(a, dt) {
    if (!a.plan.length) this.think(a);
    const act = a.plan[0];
    if (!act) return;
    switch (act.type) {
      case 'goto': {
        if (!act.started) {
          act.started = true;
          const wasSeat = a.sittingAt;
          a.sitting = false;
          a.sittingAt = null;
          const [sx, sy] = nearestFree(a.x, a.y);
          a.path = findPath(sx, sy, act.tile.x, act.tile.y).map(([x, y]) => tileFeet(x, y));
          if (wasSeat || !free(Math.floor(a.x / T), Math.floor(a.y / T - 0.25))) a.path.unshift(tileFeet(sx, sy));
        }
        if (this.moveAlong(a, dt, act.run ? 1.5 : 1)) a.plan.shift();
        break;
      }
      case 'sit': {
        const dx = act.at.x - a.x, dy = act.at.y - a.y, d = Math.hypot(dx, dy);
        if (d > 1) {
          const s = Math.min(d, 70 * dt);
          a.x += (dx / d) * s; a.y += (dy / d) * s;
          a.walking = true;
          return;
        }
        a.walking = false;
        a.sitting = true;
        a.sleeping = !!act.sleep;
        a.sittingAt = act.at;
        if (act.dir) a.dir = act.dir;
        act.left = (act.left ?? act.ms) - dt * 1000;
        if (act.left <= 0) { a.plan.shift(); a.sleeping = false; }
        break;
      }
      case 'wait':
        a.walking = false;
        act.left = (act.left ?? act.ms) - dt * 1000;
        if (act.left <= 0) a.plan.shift();
        break;
      case 'say': this.say(a, act.text, act.ms); a.plan.shift(); break;
      case 'face': a.dir = act.dir; a.plan.shift(); break;
    }
  }

  moveAlong(a, dt, k = 1) {
    const target = a.path[0];
    if (!target) { a.walking = false; return true; }
    const dx = target.x - a.x, dy = target.y - a.y, d = Math.hypot(dx, dy);
    const speed = (a.isCat ? 55 : 80) * k * dt;
    a.walking = true;
    if (d > 0.5) a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    if (d <= speed) { a.x = target.x; a.y = target.y; a.path.shift(); } else { a.x += (dx / d) * speed; a.y += (dy / d) * speed; }
    if (!a.path.length) { a.walking = false; return true; }
    return false;
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    for (const a of this.agents.values()) {
      this.step(a, dt);
      if (a.busy && a.sittingAt === a.seat && this.t > a.nextGlyph) {
        a.nextGlyph = this.t + 0.6 + Math.random() * 0.7;
        const g = GLYPHS[a.id] || GLYPHS.timur;
        this.particles.push({ type: 'glyph', x: a.seat.x + (Math.random() - 0.5) * 26, y: a.seat.y - (a.boss ? 34 : 40), text: g[Math.floor(Math.random() * g.length)], born: this.t, life: 2 });
      }
    }
    this.step(this.cat, dt);
    for (const p of this.particles) if (p.type === 'confetti') { p.vy += 220 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    this.particles = this.particles.filter((p) => this.t - p.born < p.life);
    // камера
    if (this.follow) {
      const f = this.follow === 'cat' ? this.cat : this.agents.get(this.follow);
      if (f) { this.camT.x = f.x; this.camT.y = f.y - 20; }
    }
    this.clampCam(this.camT);
    const k = 1 - Math.pow(0.0015, dt);
    this.cam.x += (this.camT.x - this.cam.x) * k;
    this.cam.y += (this.camT.y - this.cam.y) * k;
    this.cam.z += (this.camT.z - this.cam.z) * k;
    this.draw();
    requestAnimationFrame((n) => this.frame(n));
  }

  // ---------- время суток ----------
  daylight() {
    const d = new Date();
    const h = d.getHours() + d.getMinutes() / 60;
    const dark = h < 5 || h >= 21 ? 0.5 : h < 7 ? 0.5 - (h - 5) * 0.25 : h < 17 ? 0 : h < 21 ? (h - 17) * 0.125 : 0.5;
    let sky;
    if (h < 5 || h >= 21) sky = ['#0b1030', '#1d2550'];
    else if (h < 7) sky = ['#3b4a8a', '#f6a26b'];
    else if (h < 17) sky = ['#5fb6f2', '#cdeeff'];
    else if (h < 19) sky = ['#5a6fc0', '#ffb36b'];
    else sky = ['#2c2f6b', '#e0705b'];
    return { dark, sky, night: dark >= 0.35, h };
  }

  // ---------- статичный фон ----------
  drawBackground() {
    const S = 2;
    const cv = document.createElement('canvas');
    cv.width = WW * S; cv.height = WH * S;
    const c = cv.getContext('2d');
    c.scale(S, S);
    const r = rng(42);
    for (let y = 2; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const X = x * T, Y = y * T;
      if (y >= VC_WALL) {
        if (y < VC_Y && !VC_DOORS.includes(x)) continue; // стена — рисуется ниже
        // светлый паркет «ёлочкой»: соседние клетки — доски поперёк
        px(c, X, Y, T, T, '#e8d8bc');
        for (let i = 0; i < 4; i++) {
          const col = ((x * 7 + y * 3 + i) % 3) === 0 ? '#e2cfae' : ((x + i) % 2 ? '#ecdec4' : '#e6d5b6');
          if ((x + y) % 2) px(c, X + i * 8, Y, 8, T, col); else px(c, X, Y + i * 8, T, 8, col);
          if ((x + y) % 2) px(c, X + i * 8 + 7, Y, 1, T, 'rgba(150,110,60,.18)'); else px(c, X, Y + i * 8 + 7, T, 1, 'rgba(150,110,60,.18)');
        }
        continue;
      }
      const studio = x >= STUDIO_X;
      const office = !studio && x >= 16 && y <= 6;
      const meeting = !studio && x >= 16 && y >= 8 && y <= 11;
      const kitchen = !studio && x >= 16 && y >= 12;
      if (x === 23) {
        px(c, X, Y, T, T, '#2f2a3d');
      } else if (studio) {
        px(c, X, Y, T, T, (x + y) % 2 ? '#262833' : '#2b2d39');
        px(c, X, Y, T, 1, 'rgba(255,255,255,.04)'); px(c, X, Y, 1, T, 'rgba(0,0,0,.25)');
        if (r() < 0.25) px(c, X + r() * T, Y + r() * T, 2, 1, 'rgba(255,255,255,.05)');
      } else if (office) {
        px(c, X, Y, T, T, '#4a3658');
        for (let i = 0; i < 6; i++) px(c, X + r() * T, Y + r() * T, 1, 1, 'rgba(255,255,255,.06)');
      } else if (meeting) {
        px(c, X, Y, T, T, (x + y) % 2 ? '#3e4a5e' : '#435064');
        px(c, X, Y, T, 1, 'rgba(0,0,0,.12)'); px(c, X, Y, 1, T, 'rgba(0,0,0,.12)');
      } else if (kitchen) {
        px(c, X, Y, T, T, '#7a7f8c');
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) px(c, X + i * 16 + 1, Y + j * 16 + 1, 15, 15, (i + j + x + y) % 2 ? '#eae6dc' : '#d9d2c3');
      } else {
        for (let p = 0; p < 4; p++) {
          const py = Y + p * 8;
          const base = 160 + Math.floor(r() * 18);
          c.fillStyle = `rgb(${base + 8},${Math.floor(base * 0.73)},${Math.floor(base * 0.5)})`;
          c.fillRect(X, py, T, 8);
          px(c, X, py + 7, T, 1, 'rgba(60,30,10,.25)');
          const seam = ((y * 4 + p) * 13 + x * 32) % 64;
          if (seam < 32) px(c, X + seam, py, 1, 7, 'rgba(60,30,10,.22)');
          px(c, X + r() * T, py + 2 + r() * 4, 4 + r() * 8, 1, 'rgba(90,50,20,.12)');
        }
      }
    }
    // стены сверху
    for (let x = 0; x < W; x++) {
      const studio = x >= 23;
      const boss = !studio && x >= 15;
      const X = x * T;
      px(c, X, 0, T, 46, studio ? '#1d1c2b' : boss ? '#3d3456' : '#ece2cf');
      px(c, X, 0, T, 4, studio ? '#15141f' : boss ? '#2c2540' : '#d9cdb5');
      px(c, X, 46, T, 12, studio ? '#16151f' : boss ? '#2f2845' : '#b98e63');
      px(c, X + 15, 47, 1, 10, 'rgba(0,0,0,.18)');
      px(c, X, 46, T, 1, 'rgba(255,255,255,.18)');
      px(c, X, 58, T, 6, studio ? '#0f0e16' : boss ? '#211c33' : '#7a5636');
      if (studio && x > 23) {
        for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) { px(c, X + 2 + i * 15, 8 + j * 12, 13, 10, (i + j + x) % 2 ? '#27253a' : '#2f2c45'); px(c, X + 2 + i * 15, 8 + j * 12, 13, 2, 'rgba(255,255,255,.05)'); }
      }
    }
    px(c, STUDIO_X * T, 62, (W - 1 - STUDIO_X) * T, 2, 'rgba(255,0,200,.55)');
    px(c, 23 * T + 8, 2 * T, 16, (VC_WALL - 2) * T, '#3d3852');
    px(c, 23 * T + 8, 2 * T, 2, (VC_WALL - 2) * T, 'rgba(255,255,255,.12)');
    px(c, 23 * T, DOOR_Y * T, T, T, '#3a3449');
    px(c, 23 * T + 4, DOOR_Y * T - 3, T - 8, 3, '#9aa7b8'); px(c, 23 * T + 4, (DOOR_Y + 1) * T, T - 8, 3, '#9aa7b8');
    const g = c.createLinearGradient(0, 64, 0, 78);
    g.addColorStop(0, 'rgba(0,0,0,.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(T, 64, WW - 2 * T, 14);
    // боковые и нижняя стены
    px(c, 0, 2 * T, T, WH, '#2a2638'); px(c, T - 6, 2 * T, 6, (H - 3) * T, '#3d3852');
    px(c, (W - 1) * T, 2 * T, T, WH, '#2a2638'); px(c, (W - 1) * T, 2 * T, 6, (H - 3) * T, '#3d3852');
    px(c, 0, (H - 1) * T, WW, T, '#2a2638'); px(c, T, (H - 1) * T, WW - 2 * T, 6, '#3d3852');
    // стена StartupBase (вид спереди): белая, с плинтусом, проёмы-входы
    for (let x = 1; x < W - 1; x++) {
      if (VC_DOORS.includes(x)) continue;
      const X = x * T, Y = VC_WALL * T;
      px(c, X, Y, T, 6, '#cfcbc2');
      px(c, X, Y + 6, T, 40, '#f6f5f1');
      px(c, X, Y + 46, T, 12, '#e4e1d9'); px(c, X, Y + 46, T, 1, 'rgba(0,0,0,.06)');
      px(c, X, Y + 58, T, 6, '#bdb8ad');
    }
    for (const dx of VC_DOORS) {
      const X = dx * T, Y = VC_WALL * T;
      px(c, X - 3, Y, 3, 2 * T, '#9aa0ad'); px(c, X + T, Y, 3, 2 * T, '#9aa0ad');
      px(c, X, Y, T, 4, '#9aa0ad');
    }
    const vg = c.createLinearGradient(0, VC_Y * T, 0, VC_Y * T + 14);
    vg.addColorStop(0, 'rgba(0,0,0,.12)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = vg; c.fillRect(T, VC_Y * T, WW - 2 * T, 14);
    // окна в правой стене венчурного офиса
    for (let y = VC_Y; y < H - 1; y += 3) { px(c, (W - 1) * T, y * T + 6, 6, 2 * T - 12, '#9fd3ff'); px(c, (W - 1) * T + 1, y * T + 8, 2, 2 * T - 16, '#e6f6ff'); }
    for (let y = VC_Y; y < H - 1; y += 3) { px(c, T - 6, y * T + 6, 6, 2 * T - 12, '#9fd3ff'); px(c, T - 4, y * T + 8, 2, 2 * T - 16, '#e6f6ff'); }
    // картины / постеры
    box(c, 13 * T + 34, 10, 22, 28, '#ffffff'); px(c, 13 * T + 37, 13, 16, 16, '#5dade2'); px(c, 13 * T + 40, 20, 10, 6, '#ffd23f'); px(c, 13 * T + 37, 31, 16, 3, '#333');
    box(c, 18 * T + 12, 14, 26, 20, '#e0b04a'); px(c, 18 * T + 15, 17, 20, 14, '#1c2740'); px(c, 18 * T + 19, 21, 12, 2, '#e0b04a'); px(c, 18 * T + 19, 25, 8, 2, '#e0b04a');
    this.bg = cv;
  }

  // окна, доска, часы — меняются со временем
  drawWall(c, day) {
    const wins = [[1 * T + 12, 2 * T + 8], [7 * T + 4, 2 * T], [10 * T + 28, 2 * T - 8], [16 * T + 6, 2 * T - 6], [19 * T + 14, T + 22]];
    for (const [x, w] of wins) {
      box(c, x - 3, 6, w + 6, 42, '#6b5340');
      c.save();
      c.beginPath(); c.rect(x, 9, w, 34); c.clip();
      const g = c.createLinearGradient(0, 9, 0, 43);
      g.addColorStop(0, day.sky[0]); g.addColorStop(1, day.sky[1]);
      c.fillStyle = g; c.fillRect(x, 9, w, 34);
      if (day.night) {
        for (let i = 0; i < 8; i++) px(c, x + ((i * 29 + x) % w), 11 + ((i * 13) % 14), 1, 1, Math.sin(this.t * 2 + i) > 0.6 ? '#fff' : 'rgba(255,255,255,.5)');
        ellipse(c, x + w - 12, 17, 4, 4, '#f4f1c9');
      } else {
        for (let i = 0; i < 2; i++) {
          const cx = x + ((this.t * (4 + i * 2) + i * 37 + x) % (w + 40)) - 20;
          ellipse(c, cx, 15 + i * 6, 9, 3, 'rgba(255,255,255,.9)'); ellipse(c, cx + 6, 13 + i * 6, 6, 3, 'rgba(255,255,255,.9)');
        }
      }
      for (let i = 0; i < w; i += 8) {
        const bh = 10 + ((i * 7 + x) % 14);
        px(c, x + i, 43 - bh, 7, bh, day.night ? '#1f2846' : '#5a7090');
        for (let j = 0; j < bh - 3; j += 4) px(c, x + i + 2, 43 - bh + 2 + j, 2, 2, day.night ? (((i + j + x) % 3) ? '#ffd86b' : '#2b3558') : '#9fb7d4');
      }
      c.restore();
      px(c, x + w / 2 - 1, 9, 3, 34, '#6b5340');
      px(c, x, 25, w, 2, '#6b5340');
      px(c, x - 5, 46, w + 10, 4, '#8a6c52');
      px(c, x - 6, 6, 5, 40, 'rgba(220,90,80,.85)'); px(c, x + w + 1, 6, 5, 40, 'rgba(220,90,80,.85)');
    }
    // доска задач
    const bx = 4 * T + 6, by = 8;
    box(c, bx, by, 2 * T + 22, 40, '#f7f7f2', { outline: '#8a8f99' });
    px(c, bx, by + 40, 2 * T + 22, 3, '#8a8f99');
    c.font = '700 8px Inter, sans-serif'; c.textAlign = 'left';
    c.fillStyle = '#c0392b'; c.fillText('ЗАДАЧИ', bx + 4, by + 10);
    c.fillStyle = '#2c3e50'; c.fillText(`в работе: ${this.running}`, bx + 4, by + 21);
    c.fillStyle = '#27ae60'; c.fillText(`готово: ${this.done}`, bx + 4, by + 32);
    px(c, bx + 2 * T, by + 4, 16, 14, '#ffeaa7'); px(c, bx + 2 * T + 2, by + 22, 14, 13, '#81ecec');
    // часы
    const d = new Date(), cx = 9 * T + 26, cy = 24;
    ellipse(c, cx, cy, 10, 10, OUT); ellipse(c, cx, cy, 9, 9, '#fff');
    c.strokeStyle = '#333'; c.lineCap = 'round';
    const hand = (ang, len, w) => { c.lineWidth = w; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(ang) * len, cy - Math.cos(ang) * len); c.stroke(); };
    hand(((d.getHours() % 12) + d.getMinutes() / 60) * Math.PI / 6, 5, 2);
    hand(d.getMinutes() * Math.PI / 30, 7, 1.2);
    c.strokeStyle = '#e74c3c'; hand(d.getSeconds() * Math.PI / 30, 7.5, 0.6);
    // студия: неоновая вывеска и «кнопки» YouTube
    const nx = 24.5 * T, ny = 10;
    box(c, nx, ny, 3 * T + 6, 30, '#120f1c', { outline: '#05040a' });
    const flick = 0.75 + 0.25 * Math.sin(this.t * 3) * Math.sin(this.t * 7.3);
    c.save();
    c.shadowColor = '#ff2bd6'; c.shadowBlur = 14 * flick;
    c.font = '900 15px Montserrat, Inter, sans-serif'; c.textAlign = 'left';
    c.fillStyle = `rgba(255,140,240,${0.7 + 0.3 * flick})`; c.fillText('▶ STUDIO', nx + 9, ny + 21);
    c.restore();
    [['#c9d1da', 'SILVER'], ['#f5c542', 'GOLD'], ['#b9f2ff', 'DIAMOND']].forEach(([col, label], i) => {
      const bx = 28.2 * T + i * 30, by = 12;
      box(c, bx, by, 24, 30, '#2a2438', { outline: '#0d0b14' });
      px(c, bx + 3, by + 3, 18, 20, col); px(c, bx + 3, by + 3, 18, 4, 'rgba(255,255,255,.35)');
      c.fillStyle = '#ff0033'; c.beginPath(); c.moveTo(bx + 9, by + 8); c.lineTo(bx + 9, by + 18); c.lineTo(bx + 17, by + 13); c.fill();
      c.font = '700 3.5px Inter, sans-serif'; c.textAlign = 'center'; c.fillStyle = '#fff'; c.fillText(label, bx + 12, by + 27.5);
    });
    this.drawVcWall(c);
    // табличка
    box(c, 19 * T - 12, 7 * T - 30, 46, 9, '#e0b04a', { outline: '#6b4e1f' });
    c.fillStyle = '#2a2440'; c.font = '700 7px Inter, sans-serif'; c.textAlign = 'center'; c.fillText('BOSS ROOM', 19 * T + 11, 7 * T - 23);
  }

  // стена StartupBase: вывеска, портфель стартапов, воронка, экран питча, Demo Day
  drawVcWall(c) {
    const Y = VC_WALL * T;
    // вывеска с ракетой
    box(c, 2 * T + 6, Y + 10, 6 * T - 12, 30, '#ffffff', { outline: '#d8d4ca' });
    c.font = '900 15px Montserrat, Inter, sans-serif'; c.textAlign = 'left'; c.fillStyle = '#1e272e';
    c.fillText('Startup', 3 * T + 4, Y + 30); c.fillStyle = '#ff7a2f'; c.fillText('Base', 3 * T + 70, Y + 30);
    c.font = '18px sans-serif'; c.fillText('🚀', 2 * T + 12, Y + 32 - Math.abs(Math.sin(this.t * 2)) * 3);
    // портфель: логотипы стартапов
    box(c, 12 * T - 6, Y + 8, 5 * T, 36, '#ffffff', { outline: '#d8d4ca' });
    c.font = '700 5px Inter, sans-serif'; c.fillStyle = '#636e72'; c.fillText('PORTFOLIO', 12 * T, Y + 15);
    ['#ff7675', '#74b9ff', '#55efc4', '#ffeaa7', '#a29bfe', '#fd79a8', '#00cec9', '#fab1a0'].forEach((col, i) => {
      const lx = 12 * T + (i % 4) * 37, ly = Y + 19 + Math.floor(i / 4) * 12;
      box(c, lx, ly, 30, 9, col, { outline: 'rgba(0,0,0,.08)' }); px(c, lx + 3, ly + 3, 12, 3, 'rgba(255,255,255,.75)');
    });
    // воронка сделок на доске
    box(c, 18 * T, Y + 8, 3 * T + 8, 38, '#fbfbf8', { outline: '#b9b4a8' });
    [[90, '#74b9ff'], [64, '#55efc4'], [40, '#ffeaa7'], [18, '#ff7675']].forEach(([wd, col], i) => px(c, 18 * T + 52 - wd / 2, Y + 13 + i * 7, wd, 5, col));
    c.font = '700 4.5px Inter, sans-serif'; c.fillStyle = '#2d3436'; c.textAlign = 'left'; c.fillText('DEAL FLOW', 18 * T + 4, Y + 44);
    // большой экран над сценой — слайды питча
    const sx = 23 * T + 8, sw = 6 * T - 16;
    box(c, sx, Y + 4, sw, 46, '#1e272e');
    px(c, sx + 3, Y + 7, sw - 6, 40, '#ffffff');
    const slide = Math.floor(this.t / 3) % 4;
    c.textAlign = 'left';
    if (slide === 0) { c.font = '900 12px Montserrat, Inter, sans-serif'; c.fillStyle = '#ff7a2f'; c.fillText('Seed $500K', sx + 12, Y + 25); c.font = '600 6px Inter, sans-serif'; c.fillStyle = '#636e72'; c.fillText('Use of funds: product · growth · team', sx + 12, Y + 38); }
    else if (slide === 1) { for (let i = 0; i < 6; i++) { const bh = 5 + i * 5; px(c, sx + 14 + i * 22, Y + 44 - bh, 14, bh, i === 5 ? '#ff7a2f' : '#74b9ff'); } c.font = '700 6px Inter, sans-serif'; c.fillStyle = '#2d3436'; c.fillText('MRR +38% MoM', sx + 12, Y + 16); }
    else if (slide === 2) { c.font = '700 7px Inter, sans-serif'; c.fillStyle = '#2d3436'; c.fillText('TAM  $4.2B', sx + 14, Y + 20); c.fillText('SAM  $610M', sx + 14, Y + 30); c.fillText('SOM  $38M', sx + 14, Y + 40); [[26, '#dfe6e9'], [17, '#74b9ff'], [8, '#ff7a2f']].forEach(([r, col]) => ellipse(c, sx + sw - 40, Y + 27, r * 0.8, r * 0.8, col)); }
    else { c.font = '900 13px Montserrat, Inter, sans-serif'; c.fillStyle = '#2d3436'; c.fillText('Problem → Solution', sx + 12, Y + 25); c.font = '600 6px Inter, sans-serif'; c.fillStyle = '#ff7a2f'; c.fillText('farmers lose 30% of harvest', sx + 12, Y + 38); }
    // Demo Day
    box(c, 31 * T + 4, Y + 10, 3 * T + 18, 30, '#ff7a2f', { outline: '#c45c1f' });
    c.font = '900 10px Montserrat, Inter, sans-serif'; c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.fillText('DEMO DAY', 32.7 * T + 14, Y + 24);
    c.font = '700 5px Inter, sans-serif'; c.fillText('applications open', 32.7 * T + 14, Y + 34);
  }

  drawSunbeams(c, day) {
    if (day.dark > 0.2) return;
    c.fillStyle = `rgba(255,236,190,${0.07 * (1 - day.dark * 4)})`;
    for (const [x, w] of [[1 * T + 12, 2 * T + 8], [7 * T + 4, 2 * T], [10 * T + 28, 2 * T - 8], [16 * T + 6, 2 * T - 6]]) {
      c.beginPath(); c.moveTo(x, 64); c.lineTo(x + w, 64); c.lineTo(x + w + 40, 64 + 90); c.lineTo(x + 40, 64 + 90); c.fill();
    }
  }

  // ---------- кадр ----------
  draw() {
    const c = this.c;
    if (!this.bg) this.drawBackground();
    const day = this.daylight();
    const { z, x: camX, y: camY } = this.cam;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#121019';
    c.fillRect(0, 0, this.cv.width, this.cv.height);
    const sx = this.dpr * z, tx = this.dpr * (this.vw / 2 - camX * z), ty = this.dpr * (this.vh / 2 - camY * z);
    c.setTransform(sx, 0, 0, sx, tx, ty);
    c.imageSmoothingEnabled = z * this.dpr < 2;
    c.drawImage(this.bg, 0, 0, WW, WH);
    c.imageSmoothingEnabled = false;
    this.drawWall(c, day);
    this.drawSunbeams(c, day);

    // плоские объекты (ковры), затем сортировка по глубине
    for (const f of furniture) if (f.flat) this.drawFurniture(c, f);
    const items = [];
    for (const f of furniture) {
      if (f.flat) continue;
      let y = (f.y + f.h) * T - 2;
      if (f.kind === 'chair') y = f.cy + 1;
      if (f.kind === 'bosschair') y = f.cy - 1;
      if (f.kind === 'sofa') { items.push({ y: f.y * T + 4, draw: () => this.drawFurniture(c, f, 'back') }); items.push({ y: f.y * T + 24, draw: () => this.drawFurniture(c, f, 'front') }); continue; }
      items.push({ y, draw: () => this.drawFurniture(c, f) });
    }
    items.push({ y: 8 * T - 4, draw: () => this.drawGlass(c) });
    for (const a of this.agents.values()) items.push({ y: a.y, draw: () => this.drawAgent(c, a) });
    items.push({ y: this.cat.y, draw: () => drawCat(c, this.cat.x, this.cat.y, { dir: this.cat.dir, walking: this.cat.walking, sleeping: this.cat.sleeping, t: this.t }) });
    items.sort((p, q) => p.y - q.y).forEach((i) => i.draw());

    for (const p of this.particles) {
      const k = (this.t - p.born) / p.life;
      c.globalAlpha = Math.max(0, 1 - k);
      if (p.type === 'confetti') px(c, p.x, p.y, 3, 2, p.color);
      else {
        c.font = '600 9px Inter, sans-serif'; c.textAlign = 'center'; c.fillStyle = '#ffffff';
        c.fillText(p.text, p.x + Math.sin(p.born * 9 + k * 4) * 5, p.y - k * 30);
      }
      c.globalAlpha = 1;
    }

    this.drawLighting(c, day, sx, tx, ty);

    // UI в экранных координатах
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const showNames = z > 0.62;
    for (const d of DEPT_SIGNS) this.drawSign(c, d);
    for (const a of this.agents.values()) if (showNames || a.id === this.selected || a === this.hover) this.drawLabel(c, a);
    for (const a of [...this.agents.values(), this.cat]) this.drawBubble(c, a);
  }

  drawLighting(c, day, sx, tx, ty) {
    if (day.dark <= 0.02) return;
    if (!this.lightCv) this.lightCv = document.createElement('canvas');
    const L = this.lightCv;
    if (L.width !== this.cv.width || L.height !== this.cv.height) { L.width = this.cv.width; L.height = this.cv.height; }
    const lc = L.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, L.width, L.height);
    lc.fillStyle = `rgba(12,14,42,${day.dark})`;
    lc.fillRect(0, 0, L.width, L.height);
    lc.setTransform(sx, 0, 0, sx, tx, ty);
    lc.globalCompositeOperation = 'destination-out';
    const light = (x, y, r, a = 1) => {
      const g = lc.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g; lc.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (const f of furniture) {
      if (f.kind === 'desk') light((f.x + f.w - 0.3) * T, f.y * T + 4, 58, 0.85);
      if (f.kind === 'arcade') light(f.x * T + 16, f.y * T, 40, 0.7);
      if (f.kind === 'vending') light(f.x * T + 16, f.y * T, 44, 0.7);
      if (f.kind === 'counter') light((f.x + 2.5) * T, f.y * T, 80, 0.8);
      if (f.kind === 'server') light(f.x * T + 16, f.y * T, 34, 0.5);
      if (f.kind === 'ringlight') light(f.x * T + 16, f.y * T - 10, 85, 0.95);
      if (f.kind === 'tripod') light(f.x * T + 16, f.y * T - 10, 80, 0.85);
      if (f.kind === 'editbay') light((f.x + 1.5) * T, f.y * T, 70, 0.8);
      if (f.kind === 'minifridge') light(f.x * T + 16, f.y * T, 34, 0.6);
      if (f.kind === 'greenscreen') light((f.x + 1.5) * T, f.y * T, 60, 0.5);
    }
    for (const a of this.agents.values()) if (a.busy && a.sittingAt === a.seat) light(a.seat.x, a.seat.y - 30, 50, 0.8);
    light(19 * T, 9.5 * T, 90, 0.6);
    light(26 * T, 1.2 * T, 110, 0.75); // неон
    // StartupBase — потолочные светильники: светло в любое время
    for (const ly of [19.5, 23, 26.5]) for (const lx of [3, 8.5, 14, 19.5, 25, 30.5]) light(lx * T, ly * T, 150, 0.95);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(L, 0, 0);
    // тёплые блики
    c.setTransform(sx, 0, 0, sx, tx, ty);
    c.globalCompositeOperation = 'lighter';
    for (const f of furniture) if (f.kind === 'desk') {
      const g = c.createRadialGradient((f.x + f.w - 0.3) * T, f.y * T, 0, (f.x + f.w - 0.3) * T, f.y * T, 40);
      g.addColorStop(0, 'rgba(255,190,90,.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(f.x * T - 20, f.y * T - 40, f.w * T + 60, 80);
    }
    c.globalCompositeOperation = 'source-over';
  }

  drawGlass(c) {
    // вертикальная стена кабинета
    px(c, 15 * T + 12, 2 * T - 6, 8, 6 * T + 6, 'rgba(170,220,255,.18)');
    px(c, 15 * T + 12, 2 * T - 6, 2, 6 * T + 6, 'rgba(220,240,255,.55)');
    px(c, 15 * T + 18, 2 * T - 6, 2, 6 * T + 6, 'rgba(120,150,180,.5)');
    // нижняя стена с дверью
    for (const [x0, x1] of [[15, 19], [20, 23]]) {
      px(c, x0 * T + 12, 7 * T + 2, (x1 - x0) * T - 12, 22, 'rgba(170,220,255,.16)');
      px(c, x0 * T + 12, 7 * T + 2, (x1 - x0) * T - 12, 2, 'rgba(220,240,255,.6)');
      px(c, x0 * T + 12, 7 * T + 22, (x1 - x0) * T - 12, 3, '#7d8a9c');
      for (let x = x0 * T + 40; x < x1 * T; x += 40) px(c, x, 7 * T + 2, 2, 22, 'rgba(120,150,180,.5)');
    }
    px(c, 19 * T - 3, 7 * T - 4, 4, 30, '#9aa7b8'); px(c, 20 * T - 1, 7 * T - 4, 4, 30, '#9aa7b8');
    // ТВ на стекле
    const X = 20 * T + 16, Y = 7 * T - 16;
    box(c, X, Y, 54, 30, '#14182a');
    px(c, X + 2, Y + 2, 50, 26, '#1d2440');
    c.font = '700 6px Inter, sans-serif'; c.textAlign = 'left';
    c.fillStyle = '#ffd23f'; c.fillText('LIVE', X + 4, Y + 9);
    c.fillStyle = '#e74c3c'; if (Math.sin(this.t * 4) > 0) px(c, X + 21, Y + 5, 3, 3, '#e74c3c');
    c.fillStyle = '#cfd8ff'; c.fillText(`работа ${this.running}`, X + 4, Y + 17); c.fillText(`готово ${this.done}`, X + 4, Y + 24);
    for (let i = 0; i < 4; i++) { const h = 3 + ((Math.sin(this.t + i) + 1) / 2) * 12; px(c, X + 36 + i * 4, Y + 26 - h, 3, h, i % 2 ? '#5dade2' : '#2ecc71'); }
  }

  drawFurniture(c, f, part) {
    const X = f.x * T, Y = f.y * T, w = f.w * T, h = f.h * T;
    const shadow = (dx = 0) => { c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(X + 3 + dx, Y + h - 3, w - 2, 5); };
    switch (f.kind) {
      case 'rug':
        if (f.vc) {
          box(c, X + 6, Y + 4, w - 12, h - 8, '#dfe6e9', { outline: '#c8d0d4' });
          c.strokeStyle = '#1abc9c'; c.lineWidth = 2; c.strokeRect(X + 12, Y + 10, w - 24, h - 20);
          break;
        }
        if (f.studio) {
          box(c, X + 4, Y + 4, w - 8, h - 8, '#191a24', { outline: '#0c0d13' });
          c.strokeStyle = 'rgba(0,229,255,.55)'; c.lineWidth = 2; c.strokeRect(X + 10, Y + 10, w - 20, h - 20);
          c.fillStyle = 'rgba(255,0,200,.5)'; c.beginPath(); c.moveTo(X + w / 2 - 8, Y + h / 2 - 10); c.lineTo(X + w / 2 - 8, Y + h / 2 + 10); c.lineTo(X + w / 2 + 10, Y + h / 2); c.fill();
          break;
        }
        if (f.boss) {
          c.strokeStyle = '#e0b04a'; c.lineWidth = 2; c.strokeRect(X + 9, Y + 1, w - 18, h - 12);
          for (let i = 0; i < 4; i++) px(c, X + 24 + i * 30, Y + h / 2 - 6, 6, 6, '#b04a63');
        } else {
          box(c, X + 6, Y + 4, w - 12, h - 8, '#3f6b75', { outline: '#2a4a52' });
          c.strokeStyle = '#e8dcc6'; c.lineWidth = 2; c.strokeRect(X + 12, Y + 10, w - 24, h - 20);
          for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) px(c, X + 26 + i * 32, Y + 26 + j * 30, 4, 4, '#5d8e98');
        }
        break;
      case 'catbed':
        ellipse(c, X + 16, Y + 22, 15, 7, OUT); ellipse(c, X + 16, Y + 22, 14, 6, '#8e6bbf'); ellipse(c, X + 16, Y + 22, 10, 4, '#b39ddb');
        break;
      case 'desk': {
        const a = f.owner && this.agents.get(f.owner);
        if (f.boss) {
          shadow();
          box(c, X, Y + 2, w, 14, '#6b4429', { hi: '#8a5a38' });
          px(c, X, Y + 16, w, h - 12, '#4e301c'); px(c, X - 1, Y + 16, 1, h - 12, OUT); px(c, X + w, Y + 16, 1, h - 12, OUT); px(c, X - 1, Y + h + 4, w + 2, 1, OUT);
          px(c, X + 10, Y + 20, w - 20, 8, '#5a3820'); px(c, X + w / 2 - 6, Y + 22, 12, 2, '#e0b04a');
          // монитор Мирика (видим сзади) + лампа + бумаги + табличка
          box(c, X + w - 34, Y - 12, 26, 16, '#2b2d36'); px(c, X + w - 24, Y + 4, 6, 3, '#3b3e4a');
          box(c, X + 10, Y + 4, 14, 9, '#f4f0e6', { outline: '#b9b2a3' });
          box(c, X + 30, Y + 7, 18, 5, '#e0b04a', { outline: '#6b4e1f' });
          px(c, X + 6, Y - 8, 2, 12, '#333'); box(c, X + 2, Y - 12, 10, 5, '#2e7d4f');
          px(c, X + w - 50, Y + 5, 5, 6, '#fff'); px(c, X + w - 50, Y + 5, 5, 2, '#c0392b');
          break;
        }
        shadow();
        // столешница + ножки
        box(c, X, Y + 6, w, 14, '#9a7552', { hi: '#b48c66' });
        px(c, X + 2, Y + 20, 3, 10, '#5e4630'); px(c, X + w - 5, Y + 20, 3, 10, '#5e4630');
        px(c, X + 6, Y + 20, w - 12, 5, '#7b5c3f');
        // монитор лицом к нам
        const mx = X + w / 2 - 15, my = Y - 14;
        box(c, mx, my, 30, 21, '#262833');
        drawScreen(c, mx + 2, my + 2, 26, 17, f.owner ? SCREEN[f.owner] : null, a?.busy, this.t, f.x + f.y);
        px(c, mx + 13, my + 21, 4, 3, '#3b3e4a'); px(c, mx + 9, my + 23, 12, 2, '#3b3e4a');
        // клавиатура, мышь, кружка, лампа
        box(c, X + w / 2 - 11, Y + 12, 22, 5, '#d9dce3', { outline: '#6b6f7c' });
        box(c, X + w / 2 + 15, Y + 13, 3, 4, '#d9dce3', { outline: '#6b6f7c' });
        box(c, X + 4, Y + 9, 6, 7, '#ffffff'); px(c, X + 4, Y + 9, 6, 2, f.owner ? `rgb(${GLOW[f.owner]})` : '#bbb');
        if (a?.busy) for (let i = 0; i < 2; i++) px(c, X + 6 + i * 2, Y + 4 - ((this.t * 8 + i * 4) % 8), 1, 3, 'rgba(255,255,255,.45)');
        px(c, X + w - 8, Y - 6, 2, 13, '#3a3a44'); box(c, X + w - 13, Y - 10, 10, 5, '#f39c12');
        if (!f.owner) { box(c, mx + 5, my + 3, 20, 13, '#ffeaa7', { outline: '#c9b458' }); c.font = '700 3.6px Inter, sans-serif'; c.fillStyle = '#7a6a1a'; c.textAlign = 'center'; c.fillText('ВАКАНСИЯ', mx + 15, my + 9); c.fillText('скоро', mx + 15, my + 14); }
        break;
      }
      case 'chair': {
        const cx = f.cx, cy = f.cy;
        ellipse(c, cx, cy + 4, 10, 3, 'rgba(0,0,0,.25)');
        px(c, cx - 1, cy - 4, 2, 7, '#2b2b33');
        px(c, cx - 8, cy + 2, 16, 2, '#2b2b33');
        const occupied = this.agents.get(f.owner)?.sittingAt?.x === cx;
        const bh = occupied ? 7 : 13;
        box(c, cx - 11, cy - 2 - bh, 22, bh, '#333846', { hi: '#454b5c' });
        px(c, cx - 8, cy - bh + 1, 16, 2, '#4f5669');
        break;
      }
      case 'bosschair': {
        const cx = f.cx, cy = f.cy;
        box(c, cx - 15, cy - 40, 30, 36, '#5a2a1c', { hi: '#7a3e2a' });
        for (let i = 0; i < 3; i++) px(c, cx - 10 + i * 9, cy - 34, 3, 3, '#e0b04a');
        break;
      }
      case 'plant': {
        const big = f.big;
        ellipse(c, X + 16, Y + 28, 11, 3, 'rgba(0,0,0,.22)');
        box(c, X + 8, Y + 16, 16, 13, '#c06a2b', { hi: '#d98a4a', lo: '#8e4a1c' });
        const sway = Math.sin(this.t * 1.2 + X) * 1;
        const leaves = big ? [[16, 2, 9], [8, 8, 8], [24, 8, 8], [16, -6, 7], [10, -1, 6], [22, -1, 6]] : [[16, 6, 8], [9, 11, 6], [23, 11, 6], [16, 0, 6]];
        for (const [dx, dy, r] of leaves) { ellipse(c, X + dx + sway, Y + dy, r + 1, r + 1, OUT); }
        for (const [dx, dy, r] of leaves) { ellipse(c, X + dx + sway, Y + dy, r, r, '#2e8b57'); ellipse(c, X + dx - 2 + sway, Y + dy - 2, r * 0.5, r * 0.5, '#43b97a'); }
        break;
      }
      case 'server':
        shadow();
        box(c, X + 3, Y - 30, 26, 58, '#262833', { hi: '#3a3d4a' });
        for (let i = 0; i < 6; i++) {
          px(c, X + 6, Y - 26 + i * 9, 20, 6, '#1a1c24');
          for (let j = 0; j < 3; j++) px(c, X + 8 + j * 4, Y - 24 + i * 9, 2, 2, Math.sin(this.t * (3 + i) + j * 2 + i) > 0.2 ? ['#2ecc71', '#5dade2', '#f1c40f'][j] : '#2c3e50');
        }
        break;
      case 'printer':
        shadow();
        box(c, X + 3, Y + 6, 26, 20, '#d6d9de', { hi: '#eef0f2', lo: '#b5b9bf' });
        px(c, X + 3, Y + 6, 26, 6, '#9aa0a6');
        box(c, X + 8, Y + 14 + Math.sin(this.t * 2), 16, 6, '#ffffff', { outline: '#b5b9bf' });
        px(c, X + 24, Y + 20, 3, 3, Math.sin(this.t * 3) > 0 ? '#2ecc71' : '#1e8449');
        break;
      case 'cooler':
        shadow();
        box(c, X + 8, Y + 6, 16, 22, '#ecf0f1', { lo: '#bdc3c7' });
        box(c, X + 9, Y - 12, 14, 18, 'rgba(110,190,255,.85)', { outline: '#4a7fa8' });
        px(c, X + 11, Y - 10, 3, 12, 'rgba(255,255,255,.5)');
        px(c, X + 12, Y + 12, 3, 3, '#e74c3c'); px(c, X + 17, Y + 12, 3, 3, '#3498db');
        break;
      case 'coffeetable':
        shadow();
        box(c, X + 4, Y + 8, w - 8, 14, '#7a5636', { hi: '#9a7250' });
        box(c, X + 16, Y + 10, 8, 6, '#ffffff'); box(c, X + 40, Y + 11, 16, 5, '#5dade2'); box(c, X + 66, Y + 9, 10, 8, '#e74c3c');
        break;
      case 'sofa':
        const sc = f.color || '#c0504d';
        if (part === 'back') {
          box(c, X, Y - 10, w, 18, sc, { hi: shade(sc, 0.15) });
          for (let i = 1; i < f.w; i++) px(c, X + i * T, Y - 8, 1, 14, shade(sc, -0.2));
        } else {
          box(c, X, Y + 6, w, 16, shade(sc, 0.1), { lo: shade(sc, -0.2) });
          box(c, X - 4, Y - 4, 8, 26, shade(sc, -0.2)); box(c, X + w - 4, Y - 4, 8, 26, shade(sc, -0.2));
          box(c, X + 10, Y - 4, 12, 8, '#ffd23f');
        }
        break;
      case 'bookcase':
        shadow();
        box(c, X + 2, Y - 26, 28, 54, '#6b4429');
        for (let s = 0; s < 3; s++) {
          px(c, X + 4, Y - 22 + s * 16, 24, 13, '#3a2416');
          for (let b = 0; b < 5; b++) px(c, X + 5 + b * 4.6, Y - 20 + s * 16 + (b % 2), 4, 11 - (b % 2), ['#c0392b', '#2980b9', '#f1c40f', '#27ae60', '#8e44ad'][(b + s) % 5]);
        }
        break;
      case 'bookshelf':
        box(c, X, Y - 30, w, h + 26, '#4a2f1d', { hi: '#5e3c26' });
        for (let s = 0; s < 3; s++) {
          px(c, X + 3, Y - 26 + s * 18, w - 6, 15, '#2c1b10');
          for (let b = 0; b < 11; b++) px(c, X + 4 + b * 5.4, Y - 24 + s * 18 + (b % 3), 4.4, 13 - (b % 3), ['#c0392b', '#2980b9', '#f1c40f', '#27ae60', '#8e44ad', '#e67e22'][(b + s * 2) % 6]);
        }
        ellipse(c, X + w - 12, Y - 34, 6, 6, '#3498db'); px(c, X + w - 13, Y - 28, 2, 4, '#7f6a4f');
        break;
      case 'couch':
        shadow();
        box(c, X, Y - 8, w, 14, '#2c5d8f', { hi: '#3a76b0' });
        box(c, X + 2, Y + 6, w - 4, 14, '#3a76b0', { lo: '#2c5d8f' });
        box(c, X - 3, Y - 2, 7, 22, '#244d78'); box(c, X + w - 4, Y - 2, 7, 22, '#244d78');
        break;
      case 'meeting': {
        ellipse(c, X + w / 2, Y + h, w / 2 + 6, 8, 'rgba(0,0,0,.2)');
        for (let i = 0; i < 4; i++) box(c, X + i * T + 8, Y - 8, 16, 10, '#3b3f4c', { hi: '#4d5262' });
        box(c, X, Y + 2, w, h - 10, '#e8e2d6', { hi: '#f6f2ea' });
        px(c, X, Y + h - 8, w, 6, '#bfb6a6');
        for (let i = 0; i < 4; i++) box(c, X + i * T + 8, Y + h - 4, 16, 9, '#3b3f4c', { hi: '#4d5262' });
        box(c, X + 18, Y + 12, 14, 10, '#ffffff', { outline: '#bbb' }); box(c, X + 84, Y + 22, 14, 10, '#ffffff', { outline: '#bbb' });
        box(c, X + 50, Y + 18, 22, 14, '#34495e'); drawScreen(c, X + 52, Y + 20, 18, 9, 'dash', true, this.t, 3);
        box(c, X + 106, Y + 14, 6, 7, '#ffffff');
        break;
      }
      case 'counter':
        box(c, X, Y + 4, w, h - 2, '#6b4f3a', { lo: '#523b2b' });
        for (let i = 0; i < f.w; i++) px(c, X + i * T + 15, Y + 12, 2, 12, '#523b2b');
        px(c, X - 1, Y - 1, w + 2, 10, OUT); px(c, X, Y, w, 8, '#d0d3d4'); px(c, X, Y, w, 2, '#eef0f1');
        // кофемашина
        box(c, X + 2 * T + 4, Y - 20, 22, 24, '#2c2c2c', { hi: '#444' });
        px(c, X + 2 * T + 8, Y - 15, 4, 3, '#e74c3c'); px(c, X + 2 * T + 14, Y - 15, 4, 3, '#2ecc71');
        box(c, X + 2 * T + 11, Y - 3, 7, 6, '#ffffff');
        for (let i = 0; i < 2; i++) px(c, X + 2 * T + 13 + i * 2, Y - 26 - ((this.t * 10 + i * 5) % 9), 1, 4, 'rgba(255,255,255,.45)');
        // микроволновка, раковина, фрукты
        box(c, X + 3 * T + 6, Y - 12, 24, 14, '#bdc3c7'); px(c, X + 3 * T + 9, Y - 9, 14, 8, '#2c3e50'); px(c, X + 3 * T + 25, Y - 9, 2, 8, '#7f8c8d');
        px(c, X + 6, Y + 1, 22, 5, '#95a5a6'); px(c, X + 15, Y - 6, 2, 7, '#bdc3c7');
        ellipse(c, X + T + 12, Y + 2, 5, 3, '#e74c3c'); ellipse(c, X + T + 20, Y + 2, 4, 3, '#f1c40f'); ellipse(c, X + T + 16, Y - 1, 4, 3, '#2ecc71');
        break;
      case 'fridge':
        shadow();
        box(c, X + 3, Y - 30, 26, 58, '#dfe6e9', { hi: '#f5f7f8', lo: '#b2bec3' });
        px(c, X + 3, Y - 4, 26, 2, '#b2bec3'); px(c, X + 24, Y - 24, 2, 14, '#95a5a6'); px(c, X + 24, Y + 2, 2, 12, '#95a5a6');
        box(c, X + 8, Y - 24, 6, 6, '#fdcb6e'); box(c, X + 15, Y - 20, 5, 5, '#81ecec');
        break;
      case 'vending': {
        shadow();
        box(c, X + 3, Y - 30, 26, 58, '#c0392b', { hi: '#e74c3c' });
        px(c, X + 6, Y - 26, 16, 34, '#1e2a38');
        for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) px(c, X + 7 + j * 5, Y - 24 + i * 8, 4, 5, ['#f1c40f', '#2ecc71', '#3498db', '#e67e22'][(i + j) % 4]);
        px(c, X + 23, Y - 20, 4, 10, '#95a5a6'); px(c, X + 6, Y + 14, 16, 6, '#111');
        break;
      }
      case 'greenscreen': {
        px(c, X + 2, Y - 40, 3, h + 40, '#3b3e4a'); px(c, X + w - 5, Y - 40, 3, h + 40, '#3b3e4a');
        box(c, X + 6, Y - 38, w - 12, 52, '#22c55e', { hi: '#4ade80' });
        for (let i = 1; i < 6; i++) px(c, X + 6 + i * (w - 12) / 6, Y - 36, 1, 50, 'rgba(0,0,0,.08)');
        px(c, X + 6, Y + 14, w - 12, 14, '#16a34a');
        break;
      }
      case 'ringlight': {
        ellipse(c, X + 16, Y + 28, 9, 3, 'rgba(0,0,0,.25)');
        px(c, X + 15, Y - 6, 2, 34, '#2b2b33'); px(c, X + 8, Y + 26, 16, 2, '#2b2b33');
        c.strokeStyle = OUT; c.lineWidth = 7; c.beginPath(); c.arc(X + 16, Y - 14, 11, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = '#fffbe6'; c.lineWidth = 5; c.beginPath(); c.arc(X + 16, Y - 14, 11, 0, Math.PI * 2); c.stroke();
        box(c, X + 13, Y - 19, 6, 10, '#111');
        break;
      }
      case 'camera': {
        const rec = [...this.agents.values()].some((a) => a.dept === 'yt' && a.busy);
        ellipse(c, X + 16, Y + 28, 9, 3, 'rgba(0,0,0,.25)');
        px(c, X + 15, Y - 2, 2, 28, '#2b2b33'); px(c, X + 7, Y + 26, 3, 2, '#2b2b33'); px(c, X + 22, Y + 26, 3, 2, '#2b2b33');
        box(c, X + 6, Y - 14, 20, 13, '#1b1b22', { hi: '#34343f' });
        box(c, X + 1, Y - 11, 6, 7, '#2b2b33');
        ellipse(c, X + 3, Y - 7.5, 2.5, 2.5, '#6c8cff');
        if (rec && Math.sin(this.t * 5) > 0) ellipse(c, X + 22, Y - 11, 2, 2, '#ff2d2d');
        break;
      }
      case 'tripod': {
        ellipse(c, X + 16, Y + 28, 9, 3, 'rgba(0,0,0,.25)');
        px(c, X + 15, Y - 6, 2, 34, '#2b2b33'); px(c, X + 8, Y + 26, 16, 2, '#2b2b33');
        box(c, X + 4, Y - 26, 24, 20, '#2b2b33');
        px(c, X + 6, Y - 24, 20, 16, '#fff7e0');
        break;
      }
      case 'editbay': {
        shadow();
        box(c, X, Y + 8, w, 12, '#2a2c38', { hi: '#3a3d4c' });
        px(c, X + 4, Y + 20, 3, 10, '#1d1f28'); px(c, X + w - 7, Y + 20, 3, 10, '#1d1f28');
        const r = this.render && this.t - this.render.at < 6 ? this.render : null;
        for (let i = 0; i < 3; i++) {
          const mx = X + 3 + i * 31, my = Y - 16;
          box(c, mx, my, 28, 20, '#16171f');
          if (r && i === 1) {
            px(c, mx + 2, my + 2, 24, 16, '#0b0c12');
            px(c, mx + 3, my + 12, 22, 3, '#2d3142'); px(c, mx + 3, my + 12, 22 * (r.pct / 100), 3, r.pct >= 100 ? '#2ecc71' : '#ff7a2f');
            c.font = '700 5px Inter, sans-serif'; c.textAlign = 'center'; c.fillStyle = '#fff';
            c.fillText(r.pct >= 100 ? 'ГОТОВО ✓' : `${r.pct}%`, mx + 14, my + 9);
          } else drawScreen(c, mx + 2, my + 2, 24, 16, i === 1 ? 'timeline' : i === 0 ? 'trends' : 'script', this.agents.get('gosha')?.busy || !!r, this.t + i, 7 + i);
        }
        box(c, X + w / 2 - 12, Y + 10, 24, 5, '#d9dce3', { outline: '#6b6f7c' });
        break;
      }
      case 'beanbag':
        ellipse(c, X + 16, Y + 26, 14, 5, 'rgba(0,0,0,.25)');
        ellipse(c, X + 16, Y + 16, 15, 12, OUT); ellipse(c, X + 16, Y + 16, 14, 11, f.color);
        ellipse(c, X + 12, Y + 12, 6, 4, 'rgba(255,255,255,.25)');
        break;
      case 'minifridge':
        shadow();
        box(c, X + 5, Y - 8, 22, 34, '#d7dbe2', { hi: '#f0f2f5' });
        px(c, X + 8, Y - 5, 16, 22, 'rgba(120,200,255,.35)');
        for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) px(c, X + 9 + j * 4, Y - 3 + i * 10, 3, 7, ['#00e676', '#ff1744', '#2979ff', '#ffd600'][(i + j) % 4]);
        px(c, X + 22, Y - 2, 2, 10, '#9aa0ad');
        break;
      case 'stage': {
        box(c, X + 2, Y + 4, w - 4, h - 8, '#3d4451', { hi: '#525a6a' });
        px(c, X + 2, Y + h - 6, w - 4, 4, '#2b313b');
        px(c, X + 6, Y + 8, w - 12, 1, 'rgba(255,255,255,.12)');
        for (let i = 0; i < 6; i++) ellipse(c, X + 14 + i * 32, Y + h - 5, 2, 1.5, Math.sin(this.t * 2 + i) > 0 ? '#ffd23f' : '#a4b0be');
        break;
      }
      case 'podium':
        shadow();
        box(c, X + 8, Y - 6, 16, 30, '#ffffff', { hi: '#ffffff', lo: '#dfe4ea' });
        px(c, X + 10, Y + 4, 12, 4, '#ff7a2f');
        px(c, X + 15, Y - 14, 2, 9, '#2f3542'); ellipse(c, X + 16, Y - 15, 3, 2, '#2f3542');
        break;
      case 'audience':
        for (let i = 0; i < f.w; i++) {
          const cx = X + i * T + 16;
          ellipse(c, cx, Y + 26, 9, 3, 'rgba(0,0,0,.15)');
          box(c, cx - 9, Y + 4, 18, 8, '#ff7a2f', { hi: '#ff9f5a' });
          box(c, cx - 8, Y + 12, 16, 10, '#ffa36b');
          px(c, cx - 7, Y + 22, 2, 6, '#636e72'); px(c, cx + 5, Y + 22, 2, 6, '#636e72');
        }
        break;
      case 'pod': {
        ellipse(c, X + w / 2, Y + h, w / 2, 8, 'rgba(0,0,0,.12)');
        px(c, X + 4, Y + 2, w - 8, h - 6, 'rgba(200,232,255,.35)');
        c.strokeStyle = '#a4b0be'; c.lineWidth = 2; c.strokeRect(X + 4, Y + 2, w - 8, h - 6);
        px(c, X + 4, Y + 2, w - 8, 3, '#dfe6e9');
        box(c, X + w / 2 - 34, Y + h / 2 - 12, 68, 22, '#ffffff', { outline: '#ced6e0' });
        for (let i = 0; i < 3; i++) { box(c, X + w / 2 - 30 + i * 24, Y + h / 2 - 22, 12, 8, '#2f3542'); box(c, X + w / 2 - 30 + i * 24, Y + h / 2 + 14, 12, 8, '#2f3542'); }
        box(c, X + w / 2 - 10, Y + h / 2 - 7, 20, 12, '#2f3542'); drawScreen(c, X + w / 2 - 8, Y + h / 2 - 5, 16, 8, 'slides', true, this.t, 4);
        c.font = '700 6px Inter, sans-serif'; c.fillStyle = '#57606f'; c.textAlign = 'left'; c.fillText('MEETING ROOM', X + 10, Y + 12);
        break;
      }
      case 'cowork':
        ellipse(c, X + w / 2, Y + h + 2, w / 2, 5, 'rgba(0,0,0,.12)');
        for (let i = 0; i < f.w; i++) { box(c, X + i * T + 8, Y - 10, 16, 8, '#57606f'); box(c, X + i * T + 8, Y + h + 2, 16, 8, '#57606f'); }
        box(c, X, Y + 2, w, h - 4, '#ffffff', { hi: '#ffffff', lo: '#dfe4ea' });
        for (let i = 0; i < f.w; i++) {
          box(c, X + i * T + 7, Y + 6, 18, 12, '#ced6e0'); px(c, X + i * T + 9, Y + 8, 14, 8, ['#74b9ff', '#55efc4', '#ffeaa7', '#fd79a8'][(i + f.x) % 4]);
          if (i % 2) box(c, X + i * T + 26, Y + 8, 4, 5, '#ff7a2f');
        }
        break;
      case 'coffeebar':
        box(c, X, Y + 4, w, h - 2, '#ffffff', { lo: '#dfe4ea' });
        px(c, X - 1, Y - 1, w + 2, 9, '#b9b4a8'); px(c, X, Y, w, 7, '#8d6e63');
        box(c, X + 10, Y - 20, 22, 22, '#2f3542', { hi: '#57606f' }); px(c, X + 14, Y - 15, 4, 3, '#2ecc71'); box(c, X + 17, Y - 3, 7, 6, '#ffffff');
        for (let i = 0; i < 2; i++) px(c, X + 19 + i * 2, Y - 26 - ((this.t * 10 + i * 5) % 9), 1, 4, 'rgba(120,120,120,.4)');
        box(c, X + 48, Y - 8, 26, 10, '#ffffff', { outline: '#ced6e0' }); ellipse(c, X + 55, Y - 4, 4, 3, '#e1b382'); ellipse(c, X + 66, Y - 4, 4, 3, '#e1b382');
        box(c, X + 86, Y - 14, 12, 16, '#55efc4'); box(c, X + 102, Y - 12, 10, 14, '#ffeaa7');
        break;
      case 'booth':
        shadow();
        box(c, X + 3, Y - 30, 26, 58, '#ffffff', { hi: '#ffffff', lo: '#dfe4ea' });
        px(c, X + 6, Y - 26, 20, 36, 'rgba(160,210,255,.55)'); px(c, X + 8, Y - 24, 3, 30, 'rgba(255,255,255,.7)');
        px(c, X + 12, Y - 6, 8, 2, '#2f3542');
        c.font = '6px sans-serif'; c.textAlign = 'center'; c.fillText('📞', X + 16, Y + 22);
        break;
      case 'flipchart':
        ellipse(c, X + 16, Y + 28, 10, 3, 'rgba(0,0,0,.15)');
        px(c, X + 8, Y + 10, 2, 18, '#636e72'); px(c, X + 22, Y + 10, 2, 18, '#636e72');
        box(c, X + 4, Y - 18, 24, 30, '#ffffff', { outline: '#a4b0be' });
        [[18, '#74b9ff'], [12, '#55efc4'], [6, '#ff7675']].forEach(([wd, col], i) => px(c, X + 16 - wd / 2, Y - 13 + i * 6, wd, 4, col));
        break;
      case 'bistro':
        ellipse(c, X + 16, Y + 28, 13, 4, 'rgba(0,0,0,.2)');
        px(c, X + 14, Y + 12, 4, 16, '#555');
        ellipse(c, X + 16, Y + 11, 15, 8, OUT); ellipse(c, X + 16, Y + 10, 14, 7, '#f5f5f5');
        box(c, X + 8, Y + 5, 5, 5, '#8e5a3c'); ellipse(c, X + 22, Y + 9, 4, 2, '#f39c12');
        break;
      case 'pingpong': {
        shadow();
        px(c, X + 8, Y + 20, 4, 10, '#444'); px(c, X + w - 12, Y + 20, 4, 10, '#444');
        box(c, X, Y + 2, w, 20, '#1e7a4c', { lo: '#155c39' });
        px(c, X, Y + 11, w, 1, '#ffffff'); px(c, X + 1, Y + 2, 1, 20, '#fff'); px(c, X + w - 2, Y + 2, 1, 20, '#fff');
        px(c, X + w / 2 - 1, Y - 4, 2, 26, '#dddddd');
        const bx = X + w / 2 + Math.sin(this.t * 3) * (w / 2 - 8);
        ellipse(c, bx, Y + 6 - Math.abs(Math.sin(this.t * 6)) * 10, 2.5, 2.5, '#ff9f43');
        box(c, X + 6, Y + 6, 5, 6, '#c0392b'); box(c, X + w - 11, Y + 12, 5, 6, '#2c3e50');
        break;
      }
      case 'arcade':
        shadow();
        box(c, X + 4, Y - 22, 24, 50, '#6c3fc4', { hi: '#8a5ce0' });
        px(c, X + 4, Y - 22, 24, 6, '#4a2a8a');
        px(c, X + 7, Y - 14, 18, 14, '#111');
        px(c, X + 10, Y - 11, 4, 4, `hsl(${(this.t * 80) % 360},80%,60%)`); px(c, X + 17, Y - 6 + Math.sin(this.t * 4) * 2, 4, 3, '#ffd23f');
        px(c, X + 6, Y + 2, 20, 6, '#3a2270'); px(c, X + 10, Y + 3, 3, 3, '#e74c3c'); px(c, X + 18, Y + 3, 3, 3, '#f1c40f');
        break;
    }
  }

  drawAgent(c, a) {
    if (this.selected === a.id || this.hover === a) {
      c.strokeStyle = this.selected === a.id ? '#ffd23f' : 'rgba(255,255,255,.7)';
      c.lineWidth = 2;
      c.beginPath(); c.ellipse(a.x, a.y + 1, 17, 6, 0, 0, Math.PI * 2); c.stroke();
    }
    if (this.t > a.blinkAt + 0.15) a.blinkAt = this.t + 2 + Math.random() * 4;
    const atDesk = a.sittingAt === a.seat;
    drawChar(c, a.x, a.y, a.look, {
      t: this.t + a.x * 0.01,
      walking: a.walking,
      sitting: a.sitting,
      dir: a.dir,
      blink: this.t > a.blinkAt,
      typing: atDesk && a.status === 'working',
      talking: a.bubble && this.t < a.bubble.until && Math.sin(this.t * 14) > 0,
    });
    if (atDesk && a.busy && a.boss) {
      const g = c.createRadialGradient(a.x, a.y - 30, 0, a.x, a.y - 30, 30);
      g.addColorStop(0, `rgba(${GLOW[a.id]},.25)`); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(a.x - 30, a.y - 60, 60, 60);
    }
  }

  headPos(a) {
    const top = a.isCat ? 22 : a.sitting ? 38 : 52;
    return this.toScreen(a.x, a.y - top);
  }

  drawSign(c, d) {
    const p = this.toScreen(d.x, d.y);
    if (p.x < -200 || p.x > this.vw + 200 || p.y < -30 || p.y > this.vh + 30) return;
    c.font = '700 12px Inter, system-ui, sans-serif';
    const w = c.measureText(d.text).width + 20;
    c.fillStyle = 'rgba(18,16,28,.78)';
    c.beginPath(); c.roundRect(p.x - w / 2, p.y - 11, w, 22, 11); c.fill();
    c.fillStyle = '#ffd23f'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(d.text, p.x, p.y + 0.5);
    c.textBaseline = 'alphabetic';
  }

  // прогресс рендера на монтажной стене
  setRender({ pct, label }) { this.render = { pct, label, at: this.t }; }

  // камера к департаменту
  goToArea(name) {
    const a = AREAS[name];
    if (!a) return;
    this.camT = { x: a.x, y: a.y, z: Math.max(this.minZ, Math.min(this.maxZ, Math.min(this.vw / a.w, this.vh / a.h) * 0.98)) };
    this.follow = null;
    this.userMoved = true;
  }

  drawLabel(c, a) {
    const p = this.toScreen(a.x, a.y);
    const y = p.y + 6;
    c.font = UI_FONT;
    const w = c.measureText(a.name).width + 22;
    c.fillStyle = 'rgba(18,16,28,.82)';
    c.beginPath(); c.roundRect(p.x - w / 2, y, w, 18, 9); c.fill();
    const dot = { idle: '#8e8aa3', thinking: '#f1c40f', working: '#2ecc71', managing: '#ff9f43', paused: '#74b9ff' }[a.status] || '#8e8aa3';
    ellipse(c, p.x - w / 2 + 9, y + 9, 3.5, 3.5, dot);
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(a.name, p.x + 5, y + 9.5);
    c.textBaseline = 'alphabetic';
  }

  drawBubble(c, a) {
    const p = this.headPos(a);
    if (p.x < -40 || p.x > this.vw + 40 || p.y < -10 || p.y > this.vh + 60) return;
    if (a.emote && this.t < a.emote.until) {
      const k = Math.min(1, (a.emote.until - this.t) * 2);
      c.globalAlpha = k;
      c.font = '700 18px Inter, sans-serif'; c.textAlign = 'center';
      c.fillText(a.emote.icon, p.x, p.y - 6 - Math.sin(this.t * 10) * 2);
      c.globalAlpha = 1;
      return;
    }
    let text = null;
    if (a.bubble && this.t < a.bubble.until) text = a.bubble.text;
    else if (a.busy && a.sittingAt === a.seat) text = a.status === 'thinking' ? '💭 думает' + '.'.repeat(1 + (Math.floor(this.t * 3) % 3)) : a.activity;
    else if (a.sleeping) text = 'z' + 'z'.repeat(Math.floor(this.t * 2) % 3) + '…';
    if (!text) return;
    c.font = UI_FONT;
    const maxW = Math.min(220, this.vw * 0.6);
    let tw = c.measureText(text).width;
    while (tw > maxW - 18 && text.length > 4) { text = text.slice(0, -2); tw = c.measureText(text + '…').width; if (tw <= maxW - 18) text += '…'; }
    const w = tw + 18, h = 24;
    const x = Math.max(4, Math.min(this.vw - w - 4, p.x - w / 2));
    const y = p.y - h - 10;
    c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.roundRect(x + 1, y + 2, w, h, 10); c.fill();
    c.fillStyle = a.busy ? '#fffdf3' : '#ffffff';
    c.beginPath(); c.roundRect(x, y, w, h, 10); c.fill();
    c.beginPath(); c.moveTo(p.x - 5, y + h - 1); c.lineTo(p.x + 5, y + h - 1); c.lineTo(p.x, y + h + 6); c.fill();
    if (a.busy && !a.isCat) { c.fillStyle = `rgb(${GLOW[a.id] || '255,210,80'})`; c.fillRect(x + 6, y + 6, 3, h - 12); }
    c.fillStyle = '#211d2e'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(text, x + (a.busy ? 13 : 9), y + h / 2 + 0.5);
    c.textBaseline = 'alphabetic';
  }
}

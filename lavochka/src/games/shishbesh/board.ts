/* Шиш-беш — деревянное поле (SVG): процедурная текстура, выжженные орнаменты, фишки и анимации.
 * Перенесено из первой версии игры почти без изменений. */
// @ts-nocheck — геометрия и SVG-строки перенесены как есть, типизация здесь ничего не даёт
import { Sound } from '../../core/audio';
import { HOME_START, isHouseG, toGlobal } from './engine';
import { SEATS } from './def';

const NS = 'http://www.w3.org/2000/svg';
const E = { SEATS, HOME_START, isHouseG, toGlobal };


const C = 50; // размер клетки
const F = 40; // ширина рамки
const O = F + 20; // отступ креста от края поля
const N = 15; // клеток по стороне: плечо 5 + центр 3 + плечо 5 + два стартовых выступа
const S = O * 2 + N * C; // 870
const MID = S / 2;
const PIECE_R = 18;
const BURN = '#2a1206';

// ---------- геометрия ----------
// Координаты креста: центр (6,6), плечи 0..4 и 8..12, стартовые клетки на -1 и 13.
const rotCell = ([x, y]) => [y, 12 - x];
const rotPt = ([x, y]) => [y, 13 - x];
const rotN = (f, p, n) => {
  for (let i = 0; i < n; i++) p = f(p);
  return p;
};
const cx2px = (c) => O + (c + 1) * C + C / 2; // центр клетки креста
const ex2px = (e) => O + (e + 1) * C; // «рёберная» координата креста
const cellXY = ([x, y]) => [cx2px(x), cx2px(y)];

// Четверть 0: верхняя дорожка правого плеча к центру, угол, правая колонка верхнего плеча, торец верхнего плеча.
const Q0 = [];
for (let i = 0; i < 5; i++) Q0.push([12 - i, 5]);
Q0.push([7, 5]);
for (let i = 0; i < 5; i++) Q0.push([7, 4 - i]);
Q0.push([6, 0]);
const TRACK = [];
for (let q = 0; q < 4; q++) for (const c of Q0) TRACK.push(rotN(rotCell, c, q));

const homeCell = (seat, j) => rotN(rotCell, [11 - j, 6], seat);
const startCell = (seat) => rotN(rotCell, [13, 5], seat);
const housePocket = (g) => {
  const q = Math.floor(g / 12);
  return rotN(rotCell, g % 12 === 2 ? [10, 4] : [8, 2], q);
};
const parkCenter = (seat) => {
  const [x, y] = rotN(rotPt, [11.5, 1.5], seat);
  return [ex2px(x), ex2px(y)];
};
const parkPit = (seat, k) => {
  const [x, y] = parkCenter(seat);
  const o = 25;
  const offs = [[-o, -o], [o, -o], [-o, o], [o, o]];
  return [x + offs[k][0], y + offs[k][1]];
};
// Поворот текста — «лицом» к игроку, сидящему у этого луча.
const armAngle = (seat) => -90 * (seat + 1);

// ---------- процедурная текстура дерева ----------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const G = 256;
  const v = new Float32Array(G * G);
  for (let i = 0; i < v.length; i++) v[i] = rnd();
  const sm = (t) => t * t * (3 - 2 * t);
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = sm(x - xi), yf = sm(y - yi);
    const x0 = xi & 255, y0 = yi & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
    const a = v[y0 * G + x0], b = v[y0 * G + x1], c = v[y1 * G + x0], d = v[y1 * G + x1];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

function woodTexture(size, seed) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = makeNoise(seed);
  const fbm = (x, y) => 0.5 * n(x, y) + 0.25 * n(x * 2.03, y * 2.03) + 0.125 * n(x * 4.1, y * 4.1) + 0.0625 * n(x * 8.3, y * 8.3);
  const L = [226, 182, 124], D = [168, 108, 56], K = [128, 76, 36];
  const sc = 930 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const X = x * sc, Y = y * sc;
      const warp = fbm(X * 0.0035, Y * 0.02) * 5 + fbm(X * 0.001, Y * 0.004) * 6;
      const r = Y * 0.035 + warp;
      let ring = r - Math.floor(r);
      ring = Math.pow(Math.sin(ring * Math.PI), 6);
      const fiber = n(X * 0.9, Y * 0.06);
      const blot = fbm(X * 0.006, Y * 0.006);
      let t = 0.42 * ring + 0.28 * fiber + 0.3 * blot;
      t = Math.min(1, Math.max(0, t));
      let c0 = L, c1 = D;
      if (t > 0.72) {
        c0 = D;
        c1 = K;
        t = (t - 0.72) / 0.28;
      } else t = t / 0.72;
      const i = (y * size + x) * 4;
      img.data[i] = c0[0] + (c1[0] - c0[0]) * t;
      img.data[i + 1] = c0[1] + (c1[1] - c0[1]) * t;
      img.data[i + 2] = c0[2] + (c1[2] - c0[2]) * t;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/jpeg', 0.9);
}

// ---------- орнаменты «выжигателем» ----------
const f1 = (v) => Math.round(v * 10) / 10;

const EMBLEMS = [
  // солнце
  () => {
    let s = `<circle r="4.2" fill="${BURN}"/>`;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      s += `<line x1="${f1(Math.cos(a) * 6.5)}" y1="${f1(Math.sin(a) * 6.5)}" x2="${f1(Math.cos(a) * 10)}" y2="${f1(Math.sin(a) * 10)}" stroke="${BURN}" stroke-width="1.8" stroke-linecap="round"/>`;
    }
    return s;
  },
  // лист
  () => `<path d="M0,-10 C8,-5 8,5 0,10 C-8,5 -8,-5 0,-10Z" fill="${BURN}"/><path d="M0,-7 L0,8 M0,-2 L3.5,-5 M0,2 L-3.5,-1 M0,5 L3,3" stroke="#e2b77c" stroke-width="1" fill="none"/>`,
  // луна
  () => `<path d="M3,-9.5 A10,10 0 1,0 3,9.5 A7.6,7.6 0 1,1 3,-9.5Z" fill="${BURN}"/>`,
  // звезда
  () => {
    let d = '';
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 4.2 : 10.5;
      d += (i ? 'L' : 'M') + f1(Math.cos(a) * r) + ',' + f1(Math.sin(a) * r);
    }
    return `<path d="${d}Z" fill="${BURN}"/>`;
  },
];

function mandala(cx, cy, R, seed) {
  const rnd = mulberry32(seed);
  let s = `<g transform="translate(${f1(cx)},${f1(cy)})" fill="none" stroke="${BURN}">`;
  s += `<circle r="${R}" stroke-width="2.4"/><circle r="${R - 6}" stroke-width="1.2"/>`;
  const rIn = R * 0.52;
  s += `<circle r="${f1(rIn)}" stroke-width="2.2"/><circle r="${f1(rIn - 5)}" stroke-width="1"/>`;
  // зубчатый пояс
  const nz = 48;
  let d = '';
  for (let i = 0; i <= nz; i++) {
    const a = (i / nz) * Math.PI * 2;
    const r = i % 2 ? R - 6 : R - 15;
    d += (i ? 'L' : 'M') + f1(Math.cos(a) * r) + ',' + f1(Math.sin(a) * r);
  }
  s += `<path d="${d}" stroke-width="1.2"/><circle r="${R - 15}" stroke-width="1"/>`;
  // лепестки
  const np = 12 + Math.floor(rnd() * 3) * 2;
  const r1 = rIn + 3, r2 = R - 20, rm = (r1 + r2) / 2;
  const w = ((Math.PI * 2 * rm) / np) * 0.55;
  for (let i = 0; i < np; i++) {
    const a = (i * 360) / np;
    s += `<g transform="rotate(${f1(a)})">`;
    s += `<path d="M0,${f1(-r1)} C${f1(w)},${f1(-rm + 4)} ${f1(w * 0.6)},${f1(-r2 + 2)} 0,${f1(-r2)} C${f1(-w * 0.6)},${f1(-r2 + 2)} ${f1(-w)},${f1(-rm + 4)} 0,${f1(-r1)}Z" stroke-width="1.6"/>`;
    s += `<path d="M0,${f1(-r1 - 5)} L0,${f1(-r2 + 7)}" stroke-width="1"/>`;
    s += `<circle cy="${f1(-rm)}" r="2.3" fill="${BURN}" stroke="none"/>`;
    s += `</g>`;
    const a2 = ((i + 0.5) * Math.PI * 2) / np;
    s += `<circle cx="${f1(Math.cos(a2 - Math.PI / 2) * (r2 - 3))}" cy="${f1(Math.sin(a2 - Math.PI / 2) * (r2 - 3))}" r="3" fill="${BURN}" stroke="none"/>`;
  }
  // узелковая «цепь» внутри
  const nc = 20;
  for (let i = 0; i < nc; i++) {
    const a = (i / nc) * Math.PI * 2;
    s += `<circle cx="${f1(Math.cos(a) * (rIn - 11))}" cy="${f1(Math.sin(a) * (rIn - 11))}" r="4" stroke-width="1"/>`;
  }
  s += `</g>`;
  return s;
}

function compass(x, y, r) {
  let s = `<g transform="translate(${x},${y})">`;
  for (let i = 0; i < 8; i++) {
    const long = i % 2 === 0;
    const L = long ? r : r * 0.6;
    const wdt = long ? r * 0.2 : r * 0.14;
    s += `<g transform="rotate(${i * 45})"><path d="M0,${-L} L${wdt},0 L0,${wdt * 0.6} L${-wdt},0Z" fill="${BURN}"/><path d="M0,${-L} L${wdt},0 L0,0Z" fill="#b98247"/></g>`;
  }
  s += `<circle r="${r * 0.14}" fill="#e2b77c" stroke="${BURN}" stroke-width="1.5"/></g>`;
  return s;
}

function arrow(x1, y1, x2, y2, head = 6) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const hd = (x, y, ang) => {
    const l = [x - Math.cos(ang - 0.45) * head, y - Math.sin(ang - 0.45) * head];
    const r = [x - Math.cos(ang + 0.45) * head, y - Math.sin(ang + 0.45) * head];
    return `M${f1(l[0])},${f1(l[1])} L${f1(x)},${f1(y)} L${f1(r[0])},${f1(r[1])}`;
  };
  return `<path d="M${f1(x1)},${f1(y1)} L${f1(x2)},${f1(y2)} ${hd(x2, y2, a)} ${hd(x1, y1, a + Math.PI)}" stroke="${BURN}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function wheel(x, y, r) {
  let s = `<g transform="translate(${x},${y})" stroke="${BURN}" fill="none"><circle r="${r}" stroke-width="2"/><circle r="${r * 0.3}" stroke-width="1.6"/>`;
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    s += `<line x1="${f1(Math.cos(a) * r * 0.3)}" y1="${f1(Math.sin(a) * r * 0.3)}" x2="${f1(Math.cos(a) * r)}" y2="${f1(Math.sin(a) * r)}" stroke-width="1.4"/>`;
  }
  return s + `</g>`;
}

function hut(x, y) {
  return `<g transform="translate(${x},${y})" stroke="${BURN}" fill="none" stroke-width="2" stroke-linejoin="round">
    <path d="M-14,-1 L0,-14 L14,-1"/><path d="M-10,-4 L-10,13 L10,13 L10,-4"/>
    <path d="M-3,13 L-3,4 L3,4 L3,13" fill="${BURN}"/><path d="M5,-9 L5,-15 L9,-15 L9,-5"/>
    <path d="M-7,1 L-7,6 L-2,6 L-2,1Z" stroke-width="1.2"/></g>`;
}

// клетка «песочные часы», как на средней дорожке классической доски
function hourglass(x, y, vertical) {
  const h = C / 2 - 3;
  const d = vertical
    ? `M${x - h},${y - h} L${x},${y} L${x - h},${y + h}Z M${x + h},${y - h} L${x},${y} L${x + h},${y + h}Z`
    : `M${x - h},${y - h} L${x + h},${y - h} L${x},${y}Z M${x - h},${y + h} L${x + h},${y + h} L${x},${y}Z`;
  return `<path d="${d}" fill="${BURN}" opacity="0.5"/>`;
}

function pips6(x, y) {
  let s = `<g transform="translate(${x},${y})" fill="${BURN}">`;
  for (const dy of [-11, 0, 11]) for (const dx of [-8, 8]) s += `<circle cx="${dx}" cy="${dy}" r="3.6"/>`;
  return s + `</g>`;
}

function frameBand() {
  // зубчатый орнамент по рамке + розетки по углам
  let s = '';
  const a = 9, b = S - 9, i1 = 31, i2 = S - 31;
  s += `<rect x="${a}" y="${a}" width="${b - a}" height="${b - a}" rx="10" fill="none" stroke="${BURN}" stroke-width="2"/>`;
  s += `<rect x="${i1}" y="${i1}" width="${i2 - i1}" height="${i2 - i1}" fill="none" stroke="${BURN}" stroke-width="2"/>`;
  const step = 22;
  const side = (horiz, fixedA, fixedB) => {
    let d = '';
    const from = 44, to = S - 44;
    const n = Math.floor((to - from) / step);
    const st = (to - from) / n;
    for (let k = 0; k <= n; k++) {
      const p = from + k * st;
      const q = k % 2 ? fixedB : fixedA;
      d += (k ? 'L' : 'M') + (horiz ? `${f1(p)},${f1(q)}` : `${f1(q)},${f1(p)}`);
    }
    for (let k = 0; k < n; k += 2) {
      const p = from + (k + 1) * st;
      s += horiz ? `<circle cx="${f1(p)}" cy="${f1(fixedA + (fixedB - fixedA) * 0.25)}" r="1.8" fill="${BURN}"/>` : `<circle cx="${f1(fixedA + (fixedB - fixedA) * 0.25)}" cy="${f1(p)}" r="1.8" fill="${BURN}"/>`;
    }
    s += `<path d="${d}" fill="none" stroke="${BURN}" stroke-width="1.5" stroke-linejoin="round"/>`;
  };
  side(true, 14, 26);
  side(true, S - 14, S - 26);
  side(false, 14, 26);
  side(false, S - 14, S - 26);
  for (const [x, y] of [[20, 20], [S - 20, 20], [20, S - 20], [S - 20, S - 20]]) {
    s += `<g transform="translate(${x},${y})"><circle r="13" fill="#caa06a" stroke="${BURN}" stroke-width="2"/>`;
    for (let i = 0; i < 8; i++) s += `<ellipse rx="2.4" ry="7" transform="rotate(${i * 45}) translate(0,-5)" fill="${BURN}"/>`;
    s += `<circle r="2.5" fill="#caa06a"/></g>`;
  }
  return s;
}

// ---------- класс поля ----------
let boardCounter = 0;
let woodCache = null;

export class Board {
  /** Уникальные id внутри SVG: на странице может быть несколько полей (игра + показ правил). */
  _u(html) {
    return html.replace(/id="([\w-]+)"/g, `id="$1-${this.uid}"`).replace(/url\(#([\w-]+)\)/g, `url(#$1-${this.uid})`);
  }

  constructor(svg) {
    this.svg = svg;
    this.uid = 'sb' + ++boardCounter;
    this.pieceEls = new Map();
    this.speed = 1;
    this.rotation = 0;
    this.onMove = null;
    this.moves = [];
    this.selected = null;
    this.build();
  }

  build() {
    const svg = this.svg;
    svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
    const wood = (woodCache ||= woodTexture(620, 7));
    const defs = `
    <defs>
      <filter id="burn" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="3" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G" result="d"/>
        <feMorphology in="d" operator="dilate" radius="1.2" result="thick"/>
        <feGaussianBlur in="thick" stdDeviation="2.2" result="blur"/>
        <feFlood flood-color="#5a2a0a" flood-opacity="0.38"/>
        <feComposite in2="blur" operator="in" result="halo"/>
        <feGaussianBlur in="d" stdDeviation="0.35" result="core"/>
        <feMerge><feMergeNode in="halo"/><feMergeNode in="core"/></feMerge>
      </filter>
      <filter id="pieceShadow" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="2" dy="3" stdDeviation="2.2" flood-color="#1a0a02" flood-opacity="0.55"/>
      </filter>
      <filter id="liftShadow" x="-60%" y="-60%" width="220%" height="220%">
        <feDropShadow dx="6" dy="10" stdDeviation="5" flood-color="#1a0a02" flood-opacity="0.45"/>
      </filter>
      <radialGradient id="pitGrad" cx="45%" cy="40%" r="60%">
        <stop offset="0%" stop-color="#3b1c08" stop-opacity="0.75"/>
        <stop offset="75%" stop-color="#5e3212" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#8a5226" stop-opacity="0.2"/>
      </radialGradient>
      <linearGradient id="frameShade" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.12"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.18"/>
      </linearGradient>
      ${E.SEATS.map(
        (s, i) => `<radialGradient id="pg${i}" cx="38%" cy="32%" r="75%">
          <stop offset="0%" stop-color="${s.light}"/><stop offset="55%" stop-color="${s.color}"/><stop offset="100%" stop-color="${s.dark}"/></radialGradient>`
      ).join('')}
      <clipPath id="boardClip"><rect width="${S}" height="${S}" rx="18"/></clipPath>
    </defs>`;

    let stat = '';
    // основа
    stat += `<g clip-path="url(#boardClip)"><image href="${wood}" width="${S}" height="${S}" preserveAspectRatio="none"/>`;
    stat += `<path d="M0,0H${S}V${S}H0Z M${F},${F}V${S - F}H${S - F}V${F}Z" fill-rule="evenodd" fill="#4a2208" opacity="0.42"/>`;
    stat += `<path d="M0,0H${S}V${S}H0Z M${F},${F}V${S - F}H${S - F}V${F}Z" fill-rule="evenodd" fill="url(#frameShade)"/>`;
    stat += `<rect x="${F}" y="${F}" width="${S - 2 * F}" height="${S - 2 * F}" fill="none" stroke="#2a1206" stroke-opacity="0.5" stroke-width="3"/>`;
    stat += `<rect x="${F + 3}" y="${F + 3}" width="${S - 2 * F - 6}" height="${S - 2 * F - 6}" fill="none" stroke="#fff3d6" stroke-opacity="0.18" stroke-width="2"/>`;
    stat += `</g>`;

    // пятна-морилка цветов игроков
    let stain = `<g style="mix-blend-mode:multiply" opacity="0.62">`;
    for (let s = 0; s < 4; s++) {
      const col = E.SEATS[s].color;
      const cell = (c, inset = 2) => {
        const [x, y] = cellXY(c);
        return `<rect x="${x - C / 2 + inset}" y="${y - C / 2 + inset}" width="${C - 2 * inset}" height="${C - 2 * inset}" fill="${col}"/>`;
      };
      stain += cell(startCell(s));
      for (let j = 0; j < 4; j++) stain += cell(homeCell(s, j));
      const [px, py] = parkCenter(s);
      stain += `<circle cx="${px}" cy="${py}" r="${C * 1.2 - 4}" fill="${col}" opacity="0.55"/>`;
    }
    // углы и центр креста — тёмные, как на классической доске
    for (let q = 0; q < 4; q++) {
      const [x, y] = cellXY(TRACK[q * 12 + 5]);
      stain += `<rect x="${x - C / 2 + 2}" y="${y - C / 2 + 2}" width="${C - 4}" height="${C - 4}" fill="#3a1a06" opacity="0.95"/>`;
    }
    {
      const [x, y] = cellXY([6, 6]);
      stain += `<rect x="${x - C / 2 + 2}" y="${y - C / 2 + 2}" width="${C - 4}" height="${C - 4}" fill="#3a1a06" opacity="0.95"/>`;
    }
    stain += `</g>`;

    // выжженные линии
    let burn = `<g filter="url(#burn)">`;
    burn += frameBand();
    const rect = ([cx, cy], extra = '') => {
      const [x, y] = cellXY([cx, cy]);
      return `<rect x="${x - C / 2}" y="${y - C / 2}" width="${C}" height="${C}" fill="none" stroke="${BURN}" stroke-width="2.2" ${extra}/>`;
    };
    const allCells = new Set();
    TRACK.forEach((c) => allCells.add(c.join(',')));
    for (let s = 0; s < 4; s++) {
      for (let j = 0; j < 4; j++) allCells.add(homeCell(s, j).join(','));
      allCells.add(startCell(s).join(','));
    }
    for (const c of [[6, 5], [5, 6], [7, 6], [6, 7], [6, 6]]) allCells.add(c.join(','));
    allCells.forEach((k) => (burn += rect(k.split(',').map(Number))));

    // «песочные часы» на средней дорожке каждого луча: торец + 4 клетки домика
    for (let s = 0; s < 4; s++) {
      const cells = [TRACK[((s + 3) % 4) * 12 + 11]];
      for (let j = 0; j < 4; j++) cells.push(homeCell(s, j));
      const vertical = s % 2 === 1;
      for (const c of cells) burn += hourglass(...cellXY(c), vertical);
    }

    // стартовые поля: треугольник-указатель к первой клетке
    for (let s = 0; s < 4; s++) {
      const [x, y] = cellXY(startCell(s));
      const [nx, ny] = cellXY(TRACK[s * 12]);
      const ang = (Math.atan2(ny - y, nx - x) * 180) / Math.PI;
      burn += `<g transform="translate(${x},${y}) rotate(${ang})"><path d="M-17,-17 L15,0 L-17,17Z" fill="${BURN}" opacity="0.85"/></g>`;
    }
    // домики-укрытия
    for (let g = 0; g < 48; g++) {
      if (!E.isHouseG(g)) continue;
      const [x, y] = cellXY(housePocket(g));
      burn += `<rect x="${x - C / 2 + 3}" y="${y - C / 2 + 3}" width="${C - 6}" height="${C - 6}" rx="4" fill="none" stroke="${BURN}" stroke-width="2.4"/>`;
      burn += hut(x, y);
    }

    // номера клеток плеч
    for (let g = 0; g < 48; g++) {
      const idx = g % 12;
      if (idx === 5 || idx === 11) continue;
      const q = Math.floor(g / 12);
      const arm = idx < 5 ? q : (q + 1) % 4;
      const [x, y] = cellXY(TRACK[g]);
      const num = idx < 5 ? idx + 1 : 11 - idx;
      burn += `<text x="${x}" y="${y}" transform="rotate(${armAngle(arm)} ${x} ${y})" text-anchor="middle" dominant-baseline="central" font-family="PT Serif, Georgia, serif" font-size="19" font-weight="700" fill="${BURN}" opacity="0.6">${num}</text>`;
    }

    // центр креста: углы, стрелки, роза ветров
    for (let q = 0; q < 4; q++) {
      const [x, y] = cellXY(TRACK[q * 12 + 5]);
      burn += wheel(x, y, 15).replace(/stroke="#2a1206"/, 'stroke="#f0cf9a"');
    }
    {
      const [ax, ay] = cellXY([6, 5]);
      burn += arrow(ax - 17, ay, ax + 17, ay);
      const [bx, by] = cellXY([6, 7]);
      burn += arrow(bx - 17, by, bx + 17, by);
      const [lx, ly] = cellXY([5, 6]);
      burn += arrow(lx, ly - 17, lx, ly + 17);
      const [rx, ry] = cellXY([7, 6]);
      burn += arrow(rx, ry - 17, rx, ry + 17);
      const [mx, my] = cellXY([6, 6]);
      burn += arrow(mx - 17, my - 17, mx + 17, my + 17, 5).replace(/stroke="#2a1206"/, 'stroke="#f0cf9a"');
      burn += arrow(mx + 17, my - 17, mx - 17, my + 17, 5).replace(/stroke="#2a1206"/, 'stroke="#f0cf9a"');
      burn += compass(mx, my, 12);
    }
    // мандалы-парки
    for (let s = 0; s < 4; s++) {
      const [px, py] = parkCenter(s);
      burn += mandala(px, py, C * 2.36, 11 + s * 7);
    }
    // угловые завитки на поле
    for (const [x, y, r] of [[F + 16, F + 16, 0], [S - F - 16, F + 16, 90], [S - F - 16, S - F - 16, 180], [F + 16, S - F - 16, 270]]) {
      burn += `<g transform="translate(${x},${y}) rotate(${r})" fill="none" stroke="${BURN}" stroke-width="1.6">
        <path d="M-4,-4 C30,-4 44,10 40,26 C37,36 24,34 26,24 C28,16 36,20 34,26"/>
        <path d="M-4,-4 C-4,30 10,44 26,40 C36,37 34,24 24,26 C16,28 20,36 26,34"/>
        <circle cx="-2" cy="-2" r="3" fill="${BURN}"/></g>`;
    }
    burn += `</g>`;

    // лунки парков
    let pits = '';
    for (let s = 0; s < 4; s++) {
      for (let k = 0; k < 4; k++) {
        const [x, y] = parkPit(s, k);
        pits += `<circle cx="${x}" cy="${y}" r="${PIECE_R + 4}" fill="url(#pitGrad)"/>`;
        pits += `<circle cx="${x}" cy="${y}" r="${PIECE_R + 4}" fill="none" stroke="#2a1206" stroke-width="1.5" opacity="0.7"/>`;
      }
    }

    svg.innerHTML = this._u(`${defs}<g id="rotor">${stat}${stain}${burn}<g id="pits">${pits}</g><g id="lastmove"></g><g id="marks"></g><g id="pieces"></g><g id="targets"></g></g>`);
    this.rotor = svg.querySelector('#rotor-' + this.uid);
    this.gPieces = svg.querySelector('#pieces-' + this.uid);
    this.gMarks = svg.querySelector('#marks-' + this.uid);
    this.gTargets = svg.querySelector('#targets-' + this.uid);
    this.gLast = svg.querySelector('#lastmove-' + this.uid);
    svg.addEventListener('click', (e) => {
      if (e.target === svg || e.target.closest('#rotor-' + this.uid) && !e.target.closest('.piece') && !e.target.closest('.target')) this.clearSelection();
    });
  }

  setRotation(seatAtBottom) {
    // по умолчанию снизу — место 3
    this.rotation = seatAtBottom == null ? 0 : -90 * ((3 - seatAtBottom + 4) % 4);
    this.rotor.setAttribute('transform', `rotate(${this.rotation} ${MID} ${MID})`);
    this.pieceEls.forEach((el) => this._applyTransform(el));
  }

  // ---------- фишки ----------
  initPieces(state) {
    this.gPieces.innerHTML = '';
    this.pieceEls.clear();
    for (const pl of state.players) {
      for (let k = 0; k < 4; k++) {
        const g = document.createElementNS(NS, 'g');
        g.setAttribute('class', 'piece');
        g.dataset.seat = pl.seat;
        g.dataset.k = k;
        g.innerHTML = this._u(`<g class="piece-body" filter="url(#pieceShadow)">
            <circle r="${PIECE_R + 6}" class="piece-ring" fill="none"/>
            <circle r="${PIECE_R}" fill="url(#pg${pl.seat})" stroke="${E.SEATS[pl.seat].dark}" stroke-width="2"/>
            <circle r="${PIECE_R - 4.5}" fill="none" stroke="${E.SEATS[pl.seat].dark}" stroke-width="1.2" opacity="0.7"/>
            <g class="emblem" opacity="0.78" transform="scale(0.95)">${EMBLEMS[pl.seat]().replace(/#2a1206/g, E.SEATS[pl.seat].dark)}</g>
            <ellipse cx="-6" cy="-8" rx="7" ry="4" fill="#fff" opacity="0.22" transform="rotate(-30 -6 -8)"/>
          </g>`);
        g.addEventListener('click', (e) => {
          e.stopPropagation();
          this._pieceClick(pl.seat, k);
        });
        this.gPieces.appendChild(g);
        this.pieceEls.set(pl.seat + '-' + k, g);
      }
    }
    this.render(state, false);
  }

  layout(state) {
    const out = new Map();
    for (const pl of state.players) {
      pl.pieces.forEach((p, k) => {
        out.set(pl.seat + '-' + k, p < 0 ? parkPit(pl.seat, k) : this.posXY(pl.seat, p, pl.house[k]));
      });
    }
    return out;
  }

  posXY(seat, p, inHouse = false) {
    if (p < 0) return null;
    if (p === 0) return cellXY(startCell(seat));
    if (p >= E.HOME_START) return cellXY(homeCell(seat, p - E.HOME_START));
    const g = E.toGlobal(seat, p);
    return cellXY(inHouse ? housePocket(g) : TRACK[g]);
  }

  _applyTransform(el) {
    const s = el._s || 1;
    // эмблему держим «прямо» для зрителя
    el.setAttribute('transform', `translate(${f1(el._x)},${f1(el._y)}) rotate(${-this.rotation}) scale(${s})`);
  }

  _setPos(el, x, y, s = 1) {
    el._x = x;
    el._y = y;
    el._s = s;
    this._applyTransform(el);
  }

  render(state, animate = true) {
    const lay = this.layout(state);
    const jobs = [];
    lay.forEach(([x, y], key) => {
      const el = this.pieceEls.get(key);
      if (!el) return;
      if (!animate || el._x == null) this._setPos(el, x, y);
      else if (Math.abs(el._x - x) > 0.5 || Math.abs(el._y - y) > 0.5) jobs.push(this._tween(el, [el._x, el._y], [x, y], 160, 0));
    });
    return Promise.all(jobs);
  }

  _tween(el, a, b, dur, lift = 10) {
    dur = dur / this.speed;
    return new Promise((res) => {
      const t0 = performance.now();
      const body = el.querySelector('.piece-body');
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        body.setAttribute('filter', `url(#pieceShadow-${this.uid})`);
        this._setPos(el, b[0], b[1], 1);
        res();
      };
      // во вкладке в фоне requestAnimationFrame не вызывается — не даём очереди зависнуть
      if (document.hidden) return finish();
      setTimeout(finish, dur + 250);
      if (lift > 20) body.setAttribute('filter', `url(#liftShadow-${this.uid})`);
      const tick = (now) => {
        if (done) return;
        let t = Math.min(1, (now - t0) / dur);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const arc = Math.sin(Math.PI * t);
        const x = a[0] + (b[0] - a[0]) * e;
        const y = a[1] + (b[1] - a[1]) * e;
        this._setPos(el, x, y, 1 + arc * lift * 0.012);
        if (t < 1) requestAnimationFrame(tick);
        else finish();
      };
      requestAnimationFrame(tick);
    });
  }

  async animateMove(ev, finalState) {
    const Snd = Sound;
    const el = this.pieceEls.get(ev.seat + '-' + ev.piece);
    this.clearInteraction();
    if (!el) return this.render(finalState, false);
    this.gPieces.appendChild(el);
    this._markLast(ev);
    let cur = [el._x, el._y];
    if (ev.kind === 'enter') {
      const to = this.posXY(ev.seat, 0);
      await this._tween(el, cur, to, 420, 30);
      Snd.enter();
    } else if (ev.kind === 'jump') {
      Snd.jump();
      const to = this.posXY(ev.seat, ev.to);
      await this._tween(el, cur, to, 620, 45);
      Snd.place();
    } else {
      for (let i = 0; i < ev.path.length; i++) {
        const last = i === ev.path.length - 1;
        const to = this.posXY(ev.seat, ev.path[i], last && ev.house);
        await this._tween(el, cur, to, 170, 12);
        cur = to;
        if (i < ev.path.length - 1) Snd.step();
      }
      if (ev.to >= E.HOME_START || ev.house) Snd.home();
      else Snd.place();
    }
    if (ev.captured && ev.captured.length) {
      Snd.capture();
      await Promise.all(
        ev.captured.map((c) => {
          const cel = this.pieceEls.get(c.seat + '-' + c.piece);
          if (!cel) return null;
          this.gPieces.appendChild(cel);
          return this._tween(cel, [cel._x, cel._y], parkPit(c.seat, c.piece), 650, 40);
        })
      );
    }
    await this.render(finalState, true);
  }

  _markLast(ev) {
    const pts = [];
    if (ev.from >= 0) pts.push(this.posXY(ev.seat, ev.from));
    else pts.push(parkPit(ev.seat, ev.piece));
    pts.push(this.posXY(ev.seat, ev.to, ev.house));
    const col = E.SEATS[ev.seat].light;
    this.gLast.innerHTML = pts
      .map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i ? 23 : 16}" fill="none" stroke="${col}" stroke-width="${i ? 3 : 2}" stroke-dasharray="${i ? '' : '4 4'}" opacity="0.8"/>`)
      .join('');
  }

  // ---------- взаимодействие ----------
  setInteraction(moves, onMove) {
    this.moves = moves;
    this.onMove = onMove;
    this.selected = null;
    this.gTargets.innerHTML = '';
    const movable = new Set(moves.map((m) => m.piece));
    this.pieceEls.forEach((el) => el.classList.remove('movable', 'selected'));
    movable.forEach((k) => {
      const el = this.pieceEls.get(this._curSeat + '-' + k);
      if (el) {
        el.classList.add('movable');
        this.gPieces.appendChild(el);
      }
    });
  }

  clearInteraction() {
    this.moves = [];
    this.onMove = null;
    this.selected = null;
    this.gTargets.innerHTML = '';
    this.pieceEls.forEach((el) => el.classList.remove('movable', 'selected'));
  }

  clearSelection() {
    this.selected = null;
    this.gTargets.innerHTML = '';
    this.pieceEls.forEach((el) => el.classList.remove('selected'));
  }

  _pieceClick(seat, k) {
    if (!this.onMove || seat !== this._curSeat) return;
    const mv = this.moves.filter((m) => m.piece === k);
    if (!mv.length) return;
    const uniq = new Map();
    for (const m of mv) {
      const key = m.to + ':' + m.kind;
      if (!uniq.has(key)) uniq.set(key, m);
    }
    const opts = [...uniq.values()];
    if (opts.length === 1) {
      const cb = this.onMove;
      this.clearInteraction();
      cb(opts[0]);
      return;
    }
    this.selected = k;
    this.pieceEls.forEach((el) => el.classList.remove('selected'));
    this.pieceEls.get(seat + '-' + k).classList.add('selected');
    this.gTargets.innerHTML = '';
    const byPos = new Map();
    for (const m of opts) {
      const [x, y] = this.posXY(seat, m.to);
      const pk = x + ',' + y;
      if (!byPos.has(pk)) byPos.set(pk, []);
      byPos.get(pk).push(m);
    }
    byPos.forEach((list) => {
      const m = list[0];
      const [x, y] = this.posXY(seat, m.to);
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'target' + (m.kind === 'jump' ? ' jump' : ''));
      g.setAttribute('transform', `translate(${x},${y})`);
      const label = m.kind === 'jump' ? (m.value === 1 ? '↷1' : '✕3') : String(m.value);
      g.innerHTML = `<circle r="21" class="t-bg"/><text transform="rotate(${-this.rotation})" text-anchor="middle" dominant-baseline="central" class="t-label">${label}</text>`;
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        const cb = this.onMove;
        this.clearInteraction();
        if (cb) cb(m);
      });
      this.gTargets.appendChild(g);
    });
  }

  setCurrentSeat(seat) {
    this._curSeat = seat;
  }
}

export const BoardGeom = { TRACK, homeCell, parkPit, cellXY, S };

/* Тафл — отрисовка по фото настоящих досок.
 * «Резная»: тонированное дерево, по краю — выжженная кельтская плетёнка и узлы в углах, клетки — прорезями, на угловых клетках
 * и на троне — крестики; фигуры — точёные «бочонки»: нападающие морёные чёрные, защитники светлые, у короля латунная пирамидка.
 * «С рунами»: светлая фанера, выжженные линии, руны по краям, узлы на угловых клетках, диагонали от углов;
 * фигуры — круглые щиты с латунным умбоном: у нападающих щит в четыре четверти, у защитников — с «ёлочкой», король — латунный. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { woodTexture, WOODS } from '../../core/wood';
import { ATT, isCorner, KING, legal, RULES, throneOf, type Action, type Event, type State } from './engine';
import './tafl.css';

const F = 1.05; // поле с орнаментом
let walnut = '';
let birch = '';

const cx = (s: State, p: number) => F + (p % s.n) + 0.5;
const cy = (s: State, p: number) => F + Math.floor(p / s.n) + 0.5;

/** Руны — прямыми чертами в квадрате 0…1 (выжигают резцом, шрифт не нужен). */
const RUNES: number[][][] = [
  [[0.3, 0, 0.3, 1], [0.3, 0.15, 0.75, 0], [0.3, 0.45, 0.75, 0.3]], // ᚠ
  [[0.3, 0, 0.3, 1], [0.3, 0, 0.75, 0.35], [0.75, 0.35, 0.75, 1]], // ᚢ
  [[0.3, 0, 0.3, 1], [0.3, 0.25, 0.7, 0.5], [0.7, 0.5, 0.3, 0.75]], // ᚦ
  [[0.3, 0, 0.3, 1], [0.3, 0, 0.7, 0.25], [0.7, 0.25, 0.3, 0.5], [0.3, 0.5, 0.7, 1]], // ᚱ
  [[0.3, 0, 0.3, 1], [0.7, 0, 0.7, 1], [0.3, 0.35, 0.7, 0.6]], // ᚺ
  [[0.5, 0, 0.5, 1], [0.25, 0.35, 0.75, 0.6]], // ᚾ
  [[0.5, 0, 0.5, 1]], // ᛁ
  [[0.5, 0, 0.5, 1], [0.2, 0.3, 0.5, 0], [0.8, 0.3, 0.5, 0]], // ᛏ
  [[0.3, 0, 0.3, 1], [0.3, 0, 0.7, 0.25], [0.7, 0.25, 0.3, 0.5], [0.3, 0.5, 0.7, 0.75], [0.7, 0.75, 0.3, 1]], // ᛒ
  [[0.2, 0, 0.8, 1], [0.8, 0, 0.2, 1]], // ᚷ
  [[0.5, 0, 0.5, 1], [0.5, 0.3, 0.15, 0], [0.5, 0.3, 0.85, 0]], // ᛉ
  [[0.3, 0, 0.3, 1], [0.7, 0, 0.7, 1], [0.3, 0, 0.7, 0.4], [0.7, 0, 0.3, 0.4]], // ᛗ
];

function runeRow(x0: number, y0: number, h: number, count: number, seed: number, vertical = false): string {
  let d = '';
  const w = h * 0.55;
  for (let i = 0; i < count; i++) {
    const r = RUNES[(i * 5 + seed) % RUNES.length];
    for (const [a, b, c, e] of r) {
      if (vertical) {
        // по вертикали руны повёрнуты: читаются сверху вниз
        const ox = x0;
        const oy = y0 + i * w * 1.5;
        d += `M${ox + (1 - b) * h} ${oy + a * w}L${ox + (1 - e) * h} ${oy + c * w}`;
      } else {
        const ox = x0 + i * w * 1.5;
        d += `M${ox + a * w} ${y0 + b * h}L${ox + c * w} ${y0 + e * h}`;
      }
    }
  }
  return d;
}

/** Плетёнка: две переплетённые волны вдоль отрезка. */
function braid(x1: number, y1: number, x2: number, y2: number, amp: number, period: number): string {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const steps = Math.max(8, Math.round((len / period) * 12));
  let a = '';
  let b = '';
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * len;
    const w = Math.sin((t / period) * Math.PI * 2) * amp;
    const px = x1 + ux * t;
    const py = y1 + uy * t;
    a += `${i ? 'L' : 'M'}${px - uy * w} ${py + ux * w}`;
    b += `${i ? 'L' : 'M'}${px + uy * w} ${py - ux * w}`;
  }
  return a + b;
}

/** Угловой узел: три петли-трикветр. */
function knot(x: number, y: number, r: number): string {
  let d = '';
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3 - Math.PI / 2;
    const px = x + Math.cos(a) * r * 0.45;
    const py = y + Math.sin(a) * r * 0.45;
    d += `M${px + r * 0.5} ${py}A${r * 0.5} ${r * 0.5} 0 1 1 ${px + r * 0.5 - 0.001} ${py}`;
  }
  d += `M${x + r * 0.42} ${y}A${r * 0.42} ${r * 0.42} 0 1 1 ${x + r * 0.42 - 0.001} ${y}`;
  return d;
}

function defs(): string {
  return `<defs>
    <radialGradient id="tf-dark" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#4a4440"/><stop offset="0.65" stop-color="#1e1a18"/><stop offset="1" stop-color="#0a0807"/></radialGradient>
    <radialGradient id="tf-light" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fbe6c4"/><stop offset="0.65" stop-color="#e2be8c"/><stop offset="1" stop-color="#a8804e"/></radialGradient>
    <radialGradient id="tf-brass" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff2b0"/><stop offset="0.5" stop-color="#d4a83a"/><stop offset="1" stop-color="#7a5410"/></radialGradient>
    <radialGradient id="tf-sh" cx="50%" cy="50%" r="50%"><stop offset="0.55" stop-color="#000" stop-opacity="0.5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    ${walnut ? `<pattern id="tf-walnut" patternUnits="userSpaceOnUse" width="7" height="7"><image href="${walnut}" width="7" height="7" preserveAspectRatio="none"/></pattern>` : ''}
    ${birch ? `<pattern id="tf-birch" patternUnits="userSpaceOnUse" width="7" height="7"><image href="${birch}" width="7" height="7" preserveAspectRatio="none"/></pattern>` : ''}
  </defs>`;
}

function board(s: State): string {
  const n = s.n;
  const W = n + 2 * F;
  const throne = throneOf(n);
  const special = (p: number) => p === throne || (RULES[s.cfg.kind].corners && isCorner(n, p));
  let o = defs();
  let grid = '';
  for (let i = 0; i <= n; i++) grid += `M${F + i} ${F}V${F + n}M${F} ${F + i}H${F + n}`;
  if (s.cfg.look === 'carved') {
    o += `<rect x="0" y="0" width="${W}" height="${W}" rx="0.08" fill="${walnut ? 'url(#tf-walnut)' : '#7a4e2c'}" stroke="#2a1608" stroke-width="0.06"/>`;
    o += `<rect x="0" y="0" width="${W}" height="${W}" rx="0.08" fill="#3a1e08" opacity="0.25"/>`;
    // плетёнка по сторонам, узлы в углах
    const m = F / 2;
    const L = F * 1.15;
    let band = braid(L, m, W - L, m, 0.2, 0.8) + braid(L, W - m, W - L, W - m, 0.2, 0.8) + braid(m, L, m, W - L, 0.2, 0.8) + braid(W - m, L, W - m, W - L, 0.2, 0.8);
    for (const [x, y] of [
      [m, m],
      [W - m, m],
      [m, W - m],
      [W - m, W - m],
    ])
      band += knot(x, y, 0.46);
    o += `<path d="${band}" fill="none" stroke="#f0c890" stroke-opacity="0.45" stroke-width="0.11" transform="translate(0.02 0.025)" stroke-linecap="round"/>`;
    o += `<path d="${band}" fill="none" stroke="#140802" stroke-width="0.08" stroke-linecap="round"/>`;
    o += `<rect x="${F - 0.1}" y="${F - 0.1}" width="${n + 0.2}" height="${n + 0.2}" fill="none" stroke="#140802" stroke-width="0.07"/>`;
    o += `<path d="${grid}" fill="none" stroke="#f0c890" stroke-opacity="0.4" stroke-width="0.06" transform="translate(0.015 0.022)"/>`;
    o += `<path d="${grid}" fill="none" stroke="#120802" stroke-width="0.07"/>`;
    let x = '';
    for (let p = 0; p < n * n; p++) {
      if (!special(p)) continue;
      const px = F + (p % n);
      const py = F + Math.floor(p / n);
      x += `M${px + 0.15} ${py + 0.15}L${px + 0.85} ${py + 0.85}M${px + 0.85} ${py + 0.15}L${px + 0.15} ${py + 0.85}`;
    }
    o += `<path d="${x}" stroke="#120802" stroke-width="0.06" fill="none"/>`;
    return o;
  }
  // руны и щиты
  o += `<rect x="0" y="0" width="${W}" height="${W}" rx="0.06" fill="${birch ? 'url(#tf-birch)' : '#ead6b0'}" stroke="#8a6a40" stroke-width="0.04"/>`;
  o += `<rect x="${F - 0.12}" y="${F - 0.12}" width="${n + 0.24}" height="${n + 0.24}" fill="none" stroke="#3a1e0c" stroke-width="0.05"/>`;
  const rh = 0.34;
  const runeW = rh * 0.55 * 1.5;
  const count = Math.max(4, Math.floor((n - 2) / runeW / 2));
  const mid = W / 2 - (count * runeW) / 2;
  let runes = runeRow(mid, F / 2 - rh / 2, rh, count, 1) + runeRow(mid, W - F / 2 - rh / 2, rh, count, 4);
  runes += runeRow(F / 2 - rh / 2, mid, rh, count, 7, true) + runeRow(W - F / 2 - rh / 2, mid, rh, count, 2, true);
  o += `<path d="${runes}" stroke="#3a1e0c" stroke-width="0.045" stroke-linecap="round" fill="none"/>`;
  // плетёнка по углам поля
  let band = '';
  for (const [x, y] of [
    [F / 2, F / 2],
    [W - F / 2, F / 2],
    [F / 2, W - F / 2],
    [W - F / 2, W - F / 2],
  ])
    band += knot(x, y, 0.4);
  const q = F + n / 2 - (count * runeW) / 2 - 0.25;
  band += braid(F * 1.05, F / 2, q, F / 2, 0.12, 0.7) + braid(W - q, F / 2, W - F * 1.05, F / 2, 0.12, 0.7);
  band += braid(F * 1.05, W - F / 2, q, W - F / 2, 0.12, 0.7) + braid(W - q, W - F / 2, W - F * 1.05, W - F / 2, 0.12, 0.7);
  band += braid(F / 2, F * 1.05, F / 2, q, 0.12, 0.7) + braid(F / 2, W - q, F / 2, W - F * 1.05, 0.12, 0.7);
  band += braid(W - F / 2, F * 1.05, W - F / 2, q, 0.12, 0.7) + braid(W - F / 2, W - q, W - F / 2, W - F * 1.05, 0.12, 0.7);
  o += `<path d="${band}" stroke="#4a2810" stroke-width="0.035" fill="none"/>`;
  // диагонали от углов к трону
  const c = F + n / 2;
  const r = n / 2 - 1.5;
  o += `<path d="M${F + 1} ${F + 1}L${c - 1.5} ${c - 1.5}M${F + n - 1} ${F + 1}L${c + 1.5} ${c - 1.5}M${F + 1} ${F + n - 1}L${c - 1.5} ${c + 1.5}M${F + n - 1} ${F + n - 1}L${c + 1.5} ${c + 1.5}" stroke="#3a1e0c" stroke-width="0.03" opacity="${r > 1 ? 0.8 : 0}"/>`;
  o += `<path d="${grid}" fill="none" stroke="#3a1e0c" stroke-width="0.035"/>`;
  for (let p = 0; p < n * n; p++) {
    if (!special(p)) continue;
    const px = F + (p % n);
    const py = F + Math.floor(p / n);
    o += `<rect x="${px + 0.04}" y="${py + 0.04}" width="0.92" height="0.92" fill="#3a1e0c"/><path d="${knot(px + 0.5, py + 0.5, 0.32)}" stroke="#ead6b0" stroke-width="0.035" fill="none"/>`;
  }
  return o;
}

function piece(s: State, kind: string, x: number, y: number): string {
  const sh = `<circle cx="${x + 0.05}" cy="${y + 0.07}" r="0.44" fill="url(#tf-sh)"/>`;
  if (s.cfg.look === 'carved') {
    const dark = kind === 'a';
    const g = dark ? 'tf-dark' : 'tf-light';
    const edge = dark ? '#000' : '#7a5a30';
    let o = `${sh}<circle cx="${x}" cy="${y + 0.05}" r="0.38" fill="${edge}"/>
      <circle cx="${x}" cy="${y}" r="0.38" fill="url(#${g})" stroke="${edge}" stroke-width="0.02"/>
      <circle cx="${x + 0.03}" cy="${y + 0.02}" r="0.22" fill="none" stroke="${dark ? '#fff' : '#7a5a30'}" stroke-opacity="${dark ? 0.06 : 0.25}" stroke-width="0.015"/>
      <circle cx="${x + 0.04}" cy="${y + 0.03}" r="0.11" fill="none" stroke="${dark ? '#fff' : '#7a5a30'}" stroke-opacity="${dark ? 0.06 : 0.22}" stroke-width="0.012"/>`;
    if (kind === 'k') {
      const r = 0.17;
      o += `<path d="M${x - r} ${y - r}L${x + r} ${y - r}L${x} ${y}Z" fill="#f0d070"/><path d="M${x + r} ${y - r}L${x + r} ${y + r}L${x} ${y}Z" fill="#a87a1c"/>
        <path d="M${x - r} ${y + r}L${x + r} ${y + r}L${x} ${y}Z" fill="#6e4c0c"/><path d="M${x - r} ${y - r}L${x - r} ${y + r}L${x} ${y}Z" fill="#d4a83a"/>`;
    }
    return o;
  }
  // щиты
  const R = kind === 'k' ? 0.43 : 0.39;
  let face = '';
  if (kind === 'a') {
    face = `<circle cx="${x}" cy="${y}" r="${R}" fill="#e8d2a8"/>
      <path d="M${x} ${y}L${x} ${y - R}A${R} ${R} 0 0 1 ${x + R} ${y}Z M${x} ${y}L${x} ${y + R}A${R} ${R} 0 0 1 ${x - R} ${y}Z" fill="#5a3418"/>`;
  } else if (kind === 'd') {
    face = `<circle cx="${x}" cy="${y}" r="${R}" fill="#efdcb4"/>
      <path d="M${x - R * 0.75} ${y - R * 0.35}L${x} ${y + R * 0.25}L${x + R * 0.75} ${y - R * 0.35}M${x - R * 0.85} ${y - R * 0.05}L${x} ${y + R * 0.55}L${x + R * 0.85} ${y - R * 0.05}" fill="none" stroke="#7a4a20" stroke-width="0.035"/>`;
  } else {
    face = `<circle cx="${x}" cy="${y}" r="${R}" fill="url(#tf-brass)"/>
      <circle cx="${x}" cy="${y}" r="${R * 0.78}" fill="none" stroke="#7a5410" stroke-width="0.025"/>
      ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<circle cx="${x + Math.cos((i * Math.PI) / 4) * R * 0.88}" cy="${y + Math.sin((i * Math.PI) / 4) * R * 0.88}" r="0.025" fill="#fff2b0"/>`).join('')}`;
  }
  return `${sh}<circle cx="${x}" cy="${y + 0.05}" r="${R}" fill="#3a1e0c"/>${face}
    <circle cx="${x}" cy="${y}" r="${R}" fill="none" stroke="#3a1e0c" stroke-width="0.03"/>
    <circle cx="${x}" cy="${y}" r="0.11" fill="url(#tf-brass)" stroke="#5a3a08" stroke-width="0.015"/>
    <circle cx="${x - 0.03}" cy="${y - 0.035}" r="0.035" fill="#fff" opacity="0.8"/>`;
}

class TaflView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private s: State | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="tf-info"></div>`);
    ctx.controls.appendChild(this.info);
    if (!ctx.demo) ctx.controls.appendChild(h(`<div class="tf-hint">Нажмите на свою фигуру, потом на клетку по прямой. Чужую фигуру берут, зажав с двух сторон.</div>`));
    this.pb = new PointBoard<State, Action>(root, ctx, {
      count: (s) => s.n * s.n,
      size: (s) => [s.n + 2 * F, s.n + 2 * F],
      xy: (s, p) => [cx(s, p), cy(s, p)],
      board,
      pieces: (s) => s.board.flatMap((v, p) => (v ? [{ p, kind: v === ATT ? 'a' : v === KING ? 'k' : 'd' }] : [])),
      piece: (s, kind, x, y) => piece(s, kind, x, y),
      legal: (s, seat) => (s.turn === seat ? legal(s) : []),
      spot: (a) => ({ from: a.from, to: a.to }),
      hit: 0.5,
      ring: 0.42,
    });
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const goal = RULES[s.cfg.kind].corners ? 'в угол' : 'на край';
    this.info.innerHTML = `<div>Взято: нападающих <b>${s.lost[0]}</b>, защитников <b>${s.lost[1]}</b></div><small>Король уходит ${goal}</small>`;
  }

  setView(v: State) {
    this.s = v;
    if (!walnut && v.cfg.look === 'carved') walnut = woodTexture(WOODS.walnut, 512, 13, false);
    if (!birch && v.cfg.look === 'shields') birch = woodTexture(WOODS.maple, 512, 17, false);
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'move') {
        const kind = ev.piece === ATT ? 'a' : ev.piece === KING ? 'k' : 'd';
        const taken = ev.taken.map((p) => ({ p, kind: ev.seat === 0 ? 'd' : 'a' }));
        this.pb.show(v, { from: ev.from, to: ev.to, kind }, taken);
        Sound.step();
        if (taken.length) setTimeout(() => Sound.capture(), 280);
        await sleep((taken.length ? 560 : 360) / this.ctx.speed());
      } else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.pb.turn(s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null);
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : v.winner === 1 ? 'Король ушёл' : 'Король взят';
    return interactive.includes(toAct[0]) ? 'Ваш ход' : `Ходят ${this.ctx.name(toAct[0])}…`;
  }
}

export function createView(): GameView<State, Event> {
  return new TaflView();
}

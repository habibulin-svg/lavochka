/* Игры на кресте — отрисовка.
 * Советская коробка (лиса и гуси, асальто): белый пластиковый корпус, голубой войлок, белые линии с диагоналями
 * и кольца-гнёзда; фишки-«шашечки» — гуси белые, повстанцы красные, лиса и офицеры оранжевые.
 * Советская «Йога»: чёрный круглый футляр, жёлтая вкладка с лунками, белые конические колышки.
 * Деревянная доска: орех, лунки, стеклянные шарики (у солитёра — разноцветные).
 * Французская карта асальто «Jeu du siège de Sébastopol» (Эпиналь, XIX век, общественное достояние;
 * public/foxgeese/sebastopol.webp, 1100×1213 — фото листа, выпрямленное по углам): точки — по нарисованным пунктам,
 * осаждающие — красные фишки с белым кантом, защитники — тёмно-синие с золотом. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { woodTexture, WOODS } from '../../core/wood';
import { FOX, geo, isFort, legal, MAN, men, MIN_MEN, type Action, type Event, type State } from './engine';
import './foxgeese.css';

const M = 0.8;
const W = 6 + 2 * M;
const MAP_SRC = `${import.meta.env.BASE_URL}foxgeese/sebastopol.webp`;
/** Карта: пикселей на единицу доски (шаг сетки на картинке ~135 px) и размер картинки. */
const MAP_PX = 135;
const MAP_W = 1100 / MAP_PX;
const MAP_H = 1213 / MAP_PX;
/** Пункты на карте, в пикселях картинки, по порядку точек креста (ряды сверху вниз, слева направо). */
const MAP_XY: [number, number][] = [
  [408, 230], [542, 233], [674, 235],
  [411, 369], [543, 369], [675, 368],
  [136, 497], [272, 501], [412, 505], [543, 505], [673, 505], [818, 507], [956, 505],
  [138, 636], [275, 638], [414, 639], [545, 641], [676, 642], [817, 641], [955, 640],
  [140, 772], [278, 772], [414, 771], [546, 772], [676, 772], [817, 772], [953, 772],
  [415, 905], [545, 906], [677, 905],
  [415, 1043], [548, 1042], [680, 1045],
];
const isMap = (s: State) => s.cfg.look === 'map';
const X = (s: State, p: number) => (isMap(s) ? MAP_XY[p][0] / MAP_PX : M + geo(s.cfg).xy[p][0]);
const Y = (s: State, p: number) => (isMap(s) ? MAP_XY[p][1] / MAP_PX : M + geo(s.cfg).xy[p][1]);
let walnut = '';

function defs(): string {
  return `<defs>
    <radialGradient id="fg-w" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#e9ecef"/><stop offset="1" stop-color="#aeb4ba"/></radialGradient>
    <radialGradient id="fg-r" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ff5a7a"/><stop offset="0.6" stop-color="#d0103e"/><stop offset="1" stop-color="#7a0420"/></radialGradient>
    <radialGradient id="fg-navy" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#5a74c8"/><stop offset="0.6" stop-color="#1e2c6a"/><stop offset="1" stop-color="#0a1030"/></radialGradient>
    <radialGradient id="fg-o" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffc45a"/><stop offset="0.6" stop-color="#e0921a"/><stop offset="1" stop-color="#8a5206"/></radialGradient>
    <radialGradient id="fg-peg" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#efe9da"/><stop offset="1" stop-color="#bfb6a0"/></radialGradient>
    <radialGradient id="fg-hole" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#6a5a20"/><stop offset="0.8" stop-color="#b8a44a"/><stop offset="1" stop-color="#e8d98a"/></radialGradient>
    <radialGradient id="fg-whole" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#140a04"/><stop offset="0.8" stop-color="#3a2210"/><stop offset="1" stop-color="#6a4426"/></radialGradient>
    <radialGradient id="fg-sh" cx="50%" cy="50%" r="50%"><stop offset="0.55" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <radialGradient id="fg-glass" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.8" stop-color="#fff" stop-opacity="0.08"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></radialGradient>
    <linearGradient id="fg-case" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f4f0"/><stop offset="1" stop-color="#d4d6d2"/></linearGradient>
    <linearGradient id="fg-yellow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#efe08a"/><stop offset="1" stop-color="#d2bf5c"/></linearGradient>
    <filter id="fg-felt" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="8" numOctaves="2" seed="5" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0.1  0 0 0 0 0.15  0 0 0 0.7 -0.12" result="g"/>
      <feComposite in="g" in2="SourceGraphic" operator="in" result="t"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge>
    </filter>
    ${walnut ? `<pattern id="fg-wood" patternUnits="userSpaceOnUse" width="6" height="6"><image href="${walnut}" width="6" height="6" preserveAspectRatio="none"/></pattern>` : ''}
  </defs>`;
}

/** Линии доски. */
function lines(s: State): string {
  const G = geo(s.cfg);
  let d = '';
  G.dirs.forEach((ds, p) => {
    for (const [dx, dy, a] of ds) {
      if (dx < 0 || (dx === 0 && dy < 0)) continue;
      d += `M${X(s, p)} ${Y(s, p)}L${X(s, a)} ${Y(s, a)}`;
    }
  });
  return d;
}

/** Контур креста. */
function crossPath(pad: number): string {
  const a = M + 2 - pad;
  const b = M + 4 + pad;
  const lo = M - pad;
  const hi = M + 6 + pad;
  return `M${a} ${lo}H${b}V${a}H${hi}V${b}H${b}V${hi}H${a}V${b}H${lo}V${a}H${a}Z`;
}

function board(s: State): string {
  const G = geo(s.cfg);
  const yoga = s.cfg.mode === 'yoga';
  let o = defs();
  if (isMap(s)) return o + `<image href="${MAP_SRC}" width="${MAP_W}" height="${MAP_H}"/>`;
  if (s.cfg.look === 'soviet' && yoga) {
    const c = W / 2;
    o += `<circle cx="${c}" cy="${c}" r="${c - 0.02}" fill="#17181a" stroke="#000" stroke-width="0.04"/>`;
    o += `<circle cx="${c}" cy="${c}" r="${c - 0.22}" fill="url(#fg-yellow)" stroke="#0a0a0a" stroke-width="0.05"/>`;
    for (const [dx, dy] of [
      [-2.2, -2.2],
      [2.2, -2.2],
      [-2.2, 2.2],
      [2.2, 2.2],
    ])
      o += `<circle cx="${c + dx}" cy="${c + dy}" r="0.42" fill="none" stroke="#c4b050" stroke-width="0.03"/>`;
    for (let p = 0; p < G.xy.length; p++) o += `<circle cx="${X(s, p)}" cy="${Y(s, p)}" r="0.3" fill="url(#fg-hole)" stroke="#a89640" stroke-width="0.02"/>`;
    return o;
  }
  if (s.cfg.look === 'soviet') {
    o += `<rect x="0" y="0" width="${W}" height="${W}" rx="0.2" fill="url(#fg-case)" stroke="#a8aaa6" stroke-width="0.03"/>`;
    o += `<rect x="0.25" y="0.25" width="${W - 0.5}" height="${W - 0.5}" fill="#1aa6d6" filter="url(#fg-felt)" stroke="#9a9c98" stroke-width="0.04"/>`;
    if (s.cfg.mode === 'asalto') o += `<rect x="${M + 1.6}" y="${M - 0.4}" width="2.8" height="2.8" rx="0.15" fill="#fff" opacity="0.12"/>`;
    o += `<path d="${lines(s)}" fill="none" stroke="#fff" stroke-width="0.03"/>`;
    for (let p = 0; p < G.xy.length; p++) o += `<circle cx="${X(s, p)}" cy="${Y(s, p)}" r="0.29" fill="#1aa6d6" stroke="#fff" stroke-width="0.03"/>`;
    return o;
  }
  // дерево
  o += `<rect x="0" y="0" width="${W}" height="${W}" rx="${yoga ? W / 2 : 0.25}" fill="${walnut ? 'url(#fg-wood)' : '#6a4426'}" stroke="#2a1606" stroke-width="0.05"/>`;
  if (!yoga) {
    o += `<path d="${crossPath(0.45)}" fill="none" stroke="#2a1606" stroke-width="0.03" opacity="0.6"/>`;
    if (s.cfg.mode === 'asalto') o += `<path d="M${M + 1.55} ${M + 2.45}V${M - 0.45}H${M + 4.45}V${M + 2.45}" fill="none" stroke="#e8c890" stroke-width="0.04" stroke-dasharray="0.12 0.08" opacity="0.7"/>`;
    o += `<path d="${lines(s)}" fill="none" stroke="#e0b880" stroke-width="0.035" transform="translate(0.015 0.02)" opacity="0.4"/>`;
    o += `<path d="${lines(s)}" fill="none" stroke="#1a0c04" stroke-width="0.045"/>`;
  } else o += `<circle cx="${W / 2}" cy="${W / 2}" r="${W / 2 - 0.3}" fill="none" stroke="#2a1606" stroke-width="0.04" opacity="0.6"/>`;
  for (let p = 0; p < G.xy.length; p++) o += `<circle cx="${X(s, p)}" cy="${Y(s, p)}" r="0.25" fill="url(#fg-whole)"/>`;
  return o;
}

const GLASS = ['#3a7ad8', '#d83a4a', '#3aa85a', '#e0b030', '#8a4ad8', '#2ab0b8'];

function piece(s: State, kind: string, p: number, x: number, y: number): string {
  const sh = (r: number) => `<circle cx="${x + 0.04}" cy="${y + 0.06}" r="${r * 1.1}" fill="url(#fg-sh)"/>`;
  const fox = kind === 'f';
  if (isMap(s)) {
    // точёные фишки: осаждающие — красные с белым кантом, защитники — тёмно-синие с золотым
    const [g, edge, rim] = fox ? ['fg-navy', '#0a1030', '#f0c040'] : ['fg-r', '#4a0414', '#ffffff'];
    return `${sh(0.3)}<circle cx="${x}" cy="${y + 0.05}" r="0.28" fill="${edge}"/>
      <circle cx="${x}" cy="${y}" r="0.28" fill="url(#${g})" stroke="${rim}" stroke-width="0.05"/>
      <circle cx="${x}" cy="${y}" r="0.19" fill="none" stroke="${rim}" stroke-opacity="0.7" stroke-width="0.025"/>
      ${fox ? `<path d="M${x} ${y - 0.12}l0.035 0.075 0.08 0.01-0.06 0.055 0.017 0.08-0.072-0.04-0.072 0.04 0.017-0.08-0.06-0.055 0.08-0.01z" fill="${rim}"/>` : ''}`;
  }
  if (s.cfg.look === 'soviet' && s.cfg.mode === 'yoga') {
    // колышек-конус сверху: широкое основание, тень вбок, светлая вершинка
    return `<ellipse cx="${x + 0.1}" cy="${y + 0.12}" rx="0.3" ry="0.22" fill="#000" opacity="0.28"/>
      <circle cx="${x}" cy="${y}" r="0.27" fill="url(#fg-peg)" stroke="#a69c84" stroke-width="0.02"/>
      <circle cx="${x - 0.03}" cy="${y - 0.05}" r="0.15" fill="#fbf8f0" stroke="#d8d0bc" stroke-width="0.015"/>
      <circle cx="${x - 0.05}" cy="${y - 0.08}" r="0.05" fill="#fff"/>`;
  }
  if (s.cfg.look === 'soviet') {
    const g = fox ? 'fg-o' : s.cfg.mode === 'asalto' ? 'fg-r' : 'fg-w';
    const edge = fox ? '#6a3a04' : s.cfg.mode === 'asalto' ? '#5a0418' : '#8a9096';
    return `${sh(0.26)}<circle cx="${x}" cy="${y + 0.05}" r="0.25" fill="${edge}"/>
      <circle cx="${x}" cy="${y}" r="0.25" fill="url(#${g})" stroke="${edge}" stroke-width="0.02"/>
      <circle cx="${x}" cy="${y}" r="${fox ? 0.17 : 0.12}" fill="none" stroke="${edge}" stroke-opacity="0.55" stroke-width="0.022"/>
      <circle cx="${x}" cy="${y}" r="${fox ? 0.08 : 0.035}" fill="${fox ? 'none' : edge}" stroke="${edge}" stroke-opacity="0.5" stroke-width="0.02"/>`;
  }
  // стеклянный шарик
  const col = s.cfg.mode === 'yoga' ? GLASS[(p * 7) % GLASS.length] : fox ? '#e0601a' : s.cfg.mode === 'asalto' ? '#c8243a' : '#e8eef4';
  return `${sh(0.26)}<circle cx="${x}" cy="${y}" r="0.26" fill="${col}"/>
    <circle cx="${x}" cy="${y}" r="0.26" fill="url(#fg-glass)"/>
    <path d="M${x - 0.16} ${y + 0.02}q0.05 0.12 0.2 0.13" stroke="#fff" stroke-opacity="0.35" stroke-width="0.03" fill="none"/>
    <ellipse cx="${x - 0.08}" cy="${y - 0.1}" rx="0.07" ry="0.05" fill="#fff" opacity="0.85"/>`;
}

const NAMES: Record<string, [string, string]> = { fox: ['Гуси', 'Лиса'], asalto: ['Повстанцы', 'Офицеры'], yoga: ['Игрок', ''] };

class CrossView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private hint!: HTMLElement;
  private s: State | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="fg-info"></div>`);
    ctx.controls.appendChild(this.info);
    this.hint = h(`<div class="fg-hint"></div>`);
    if (!ctx.demo) ctx.controls.appendChild(this.hint);
    this.pb = new PointBoard<State, Action>(root, ctx, {
      count: (s) => geo(s.cfg).xy.length,
      size: (s) => (isMap(s) ? [MAP_W, MAP_H] : [W, W]),
      xy: (s, p) => [X(s, p), Y(s, p)],
      board,
      pieces: (s) => s.board.flatMap((v, p) => (v ? [{ p, kind: v === FOX ? 'f' : 'm' }] : [])),
      piece: (s, kind, x, y, p) => piece(s, kind, p, x, y),
      legal: (s, seat) => (s.turn === seat ? legal(s) : []),
      spot: (a) => (a.type === 'move' ? { from: a.from, to: a.to } : null),
      label: () => 'Хватит прыгать',
      hit: 0.45,
      ring: 0.34,
    });
  }

  seatName(v: State, seat: number) {
    return v.cfg.mode === 'fox' && v.cfg.foxes === 2 && seat === 1 ? 'Лисы' : NAMES[v.cfg.mode][seat] || null;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const n = men(s);
    if (s.cfg.mode === 'yoga') {
      this.info.innerHTML = `<div>Фишек на доске: <b>${n}</b></div>`;
      this.hint.textContent = 'Нажмите на фишку, потом на пустую лунку через одну: перепрыгнутая фишка снимается.';
    } else if (s.cfg.mode === 'asalto') {
      const G = geo(s.cfg);
      const fort = G.xy.filter(([x, y], p) => isFort(x, y) && s.board[p] === MAN).length;
      this.info.innerHTML = `<div>Повстанцев: <b>${n}</b> (меньше ${MIN_MEN} — офицеры победили)</div><div>В крепости: <b>${fort}</b> из 9</div>`;
      this.hint.textContent = 'Повстанцы ходят только к крепости. Офицеры обязаны бить прыжком, если можно.';
    } else {
      this.info.innerHTML = `<div>Гусей: <b>${n}</b> · съедено: <b>${s.eaten}</b></div><small>Меньше ${MIN_MEN} гусей — лиса победила</small>`;
      this.hint.textContent = 'Нажмите на фишку и на точку, куда пойти. Лиса прыгает через гуся на пустую точку за ним.';
    }
  }

  setView(v: State) {
    this.s = v;
    if (!walnut && v.cfg.look === 'wood') walnut = woodTexture(WOODS.walnut, 512, 5, false);
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'move') {
        const taken = ev.eat >= 0 ? [{ p: ev.eat, kind: 'm' }] : [];
        this.pb.show(v, { from: ev.from, to: ev.to, kind: ev.kind === FOX ? 'f' : 'm' }, taken);
        if (ev.eat >= 0) {
          Sound.jump();
          setTimeout(() => (v.cfg.mode === 'yoga' ? Sound.place() : Sound.capture()), 260);
        } else Sound.step();
        await sleep((ev.eat >= 0 ? 520 : 320) / this.ctx.speed());
      } else if (ev.type === 'end') {
        if (ev.winner != null || ev.why === 'solved') Sound.win();
        else Sound.nomove();
      }
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
    if (v.over) {
      if (v.cfg.mode === 'yoga') {
        const n = men(v);
        return n === 1 ? 'Осталась одна фишка!' : `Ходов нет, осталось ${n}`;
      }
      return v.winner == null ? 'Ничья' : 'Партия окончена';
    }
    if (!interactive.includes(toAct[0])) return `Ходит ${this.ctx.name(toAct[0])}…`;
    if (v.chain >= 0) return 'Можно прыгать дальше';
    return v.cfg.mode === 'yoga' ? 'Прыгайте' : 'Ваш ход';
  }
}

export function createView(): GameView<State, Event> {
  return new CrossView();
}

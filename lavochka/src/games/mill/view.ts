/* Мельница — отрисовка. Дубовая доска с врезанными линиями и деревянными шашками; каменная плита с выбитыми линиями
 * и гладкой галькой; советская дорожная коробка: бежевый корпус, синее поле с белыми линиями и кольцами-гнёздами,
 * буквы А–Ж и цифры 1–7, жёлтые и красные фишки с кольцом. Под доской — фишки, которые ещё не поставлены. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { woodTexture, WOODS } from '../../core/wood';
import { count, flying, geo, legal, type Action, type Event, type State } from './engine';
import './mill.css';

const M0 = 0.75;
/** Поле вокруг точек: у советской доски шире — там буквы и цифры. */
const mg = (s: State) => (s.cfg.look === 'soviet' ? 1.1 : M0);
const TRAY = 0.7;
let oak = '';

function unit(s: State): number {
  // шаг сетки: малая доска крупнее
  return s.cfg.men === 3 ? 2 : s.cfg.men === 6 ? 1.25 : 1;
}

function size(s: State): [number, number] {
  const G = geo(s.cfg);
  const W = (G.g - 1) * unit(s) + 2 * mg(s);
  return [W, W + 2 * TRAY];
}

function xy(s: State, p: number): [number, number] {
  const [x, y] = geo(s.cfg).xy[p];
  const u = unit(s);
  return [mg(s) + x * u, TRAY + mg(s) + y * u];
}

const LETTERS = 'АБВГДЕЖ';

function defs(): string {
  return `<defs>
    <radialGradient id="ml-w" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#fffaf0"/><stop offset="0.6" stop-color="#e6dcc4"/><stop offset="1" stop-color="#b3a684"/></radialGradient>
    <radialGradient id="ml-b" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#5a4a40"/><stop offset="0.6" stop-color="#2a201a"/><stop offset="1" stop-color="#0c0806"/></radialGradient>
    <radialGradient id="ml-y" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#ffd76a"/><stop offset="0.6" stop-color="#e3a81e"/><stop offset="1" stop-color="#a06c08"/></radialGradient>
    <radialGradient id="ml-r" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#ff6a6a"/><stop offset="0.6" stop-color="#c41a26"/><stop offset="1" stop-color="#7a0610"/></radialGradient>
    <radialGradient id="ml-gw" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#f4f2ec"/><stop offset="0.7" stop-color="#c9c4b8"/><stop offset="1" stop-color="#8e887a"/></radialGradient>
    <radialGradient id="ml-gb" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#6a6e72"/><stop offset="0.7" stop-color="#2e3134"/><stop offset="1" stop-color="#121416"/></radialGradient>
    <radialGradient id="ml-sh" cx="50%" cy="50%" r="50%"><stop offset="0.55" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <linearGradient id="ml-case" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efe6cf"/><stop offset="1" stop-color="#cfc3a4"/></linearGradient>
    <filter id="ml-felt" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="8" numOctaves="2" seed="3" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0.05  0 0 0 0 0.15  0 0 0 0.8 -0.15" result="g"/>
      <feComposite in="g" in2="SourceGraphic" operator="in" result="t"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge>
    </filter>
    <filter id="ml-stone" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="4" seed="11" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.25  0 0 0 0 0.23  0 0 0 0 0.2  0 0 0 0.9 -0.25" result="g"/>
      <feComposite in="g" in2="SourceGraphic" operator="in" result="t"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge>
    </filter>
    ${oak ? `<pattern id="ml-oak" patternUnits="userSpaceOnUse" width="5" height="5"><image href="${oak}" width="5" height="5" preserveAspectRatio="none"/></pattern>` : ''}
  </defs>`;
}

function board(s: State): string {
  const G = geo(s.cfg);
  const [W, H] = size(s);
  const look = s.cfg.look;
  const y0 = TRAY;
  let path = '';
  for (const [p, q] of G.edges) {
    const [x1, y1] = xy(s, p);
    const [x2, y2] = xy(s, q);
    path += `M${x1} ${y1}L${x2} ${y2}`;
  }
  let o = defs();
  if (look === 'soviet') {
    o += `<rect x="0" y="${y0 - 0.1}" width="${W}" height="${W + 0.2}" rx="0.18" fill="url(#ml-case)" stroke="#9c916f" stroke-width="0.03"/>`;
    o += `<rect x="0.22" y="${y0 + 0.12}" width="${W - 0.44}" height="${W - 0.24}" fill="#2b6fb8" filter="url(#ml-felt)"/>`;
    o += `<rect x="0.3" y="${y0 + 0.2}" width="${W - 0.6}" height="${W - 0.4}" fill="none" stroke="#e8f0ff" stroke-width="0.025"/>`;
    o += `<rect x="0.36" y="${y0 + 0.26}" width="${W - 0.72}" height="${W - 0.52}" fill="none" stroke="#e8f0ff" stroke-width="0.012"/>`;
    o += `<path d="${path}" fill="none" stroke="#f4f8ff" stroke-width="0.035"/>`;
    for (let p = 0; p < G.xy.length; p++) {
      const [x, y] = xy(s, p);
      o += `<circle cx="${x}" cy="${y}" r="0.24" fill="#2b6fb8" stroke="#f4f8ff" stroke-width="0.03"/>`;
    }
    if (G.g === 7) {
      for (let i = 0; i < 7; i++) {
        const x = mg(s) + i;
        const yy = TRAY + mg(s) + i;
        o += `<text x="${x}" y="${y0 + 0.55}" class="ml-coord">${LETTERS[6 - i]}</text><text x="${x}" y="${y0 + W - 0.55}" class="ml-coord">${LETTERS[6 - i]}</text>`;
        o += `<text x="0.62" y="${yy}" class="ml-coord">${i + 1}</text><text x="${W - 0.62}" y="${yy}" class="ml-coord">${i + 1}</text>`;
      }
    }
  } else if (look === 'stone') {
    o += `<rect x="0" y="${y0 - 0.1}" width="${W}" height="${W + 0.2}" rx="0.3" fill="#8f877a" filter="url(#ml-stone)" stroke="#5a544a" stroke-width="0.04"/>`;
    o += `<path d="${path}" fill="none" stroke="#d8d0c0" stroke-width="0.09" transform="translate(0.02 0.025)" opacity="0.5" stroke-linecap="round"/>`;
    o += `<path d="${path}" fill="none" stroke="#3e3830" stroke-width="0.08" stroke-linecap="round"/>`;
    for (let p = 0; p < G.xy.length; p++) {
      const [x, y] = xy(s, p);
      o += `<circle cx="${x}" cy="${y}" r="0.11" fill="#3e3830"/><circle cx="${x + 0.02}" cy="${y + 0.025}" r="0.11" fill="none" stroke="#d8d0c0" stroke-opacity="0.35" stroke-width="0.02"/>`;
    }
  } else {
    o += `<rect x="0" y="${y0 - 0.1}" width="${W}" height="${W + 0.2}" rx="0.12" fill="${oak ? 'url(#ml-oak)' : '#9a6a38'}" stroke="#3a2210" stroke-width="0.05"/>`;
    o += `<rect x="0.2" y="${y0 + 0.1}" width="${W - 0.4}" height="${W - 0.2}" fill="none" stroke="#e8cf9a" stroke-width="0.03" opacity="0.7"/>`;
    // светлая инкрустация клёном
    o += `<path d="${path}" fill="none" stroke="#1a0c04" stroke-width="0.09" opacity="0.6"/>`;
    o += `<path d="${path}" fill="none" stroke="#e8cf9a" stroke-width="0.06"/>`;
    for (let p = 0; p < G.xy.length; p++) {
      const [x, y] = xy(s, p);
      o += `<circle cx="${x}" cy="${y}" r="0.12" fill="#e8cf9a" stroke="#1a0c04" stroke-opacity="0.6" stroke-width="0.02"/>`;
    }
  }
  // запас фишек: место 1 — сверху, место 0 — снизу
  for (const seat of [1, 0]) {
    const n = s.hand[seat];
    const y = seat === 1 ? TRAY / 2 : H - TRAY / 2;
    const step = Math.min(0.42, (W - 0.8) / Math.max(1, s.cfg.men));
    for (let i = 0; i < n; i++) o += piece(s, seat, 0.55 + i * step, y, 0.18);
  }
  return o;
}

function piece(s: State, seat: number, x: number, y: number, r = 0.3): string {
  const look = s.cfg.look;
  const k = r / 0.3;
  const sh = `<circle cx="${x + 0.035 * k}" cy="${y + 0.05 * k}" r="${r * 1.12}" fill="url(#ml-sh)"/>`;
  if (look === 'soviet') {
    const red = seat === 0;
    const g = red ? 'ml-r' : 'ml-y';
    const edge = red ? '#5a0408' : '#7a5004';
    return `${sh}<circle cx="${x}" cy="${y + 0.04 * k}" r="${r}" fill="${edge}"/>
      <circle cx="${x}" cy="${y}" r="${r}" fill="url(#${g})" stroke="${edge}" stroke-width="${0.02 * k}"/>
      <circle cx="${x}" cy="${y}" r="${r * 0.62}" fill="none" stroke="${edge}" stroke-opacity="0.6" stroke-width="${0.025 * k}"/>
      <circle cx="${x}" cy="${y}" r="${r * 0.25}" fill="none" stroke="${edge}" stroke-opacity="0.5" stroke-width="${0.02 * k}"/>`;
  }
  if (look === 'stone') {
    const g = seat === 0 ? 'ml-gw' : 'ml-gb';
    return `${sh}<ellipse cx="${x}" cy="${y}" rx="${r * 1.02}" ry="${r * 0.92}" fill="url(#${g})" stroke="${seat === 0 ? '#7a7466' : '#050606'}" stroke-width="${0.015 * k}"/>`;
  }
  const g = seat === 0 ? 'ml-w' : 'ml-b';
  const edge = seat === 0 ? '#8a7d5c' : '#000';
  return `${sh}<circle cx="${x}" cy="${y + 0.04 * k}" r="${r}" fill="${edge}"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="url(#${g})" stroke="${edge}" stroke-width="${0.02 * k}"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.7}" fill="none" stroke="${seat === 0 ? '#a89a76' : '#4a3a30'}" stroke-width="${0.02 * k}"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.45}" fill="none" stroke="${seat === 0 ? '#a89a76' : '#4a3a30'}" stroke-width="${0.015 * k}"/>`;
}

const sovietNames = ['Красные', 'Жёлтые'];

class MillView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private s: State | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="ml-info"></div>`);
    ctx.controls.appendChild(this.info);
    if (!ctx.demo) ctx.controls.appendChild(h(`<div class="ml-hint">Ставьте фишку на точку; потом — нажмите на свою фишку и на соседнюю точку. Мельница — три в ряд по линии: нажмите на фишку соперника, чтобы снять её.</div>`));
    this.pb = new PointBoard<State, Action>(root, ctx, {
      count: (s) => geo(s.cfg).xy.length,
      size,
      xy,
      board,
      pieces: (s) => s.board.flatMap((v, p) => (v ? [{ p, kind: String(v - 1) }] : [])),
      piece: (s, kind, x, y) => piece(s, Number(kind), x, y, s.cfg.men === 3 ? 0.5 : s.cfg.look === 'soviet' ? 0.27 : 0.32),
      legal: (s, seat) => (s.turn === seat ? legal(s) : []),
      spot: (a) => (a.type === 'place' ? { to: a.to } : a.type === 'take' ? { to: a.at } : { from: a.from, to: a.to }),
      hit: 0.45,
      ring: 0.38,
    });
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const nm = (seat: number) => this.seatName(s, seat) ?? this.ctx.name(seat);
    const line = (seat: number) => `<div>${nm(seat)}: на доске <b>${count(s, seat) - s.hand[seat]}</b>${s.hand[seat] ? `, в руке <b>${s.hand[seat]}</b>` : ''}${flying(s, seat) ? ' — летает' : ''}</div>`;
    this.info.innerHTML = line(0) + line(1) + (s.take ? `<div class="ml-take">Мельница! Снимите фишку соперника${s.take > 1 ? ` (ещё ${s.take})` : ''}.</div>` : '');
  }

  seatName(v: State, seat: number) {
    return v.cfg.look === 'soviet' ? sovietNames[seat] : null;
  }

  setView(v: State) {
    this.s = v;
    if (!oak && v.cfg.look === 'wood') oak = woodTexture(WOODS.stained, 512, 7, false);
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'place') {
        this.pb.show(v, null, [], ev.to);
        Sound.place();
        await sleep((ev.mills ? 420 : 240) / this.ctx.speed());
      } else if (ev.type === 'move') {
        this.pb.show(v, { from: ev.from, to: ev.to, kind: String(ev.seat) });
        if (ev.fly) Sound.jump();
        else Sound.step();
        await sleep((ev.mills ? 520 : 340) / this.ctx.speed());
      } else if (ev.type === 'take') {
        this.pb.show(v, null, [{ p: ev.at, kind: String(1 - ev.seat) }]);
        Sound.capture();
        await sleep(420 / this.ctx.speed());
      } else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.pb.turn(s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null);
    this.text();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : 'Партия окончена';
    if (!interactive.includes(toAct[0])) return `Ходят ${this.ctx.name(toAct[0])}…`;
    if (v.take) return 'Мельница! Снимите фишку соперника';
    return v.hand[v.turn] ? 'Поставьте фишку' : flying(v, v.turn) ? 'Ваш ход — можно летать' : 'Ваш ход';
  }
}

export function createView(): GameView<State, Event> {
  return new MillView();
}

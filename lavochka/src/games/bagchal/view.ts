/* Баг-Чал — отрисовка. Непальская латунная доска: чеканная пластина с гравированными линиями и орнаментом по краю,
 * литые фигурки — тигры бронзовые с полосками, козы светлые с рожками. Вариант — резная деревянная доска.
 * Снизу — лоток с козами, которых ещё не поставили, сверху — съеденные. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { GOATS, legal, N, TIGER, type Action, type Event, type State } from './engine';
import './bagchal.css';

const M = 0.9; // поле вокруг точек
const TRAY = 0.75; // лотки сверху и снизу
const X = (p: number) => M + (p % N);
const Y = (p: number) => TRAY + M + Math.floor(p / N);

function defs(): string {
  return `<defs>
    <linearGradient id="bc-brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9c46a"/><stop offset="0.35" stop-color="#c9973a"/><stop offset="0.7" stop-color="#e2b75c"/><stop offset="1" stop-color="#9c6d22"/></linearGradient>
    <linearGradient id="bc-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a5a18"/><stop offset="1" stop-color="#4e300a"/></linearGradient>
    <radialGradient id="bc-tg" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#f3b04e"/><stop offset="0.6" stop-color="#c26f17"/><stop offset="1" stop-color="#6e3a07"/></radialGradient>
    <radialGradient id="bc-gt" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#e3dccb"/><stop offset="1" stop-color="#a69c84"/></radialGradient>
    <radialGradient id="bc-sh" cx="50%" cy="50%" r="50%"><stop offset="0.55" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <linearGradient id="bc-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a4a24"/><stop offset="0.5" stop-color="#5e3418"/><stop offset="1" stop-color="#4a2810"/></linearGradient>
    <filter id="bc-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.4 6" numOctaves="2" seed="4" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.1  0 0 0 0 0.05  0 0 0 0 0  0 0 0 0.5 -0.1" result="g"/>
      <feComposite in="g" in2="SourceGraphic" operator="in" result="t"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge>
    </filter>
    <filter id="bc-hammer" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="3" numOctaves="2" seed="9" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 0.9  0 0 0 0 0.6  0 0 0 0.35 -0.12" result="g"/>
      <feComposite in="g" in2="SourceGraphic" operator="in" result="t"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge>
    </filter>
  </defs>`;
}

/** Линии доски 5×5 с диагоналями. */
function lines(x0: number, y0: number): string {
  let d = '';
  const L = N - 1;
  for (let i = 0; i < N; i++) d += `M${x0 + i} ${y0}V${y0 + L}M${x0} ${y0 + i}H${x0 + L}`;
  d += `M${x0} ${y0}L${x0 + L} ${y0 + L}M${x0 + L} ${y0}L${x0} ${y0 + L}`;
  d += `M${x0 + 2} ${y0}L${x0} ${y0 + 2}L${x0 + 2} ${y0 + 4}L${x0 + 4} ${y0 + 2}Z`;
  return d;
}

function board(s: State): string {
  const W = N - 1 + 2 * M;
  const H = W + 2 * TRAY;
  const x0 = M;
  const y0 = TRAY + M;
  let o = defs();
  if (s.cfg.look === 'brass') {
    o += `<rect x="0" y="${TRAY - 0.05}" width="${W}" height="${W + 0.1}" rx="0.12" fill="url(#bc-rim)"/>`;
    o += `<rect x="0.1" y="${TRAY + 0.05}" width="${W - 0.2}" height="${W - 0.1}" rx="0.08" fill="url(#bc-brass)" filter="url(#bc-hammer)"/>`;
    // чеканный бордюр: двойная рамка и бусины
    o += `<rect x="0.32" y="${TRAY + 0.27}" width="${W - 0.64}" height="${W - 0.54}" fill="none" stroke="#7a5212" stroke-width="0.03"/>`;
    o += `<rect x="0.42" y="${TRAY + 0.37}" width="${W - 0.84}" height="${W - 0.74}" fill="none" stroke="#7a5212" stroke-width="0.02"/>`;
    for (let i = 0; i <= 24; i++) {
      const t = 0.45 + (i * (W - 0.9)) / 24;
      o += `<circle cx="${t}" cy="${TRAY + 0.2}" r="0.035" fill="#8a5e18"/><circle cx="${t}" cy="${TRAY + W - 0.2}" r="0.035" fill="#8a5e18"/>`;
      o += `<circle cx="0.2" cy="${TRAY + t}" r="0.035" fill="#8a5e18"/><circle cx="${W - 0.2}" cy="${TRAY + t}" r="0.035" fill="#8a5e18"/>`;
    }
    o += `<path d="${lines(x0, y0)}" fill="none" stroke="#fbe7a8" stroke-width="0.05" transform="translate(0.02 0.02)" opacity="0.6"/>`;
    o += `<path d="${lines(x0, y0)}" fill="none" stroke="#5a3a08" stroke-width="0.05"/>`;
    for (let p = 0; p < N * N; p++) o += `<circle cx="${X(p)}" cy="${Y(p)}" r="0.09" fill="#6a4610" stroke="#fbe7a8" stroke-opacity="0.5" stroke-width="0.015"/>`;
  } else {
    o += `<rect x="0" y="${TRAY - 0.05}" width="${W}" height="${W + 0.1}" rx="0.15" fill="url(#bc-wood)" filter="url(#bc-grain)" stroke="#2a1606" stroke-width="0.05"/>`;
    o += `<rect x="0.3" y="${TRAY + 0.25}" width="${W - 0.6}" height="${W - 0.5}" fill="none" stroke="#2a1606" stroke-width="0.04" opacity="0.7"/>`;
    o += `<path d="${lines(x0, y0)}" fill="none" stroke="#c99a5e" stroke-width="0.04" transform="translate(0 0.025)" opacity="0.55"/>`;
    o += `<path d="${lines(x0, y0)}" fill="none" stroke="#24120a" stroke-width="0.06"/>`;
    for (let p = 0; p < N * N; p++) o += `<circle cx="${X(p)}" cy="${Y(p)}" r="0.1" fill="#24120a"/>`;
  }
  // лотки: снизу — козы в запасе, сверху — съеденные
  const tray = (y: number, n: number, label: string) => {
    let t = `<rect x="0.15" y="${y}" width="${W - 0.3}" height="${TRAY - 0.15}" rx="0.25" fill="#000" opacity="0.18"/>`;
    t += `<text x="0.35" y="${y + TRAY / 2}" class="bc-tray">${label}</text>`;
    for (let i = 0; i < n; i++) t += goat(1.55 + i * ((W - 1.85) / 20), y + (TRAY - 0.15) / 2, 0.19);
    return t;
  };
  o += tray(0.05, s.eaten, 'съедены');
  o += tray(H - TRAY + 0.1, s.hand, 'в запасе');
  return o;
}

function tiger(x: number, y: number, r = 0.34): string {
  const k = r / 0.34;
  const ear = (sx: number) => `<path d="M${x + sx * 0.22 * k} ${y - 0.2 * k}l${sx * 0.1 * k} ${-0.16 * k}l${-sx * 0.2 * k} ${0.06 * k}z" fill="#9a5310" stroke="#3a1a02" stroke-width="${0.015 * k}"/>`;
  return `<circle cx="${x + 0.04 * k}" cy="${y + 0.06 * k}" r="${r * 1.1}" fill="url(#bc-sh)"/>
    ${ear(-1)}${ear(1)}
    <circle cx="${x}" cy="${y}" r="${r}" fill="url(#bc-tg)" stroke="#4a2604" stroke-width="${0.02 * k}"/>
    <path d="M${x - 0.06 * k} ${y - r * 0.95}l${0.03 * k} ${0.16 * k}M${x + 0.06 * k} ${y - r * 0.95}l${-0.03 * k} ${0.16 * k}M${x} ${y - r}v${0.2 * k}
      M${x - r * 0.95} ${y - 0.05 * k}l${0.17 * k} ${0.03 * k}M${x - r * 0.95} ${y + 0.08 * k}l${0.16 * k} ${-0.02 * k}
      M${x + r * 0.95} ${y - 0.05 * k}l${-0.17 * k} ${0.03 * k}M${x + r * 0.95} ${y + 0.08 * k}l${-0.16 * k} ${-0.02 * k}"
      stroke="#2a1404" stroke-width="${0.035 * k}" stroke-linecap="round"/>
    <ellipse cx="${x - 0.11 * k}" cy="${y - 0.04 * k}" rx="${0.05 * k}" ry="${0.035 * k}" fill="#ffe680" stroke="#2a1404" stroke-width="${0.015 * k}"/>
    <ellipse cx="${x + 0.11 * k}" cy="${y - 0.04 * k}" rx="${0.05 * k}" ry="${0.035 * k}" fill="#ffe680" stroke="#2a1404" stroke-width="${0.015 * k}"/>
    <path d="M${x - 0.05 * k} ${y + 0.1 * k}h${0.1 * k}l${-0.05 * k} ${0.06 * k}z" fill="#2a1404"/>
    <path d="M${x} ${y + 0.16 * k}q${-0.07 * k} ${0.07 * k} ${-0.13 * k} ${0.02 * k}M${x} ${y + 0.16 * k}q${0.07 * k} ${0.07 * k} ${0.13 * k} ${0.02 * k}" fill="none" stroke="#2a1404" stroke-width="${0.02 * k}"/>`;
}

function goat(x: number, y: number, r = 0.3): string {
  const k = r / 0.3;
  const horn = (sx: number) => `<path d="M${x + sx * 0.1 * k} ${y - 0.2 * k}q${sx * 0.12 * k} ${-0.2 * k} ${sx * 0.26 * k} ${-0.1 * k}" fill="none" stroke="#6a5a3a" stroke-width="${0.06 * k}" stroke-linecap="round"/>`;
  return `<circle cx="${x + 0.035 * k}" cy="${y + 0.05 * k}" r="${r * 1.1}" fill="url(#bc-sh)"/>
    ${horn(-1)}${horn(1)}
    <circle cx="${x}" cy="${y}" r="${r}" fill="url(#bc-gt)" stroke="#7a705a" stroke-width="${0.02 * k}"/>
    <circle cx="${x - 0.09 * k}" cy="${y - 0.04 * k}" r="${0.03 * k}" fill="#2a2418"/><circle cx="${x + 0.09 * k}" cy="${y - 0.04 * k}" r="${0.03 * k}" fill="#2a2418"/>
    <ellipse cx="${x}" cy="${y + 0.11 * k}" rx="${0.07 * k}" ry="${0.05 * k}" fill="#d8c8b0" stroke="#8a7a60" stroke-width="${0.012 * k}"/>
    <path d="M${x} ${y + 0.17 * k}v${0.12 * k}" stroke="#bfb39a" stroke-width="${0.05 * k}" stroke-linecap="round"/>`;
}

class BagchalView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private s: State | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="bc-info"></div>`);
    ctx.controls.appendChild(this.info);
    if (!ctx.demo) ctx.controls.appendChild(h(`<div class="bc-hint">Коза — нажмите на точку, куда поставить; потом — на козу и на соседнюю точку. Тигр — на тигра и на точку, куда пойти или прыгнуть.</div>`));
    this.pb = new PointBoard<State, Action>(root, ctx, {
      count: () => N * N,
      size: () => [N - 1 + 2 * M, N - 1 + 2 * M + 2 * TRAY],
      xy: (_s, p) => [X(p), Y(p)],
      board,
      pieces: (s) => s.board.flatMap((v, p) => (v ? [{ p, kind: v === TIGER ? 't' : 'g' }] : [])),
      piece: (_s, kind, x, y) => (kind === 't' ? tiger(x, y) : goat(x, y)),
      legal: (s, seat) => (s.turn === seat ? legal(s) : []),
      spot: (a) => (a.type === 'place' ? { to: a.to } : { from: a.from, to: a.to }),
      hit: 0.45,
      ring: 0.4,
    });
  }

  private text() {
    const s = this.s;
    if (!s) return;
    this.info.innerHTML = `<div>🐐 в запасе: <b>${s.hand}</b> · съедено: <b>${s.eaten}</b> из ${s.cfg.need}</div>${s.cfg.calm && s.hand > 0 ? '<small>Мирная расстановка: тигры пока не едят</small>' : ''}`;
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'place') {
        this.pb.show(v, null, [], ev.to);
        Sound.place();
        await sleep(240 / this.ctx.speed());
      } else if (ev.type === 'move') {
        const taken = ev.eat >= 0 ? [{ p: ev.eat, kind: 'g' }] : [];
        this.pb.show(v, { from: ev.from, to: ev.to, kind: ev.kind === TIGER ? 't' : 'g' }, taken);
        if (ev.eat >= 0) {
          Sound.jump();
          setTimeout(() => Sound.capture(), 260);
        } else Sound.step();
        await sleep((ev.eat >= 0 ? 560 : 340) / this.ctx.speed());
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
    if (v.over) return v.winner == null ? 'Ничья' : v.winner === GOATS ? 'Тигры заперты — козы победили' : 'Тигры победили';
    if (!interactive.includes(toAct[0])) return `Ходят ${this.ctx.name(toAct[0])}…`;
    return v.turn === GOATS ? (v.hand > 0 ? 'Поставьте козу' : 'Ваш ход — козой') : 'Ваш ход — тигром';
  }
}

export function createView(): GameView<State, Event> {
  return new BagchalView();
}


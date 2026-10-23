/* Пентаго — отрисовка (SVG), всё в коде: тёмное основание и квадранты-плашки с лунками — светлый клён
 * или тёмный сланец; шарики — стекло (чёрные, белые, красные, синие). Поставили шарик — на квадрантах появляются
 * стрелки: левая половина — против часовой, правая — по часовой (на большой доске — только по часовой).
 * Поворот показан вращением плашки вместе с шариками; выигравший ряд обведён. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { quadName } from './def';
import { dirs, legal as legalOf, quads, X, Y, type Action, type Event, type State } from './engine';
import './pentago.css';

const M = 0.55;
const GAP = 0.2;
const k = (s: State) => s.cfg.size / 3;
const span = (s: State) => k(s) * 3 + (k(s) - 1) * GAP + 2 * M;
/** Левый верхний угол квадранта. */
const qx0 = (s: State, q: number) => M + (q % k(s)) * (3 + GAP);
const qy0 = (s: State, q: number) => M + Math.floor(q / k(s)) * (3 + GAP);
const cellX = (s: State, p: number) => M + X(s.cfg, p) + Math.floor(X(s.cfg, p) / 3) * GAP + 0.5;
const cellY = (s: State, p: number) => M + Y(s.cfg, p) + Math.floor(Y(s.cfg, p) / 3) * GAP + 0.5;
/** Точки поворота: после клеток, по две на квадрант (против, по часовой). */
const N = (s: State) => s.cfg.size * s.cfg.size;
const tw = (s: State, q: number, dir: number) => N(s) + q * 2 + (dir > 0 ? 1 : 0);

/** Стекло шариков: блик, цвет, тень. */
const GLASS = [
  ['#7a7a84', '#1c1c22', '#000000'],
  ['#ffffff', '#e6e2d8', '#9a9488'],
  ['#ff8a80', '#c8242a', '#5a0608'],
  ['#9ac0ff', '#2050c0', '#081a58'],
];

function defs(s: State): string {
  let g = '';
  GLASS.forEach(([l, c, d], i) => {
    g += `<radialGradient id="pt-m${i}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${l}"/><stop offset="0.45" stop-color="${c}"/><stop offset="1" stop-color="${d}"/></radialGradient>`;
  });
  const stone = s.cfg.look === 'stone';
  g += stone
    ? `<linearGradient id="pt-base" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2c32"/><stop offset="1" stop-color="#0c0d10"/></linearGradient>
       <linearGradient id="pt-plate" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5c6670"/><stop offset="0.5" stop-color="#3c444c"/><stop offset="1" stop-color="#262c32"/></linearGradient>`
    : `<linearGradient id="pt-base" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6a3c1c"/><stop offset="1" stop-color="#2a1608"/></linearGradient>
       <linearGradient id="pt-plate" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2d9a8"/><stop offset="0.55" stop-color="#ddb478"/><stop offset="1" stop-color="#b98848"/></linearGradient>`;
  g += `<radialGradient id="pt-hole" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#000" stop-opacity="${stone ? 0.75 : 0.55}"/><stop offset="0.75" stop-color="#000" stop-opacity="${stone ? 0.55 : 0.3}"/><stop offset="1" stop-color="#fff" stop-opacity="0.18"/></radialGradient>`;
  g += `<radialGradient id="pt-sh" cx="50%" cy="50%" r="50%"><stop offset="0.5" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`;
  g += stone
    ? `<filter id="pt-tex" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="2.4" numOctaves="2" seed="5" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.85  0 0 0 0 0.9  0 0 0 0 0.95  0 0 0 0.12 -0.02" result="g"/><feComposite in="g" in2="SourceGraphic" operator="in" result="t"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge></filter>`
    : `<filter id="pt-tex" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.25 3.5" numOctaves="2" seed="11" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.32  0 0 0 0 0.1  0 0 0 0.3 -0.06" result="g"/><feComposite in="g" in2="SourceGraphic" operator="in" result="t"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge></filter>`;
  return `<defs>${g}</defs>`;
}

/** Плашка квадранта с лунками; (x0, y0) — её левый верхний угол. */
function plate(s: State, x0: number, y0: number): string {
  let o = `<rect x="${x0 + 0.05}" y="${y0 + 0.09}" width="3" height="3" rx="0.22" fill="#000" opacity="0.4"/>`;
  o += `<rect x="${x0}" y="${y0}" width="3" height="3" rx="0.22" fill="url(#pt-plate)" filter="url(#pt-tex)"/>`;
  o += `<rect x="${x0 + 0.03}" y="${y0 + 0.03}" width="2.94" height="2.94" rx="0.2" fill="none" stroke="#fff" stroke-opacity="0.2" stroke-width="0.025"/>`;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o += `<circle cx="${x0 + c + 0.5}" cy="${y0 + r + 0.5}" r="0.33" fill="url(#pt-hole)"/>`;
  return o;
}

function marble(seat: number, x: number, y: number): string {
  return `<ellipse cx="${x + 0.05}" cy="${y + 0.09}" rx="0.36" ry="0.3" fill="url(#pt-sh)"/>
    <circle cx="${x}" cy="${y}" r="0.37" fill="url(#pt-m${seat})"/>
    <ellipse cx="${x - 0.12}" cy="${y - 0.14}" rx="0.11" ry="0.07" fill="#fff" opacity="${seat === 1 ? 0.9 : 0.55}" transform="rotate(-30 ${x - 0.12} ${y - 0.14})"/>`;
}

/** Стрелка-дуга поворота вокруг (cx, cy): dir 1 — по часовой. */
function arrow(cx: number, cy: number, dir: number, hot: boolean): string {
  const r = 0.62;
  const a0 = dir > 0 ? -150 : -30;
  const a1 = dir > 0 ? -30 : -150;
  const P = (a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = P(a0);
  const [x1, y1] = P(a1);
  const sweep = dir > 0 ? 1 : 0;
  // наконечник по касательной в конце дуги
  const t = ((a1 + (dir > 0 ? 90 : -90)) * Math.PI) / 180;
  const n = (a1 * Math.PI) / 180;
  const hx = x1 + Math.cos(t) * 0.16;
  const hy = y1 + Math.sin(t) * 0.16;
  const col = hot ? '#ffe066' : '#fff6d0';
  return `<path d="M${x0} ${y0}A${r} ${r} 0 0 ${sweep} ${x1} ${y1}" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="0.16" stroke-linecap="round"/>
    <path d="M${x0} ${y0}A${r} ${r} 0 0 ${sweep} ${x1} ${y1}" fill="none" stroke="${col}" stroke-width="${hot ? 0.11 : 0.08}" stroke-linecap="round"/>
    <path d="M${hx} ${hy}L${x1 + Math.cos(n) * 0.13} ${y1 + Math.sin(n) * 0.13}L${x1 - Math.cos(n) * 0.13} ${y1 - Math.sin(n) * 0.13}Z" fill="${col}" stroke="#000" stroke-opacity="0.45" stroke-width="0.02"/>`;
}

class PentagoView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private s: State | null = null;
  /** Квадрант, который сейчас крутится (на время показа). */
  private spin: { q: number; dir: number; board: number[] } | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="pt-info"></div>`);
    ctx.controls.appendChild(this.info);
    if (!ctx.demo) ctx.controls.appendChild(h(`<div class="pt-hint">Поставьте шарик в пустую лунку, потом поверните квадрант — нажмите на него, куда показывает стрелка (на малой доске левая половина крутит против часовой, правая — по часовой). Пять в ряд — победа.</div>`));
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: (s) => N(s) + quads(s.cfg) * 2,
        size: (s) => [span(s), span(s)],
        xy: (s, p) => {
          if (p < N(s)) return [cellX(s, p), cellY(s, p)];
          const q = (p - N(s)) >> 1;
          const right = (p - N(s)) & 1;
          const one = dirs(s.cfg).length === 1;
          return [qx0(s, q) + (one ? 1.5 : right ? 2.25 : 0.75), qy0(s, q) + 1.23]; // вершина стрелки
        },
        board: (s) => this.board(s),
        pieces: (s) => s.board.flatMap((v, p) => (v >= 0 && !(this.spin && this.inSpin(s, p)) ? [{ p, kind: String(v) }] : [])),
        piece: (_s, kind, x, y) => marble(Number(kind), x, y),
        legal: (s, seat) => (s.turn === seat && !s.over ? legalOf(s) : []),
        spot: (a) => (a.type === 'place' ? { to: a.p } : a.q < 0 ? null : { to: N(this.s!) + a.q * 2 + (a.dir > 0 ? 1 : 0) }),
        label: () => 'Не крутить',
        // в фазе поворота — квадрант под мышью и его половина
        // в фазе постановки — лунка под мышью, в фазе поворота — квадрант и его половина
        pick: (s, x, y) => {
          if (s.over) return -1;
          for (let q = 0; q < quads(s.cfg); q++) {
            const x0 = qx0(s, q);
            const y0 = qy0(s, q);
            if (x < x0 - GAP / 2 || x > x0 + 3 + GAP / 2 || y < y0 - GAP / 2 || y > y0 + 3 + GAP / 2) continue;
            if (s.phase === 'twist') return tw(s, q, dirs(s.cfg).length === 1 || x >= x0 + 1.5 ? 1 : -1);
            const c = Math.min(2, Math.max(0, Math.floor(x - x0)));
            const r = Math.min(2, Math.max(0, Math.floor(y - y0)));
            const k0 = k(s);
            return ((Math.floor(q / k0) * 3 + r) * s.cfg.size) + (q % k0) * 3 + c;
          }
          return -1;
        },
        hit: 0.48,
        ring: 0.42,
      },
      'pt-wrap'
    );
    this.pb.extra = (s) => this.overlay(s);
  }

  private inSpin(s: State, p: number): boolean {
    return !!this.spin && Math.floor(Y(s.cfg, p) / 3) * k(s) + Math.floor(X(s.cfg, p) / 3) === this.spin.q;
  }

  private board(s: State): string {
    const W = span(s);
    let o = defs(s);
    o += `<rect x="0" y="0" width="${W}" height="${W}" rx="0.35" fill="url(#pt-base)" filter="url(#pt-tex)"/>`;
    o += `<rect x="0.08" y="0.08" width="${W - 0.16}" height="${W - 0.16}" rx="0.3" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="0.03"/>`;
    for (let q = 0; q < quads(s.cfg); q++) if (!this.spin || this.spin.q !== q) o += plate(s, qx0(s, q), qy0(s, q));
    // последний поворот — тонкая стрелка в углу квадранта
    if (s.twist && !this.spin && s.phase === 'place' && !s.over) {
      const x0 = qx0(s, s.twist.q);
      const y0 = qy0(s, s.twist.q);
      o += `<g opacity="0.55" transform="translate(${x0 + 2.95} ${y0 + 0.05}) scale(0.32)">${arrow(0, 0.6, s.twist.dir, false)}</g>`;
    }
    return o;
  }

  private overlay(s: State): string {
    let o = '';
    // крутящийся квадрант вместе с шариками
    if (this.spin) {
      const { q, dir, board } = this.spin;
      const x0 = qx0(s, q);
      const y0 = qy0(s, q);
      let g = plate(s, x0, y0);
      for (let p = 0; p < board.length; p++) if (board[p] >= 0 && this.inSpin(s, p)) g += marble(board[p], cellX(s, p), cellY(s, p));
      o += `<g class="pt-spin" style="transform-origin:${x0 + 1.5}px ${y0 + 1.5}px;--to:${dir * 90}deg">${g}</g>`;
    }
    // стрелки поворота
    if (s.phase === 'twist' && !s.over && !this.spin && this.pb && this.ctx && !this.ctx.demo) {
      const hov = this.pb.hovered;
      for (let q = 0; q < quads(s.cfg); q++) {
        const cx = qx0(s, q) + 1.5;
        const cy = qy0(s, q) + 1.5;
        for (const dir of dirs(s.cfg)) {
          const hot = hov === tw(s, q, dir);
          const dx = dirs(s.cfg).length === 1 ? 0 : dir > 0 ? 0.75 : -0.75;
          o += `<g opacity="${hot ? 1 : 0.6}" pointer-events="none">${arrow(cx + dx, cy + 0.35, dir, hot)}</g>`;
          if (hot) o += `<rect x="${qx0(s, q) - 0.06}" y="${qy0(s, q) - 0.06}" width="3.12" height="3.12" rx="0.26" fill="none" stroke="#ffe066" stroke-width="0.05" pointer-events="none"/>`;
        }
      }
    }
    // выигравший ряд
    if (s.over && s.row.length)
      for (const p of s.row) o += `<circle cx="${cellX(s, p)}" cy="${cellY(s, p)}" r="0.44" fill="none" stroke="#ffd84a" stroke-width="0.07" pointer-events="none"/>`;
    return o;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    let t = '';
    if (!s.over) t += `<div>Ходят ${this.ctx.name(s.turn).toLowerCase()}: ${s.phase === 'place' ? 'ставят шарик' : 'крутят квадрант'}</div>`;
    const left = s.board.filter((v) => v < 0).length;
    t += `<small>Пять в ряд · свободных лунок: ${left}${s.cfg.free ? ' · поворот по желанию' : ''}${s.cfg.size === 9 ? ' · крутят только по часовой' : ''}</small>`;
    if (s.twist && !s.over) t += `<small>Последний поворот: ${quadName(s.cfg.size, s.twist.q)} — ${s.twist.dir > 0 ? 'по часовой' : 'против часовой'}</small>`;
    this.info.innerHTML = t;
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    let cur: State = this.s ?? v;
    const sp = () => this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'place') {
        const board = cur.board.slice();
        board[ev.p] = ev.seat;
        cur = { ...cur, board, phase: 'twist', last: [ev.p], twist: null };
        this.s = cur;
        this.pb.show(cur, null, [], ev.p);
        Sound.place();
        await sleep(300 / sp());
      } else if (ev.type === 'twist') {
        if (ev.q >= 0) {
          this.spin = { q: ev.q, dir: ev.dir, board: cur.board.slice() };
          this.pb.mark([]);
          this.pb.set(cur);
          Sound.turn();
          await sleep(520 / sp());
          this.spin = null;
        }
        const nb = v.board;
        cur = { ...cur, board: nb.slice(), phase: 'place', twist: ev.q >= 0 ? { q: ev.q, dir: ev.dir } : null };
        this.pb.set(cur);
      } else if (ev.type === 'end') {
        if (ev.winners.length) Sound.win();
        else Sound.nomove();
        await sleep(500 / sp());
      }
    }
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.pb.turn(s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null);
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winners.length ? `Победа: ${v.winners.map((w) => this.ctx.name(w)).join(', ')}` : 'Ничья';
    if (!interactive.includes(toAct[0])) return `Ходят ${this.ctx.name(toAct[0]).toLowerCase()}…`;
    if (v.phase === 'place') return 'Ваш ход — поставьте шарик';
    return dirs(v.cfg).length === 1 ? 'Поверните квадрант — нажмите на него' : 'Поверните квадрант: левая половина — против часовой, правая — по часовой';
  }
}

export function createView(): GameView<State, Event> {
  return new PentagoView();
}

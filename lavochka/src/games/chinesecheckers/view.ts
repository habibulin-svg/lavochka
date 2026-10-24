/* Китайские шашки — отрисовка на общей доске PointBoard.
 * «Ромашка» — по фото советской доски: жёлтый шестиугольник из оргалита с винтами по углам, цветок из шести лепестков
 * (коричневый, оранжевый, голубой, жёлтый, зелёный, розовый), сердцевина поделена на цветные дольки, лунки — тёмные с тонкой сеткой линий.
 * Звезда — деревянный круг с цветными лучами; халма — клетчатая доска 16×16 с лагерями в углах. Шарики — стеклянные, цвета своего лепестка.
 * Доска повёрнута так, чтобы ваш дом был внизу. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { geoOf, moves, type Action, type Event, type State } from './engine';
import { SEATS } from './def';
import './chinesecheckers.css';

/** Лепестки «Ромашки» по углам (снизу по часовой) — как на фото. */
const PETAL = ['#b89a78', '#f2a868', '#4aa8e0', '#f2d84a', '#3aa070', '#f09a9a'];
/** Поля вокруг лунок: у «Ромашки» — шестиугольник с лепестками, у звезды — круг, у халмы — рамка. */
const PAD: Record<string, number> = { romashka: 3.3, star: 2.4, halma: 1 };

class CheckersView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private s: State | null = null;
  private cache = new Map<string, { xs: number[]; ys: number[]; w: number; h: number; rot: number }>();

  /** Координаты лунок с поворотом «мой дом — внизу» и сдвигом в положительные. */
  private layout(s: State) {
    const mine = this.ctx.mySeats.find((x) => s.seats.includes(x));
    const g = geoOf(s.cfg);
    const corner = mine != null ? s.corner[mine] : s.corner[s.seats[0]];
    const key = `${s.cfg.mode}${s.cfg.players}:${corner}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const cx = g.x.reduce((a, b) => a + b, 0) / g.x.length;
    const cy = g.y.reduce((a, b) => a + b, 0) / g.y.length;
    const ang = (home: number[]) => {
      const x = home.reduce((a, p) => a + g.x[p], 0) / home.length - cx;
      const y = home.reduce((a, p) => a + g.y[p], 0) / home.length - cy;
      return Math.atan2(y, x);
    };
    // поворот: мой дом — туда, где «низ» (π/2 в экранных координатах)
    // халма: только кратно 90°, свой лагерь — в левом нижнем углу (3π/4)
    const rot = s.cfg.mode === 'halma' ? Math.round(((3 * Math.PI) / 4 - ang(g.homes[corner])) / (Math.PI / 2)) * (Math.PI / 2) : Math.PI / 2 - ang(g.homes[corner]);
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    const rx = g.x.map((x, i) => (x - cx) * c - (g.y[i] - cy) * sn);
    const ry = g.x.map((x, i) => (x - cx) * sn + (g.y[i] - cy) * c);
    const minX = Math.min(...rx);
    const minY = Math.min(...ry);
    const pad = PAD[s.cfg.mode];
    // доска квадратная по большей стороне, лунки — по центру
    const side = Math.max(Math.max(...rx) - minX, Math.max(...ry) - minY) + 2 * pad;
    const ox = (side - (Math.max(...rx) - minX)) / 2;
    const oy = (side - (Math.max(...ry) - minY)) / 2;
    const out = { xs: rx.map((x) => x - minX + ox), ys: ry.map((y) => y - minY + oy), w: side, h: side, rot };
    this.cache.set(key, out);
    return out;
  }

  private board(s: State): string {
    const L = this.layout(s);
    const g = geoOf(s.cfg);
    let o = '<defs>';
    SEATS.forEach((st, i) => {
      o += `<radialGradient id="cc-m${i}" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".25" stop-color="${st.light}"/><stop offset=".8" stop-color="${st.color}"/><stop offset="1" stop-color="${st.dark}"/></radialGradient>`;
    });
    o += `<radialGradient id="cc-hole" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#1a1206"/><stop offset=".8" stop-color="#3a2a10"/><stop offset="1" stop-color="#8a7a3a"/></radialGradient>`;
    o += `<linearGradient id="cc-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d8a868"/><stop offset="1" stop-color="#a87038"/></linearGradient></defs>`;
    const cx = L.w / 2;
    const cy = L.h / 2;
    const home = (k: number) => g.homes[k];
    const centroid = (ps: number[]) => [ps.reduce((a, p) => a + L.xs[p], 0) / ps.length, ps.reduce((a, p) => a + L.ys[p], 0) / ps.length];
    if (s.cfg.mode === 'halma') {
      const n = 16;
      const x0 = Math.min(...L.xs) - 0.5;
      const y0 = Math.min(...L.ys) - 0.5;
      o += `<rect x="0.1" y="0.1" width="${L.w - 0.2}" height="${L.h - 0.2}" rx="0.4" fill="url(#cc-wood)" stroke="#5a3414" stroke-width="0.12"/>`;
      o += `<rect x="${x0}" y="${y0}" width="${n}" height="${n}" fill="#f4e8cc"/>`;
      for (let p = 0; p < g.x.length; p++) if ((g.x[p] + g.y[p]) % 2) o += `<rect x="${L.xs[p] - 0.5}" y="${L.ys[p] - 0.5}" width="1" height="1" fill="#d8c49a"/>`;
      for (let k = 0; k < g.homes.length; k++) {
        const owner = s.seats.find((x) => s.corner[x] === k);
        if (owner == null) continue;
        const col = SEATS[owner].light;
        for (const p of home(k)) o += `<rect x="${L.xs[p] - 0.5}" y="${L.ys[p] - 0.5}" width="1" height="1" fill="${col}" opacity=".35"/>`;
      }
      o += `<rect x="${x0}" y="${y0}" width="${n}" height="${n}" fill="none" stroke="#5a3414" stroke-width="0.06"/>`;
      return o;
    }
    const romashka = s.cfg.mode === 'romashka';
    if (romashka) {
      // жёлтый шестиугольник с винтами
      const R = Math.min(L.w, L.h) / 2 - 0.05;
      const hex = (r: number) => Array.from({ length: 6 }, (_, i) => {
        // вершины — между лепестками (лепестки после поворота смотрят на 90° ± 60°·k)
        const a = (Math.PI / 3) * i;
        return `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
      });
      o += `<path d="M${hex(R).join('L')}Z" fill="#f0d23a" stroke="#c8a818" stroke-width="0.1"/>`;
      for (const pt of hex(R - 0.55)) {
        const [x, y] = pt.split(' ').map(Number);
        o += `<circle cx="${x}" cy="${y}" r="0.13" fill="#6a5a2a"/><circle cx="${x - 0.03}" cy="${y - 0.03}" r="0.05" fill="#d8c070"/>`;
      }
      // контур цветка (толстая тёмная обводка лепестков), потом заливки поверх
      const petals = Array.from({ length: 6 }, (_, k) => centroid(home(k)));
      for (const [x, y] of petals) o += `<circle cx="${x}" cy="${y}" r="2.55" fill="#1a1a2a" stroke="#1a1a2a" stroke-width="0.32"/>`;
      o += `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#1a1a2a" stroke="#1a1a2a" stroke-width="0.32"/>`;
      for (const [x, y] of petals) o += `<circle cx="${x}" cy="${y}" r="2.55" fill="#fff8e0" stroke="#fff8e0" stroke-width="0.18"/>`;
      o += `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#fff8e0"/>`;
      // дольки сердцевины — цветом лепестка в своей стороне
      for (let k = 0; k < 6; k++) {
        const [px, py] = petals[k];
        const a = Math.atan2(py - cy, px - cx);
        const a1 = a - Math.PI / 6;
        const a2 = a + Math.PI / 6;
        const r = 4.4;
        o += `<path d="M${cx} ${cy}L${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}A${r} ${r} 0 0 1 ${cx + r * Math.cos(a2)} ${cy + r * Math.sin(a2)}Z" fill="${PETAL[k]}"/>`;
        o += `<circle cx="${px}" cy="${py}" r="2.45" fill="${PETAL[k]}"/>`;
      }
    } else {
      o += `<circle cx="${cx}" cy="${cy}" r="${Math.min(L.w, L.h) / 2 - 0.05}" fill="url(#cc-wood)" stroke="#5a3414" stroke-width="0.12"/>`;
      for (let k = 0; k < 6; k++) {
        const ps = home(k);
        // треугольник луча по трём крайним лункам
        const far = ps.map((p) => [L.xs[p], L.ys[p]]);
        const [mx, my] = centroid(ps);
        const ext = far.sort((a, b) => Math.hypot(b[0] - mx, b[1] - my) - Math.hypot(a[0] - mx, a[1] - my)).slice(0, 3);
        const grow = (p: number[]) => [mx + (p[0] - mx) * 1.35, my + (p[1] - my) * 1.35];
        o += `<path d="M${ext.map(grow).map((p) => p.join(' ')).join('L')}Z" fill="${SEATS[k].light}" opacity=".55" stroke-linejoin="round" stroke="${SEATS[k].light}" stroke-width="0.4"/>`;
      }
    }
    // сетка: линии между соседними лунками
    let lines = '';
    for (let p = 0; p < g.x.length; p++)
      for (const q of g.nb[p].slice(0, 3)) if (q >= 0) lines += `M${L.xs[p]} ${L.ys[p]}L${L.xs[q]} ${L.ys[q]}`;
    o += `<path d="${lines}" stroke="${romashka ? '#6a5a3a' : '#5a3414'}" stroke-width="0.03" opacity=".55" fill="none"/>`;
    for (let p = 0; p < g.x.length; p++) o += `<circle cx="${L.xs[p]}" cy="${L.ys[p]}" r="0.27" fill="url(#cc-hole)"/>`;
    return o;
  }

  private piece(s: State, kind: string, x: number, y: number): string {
    const seat = Number(kind);
    const r = s.cfg.mode === 'halma' ? 0.4 : 0.36;
    return `<ellipse cx="${x + 0.05}" cy="${y + 0.08}" rx="${r}" ry="${r * 0.9}" fill="rgba(0,0,0,0.35)"/><circle cx="${x}" cy="${y}" r="${r}" fill="url(#cc-m${seat})" stroke="${SEATS[seat].dark}" stroke-width="0.03"/>`;
  }

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h('<div class="cc-info"></div>');
    ctx.controls.appendChild(this.info);
    if (!ctx.demo) ctx.controls.appendChild(h('<div class="cc-hint">Коснитесь своего шарика, потом — подсвеченной лунки. Прыжки цепочкой делаются одним ходом.</div>'));
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: (s) => geoOf(s.cfg).x.length,
        size: (s) => {
          const L = this.layout(s);
          return [L.w, L.h];
        },
        xy: (s, p) => {
          const L = this.layout(s);
          return [L.xs[p], L.ys[p]];
        },
        board: (s) => this.board(s),
        pieces: (s) => s.board.flatMap((seat, p) => (seat >= 0 ? [{ p, kind: String(seat) }] : [])),
        piece: (s, kind, x, y) => this.piece(s, kind, x, y),
        legal: (s, seat) => (s.turn === seat && !s.over ? moves(s, seat).map((m) => ({ type: 'move', from: m.from, to: m.to }) as Action) : []),
        spot: (a) => ({ from: a.from, to: a.to }),
        hit: 0.5,
        ring: 0.42,
      },
      'cc-wrap'
    );
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const g = geoOf(s.cfg);
    const done = (seat: number) => g.homes[g.opp[s.corner[seat]]].filter((p) => s.board[p] === seat).length;
    const total = g.homes[0].length;
    this.info.innerHTML = s.seats.map((x) => `<div><i class="cc-dot" style="background:${SEATS[x].color}"></i>${this.ctx.name(x)}: дома ${done(x)} из ${total}</div>`).join('');
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last ? [v.last[0], v.last[v.last.length - 1]] : []);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    let cur = this.s ?? v;
    for (const ev of events) {
      if (ev.type === 'move') {
        // по прыжкам — лунка за лункой
        for (let k = 1; k < ev.path.length; k++) {
          const board = cur.board.slice();
          board[ev.path[k - 1]] = -1;
          board[ev.path[k]] = ev.seat;
          const after: State = { ...cur, board, last: ev.path.slice(0, k + 1) };
          this.pb.mark([ev.path[k - 1], ev.path[k]]);
          this.pb.show(after, { from: ev.path[k - 1], to: ev.path[k], kind: String(ev.seat) });
          Sound.place();
          await sleep((ev.path.length > 2 ? 220 : 300) / this.ctx.speed());
          cur = after;
        }
      } else if (ev.type === 'end') Sound.win();
    }
    this.setView(v);
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.pb.turn(s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null);
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : `Победа: ${this.ctx.name(v.winner)}`;
    const who = toAct[0];
    return interactive.includes(who) ? 'Ваш ход' : `Ходят ${this.ctx.name(who)}…`;
  }
}

export function createView(): GameView<State, Event> {
  return new CheckersView();
}

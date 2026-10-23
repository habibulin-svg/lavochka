/* Суракарта — отрисовка. Яванская доска «по-родному»: резной тик с инкрустацией (малый круг — латунь, большой — зелёный
 * камень), фишки — красные семена саги и светлые ракушки-улитки; или батик (кавунг по полю, паранг по краю, круги
 * расписаны индиго и согой), фишки — медные и серебряные монетки с квадратной дыркой.
 * Взятие показывается проездом фишки по линиям и петлям; при выборе фишки и наведении на цель — её путь пунктиром. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { CIRCUITS, count, legal as legalOf, N, RED, takesFrom, trackSteps, type Event, type State, type Track, type Action } from './engine';
import './surakarta.css';

const M = 2.55; // поле вокруг точек: место для больших петель
const SIZE = N - 1 + 2 * M;
const X = (p: number) => M + (p % N);
const Y = (p: number) => M + Math.floor(p / N);

/** Флаг дуги «на три четверти» вокруг угла (cx, cy): из (x0, y0) в (x1, y1). */
function sweep(cx: number, cy: number, x0: number, y0: number, x1: number, y1: number): { a0: number; da: number } {
  const a0 = Math.atan2(y0 - cy, x0 - cx);
  let d = Math.atan2(y1 - cy, x1 - cx) - a0;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return { a0, da: d - Math.sign(d) * 2 * Math.PI };
}

/** SVG-путь круга c: линии и петли. */
function circuitPath(c: number): string {
  const C = CIRCUITS[c];
  const r = C.k;
  let d = `M${X(C.seq[0])} ${Y(C.seq[0])}`;
  for (let i = 0; i < 24; i++) {
    const p = C.seq[i];
    const q = C.seq[(i + 1) % 24];
    if (C.loop[i]) {
      const [cx, cy] = C.corner[i].map((v) => v + M);
      const { da } = sweep(cx, cy, X(p), Y(p), X(q), Y(q));
      d += `A${r} ${r} 0 1 ${da > 0 ? 1 : 0} ${X(q)} ${Y(q)}`;
    } else d += `L${X(q)} ${Y(q)}`;
  }
  return d + 'Z';
}

/** Точки пути взятия (с дугами по кусочкам), начиная с исходной. */
function trackPoints(t: Track): [number, number][] {
  const C = CIRCUITS[t.c];
  let px = X(C.seq[t.i]);
  let py = Y(C.seq[t.i]);
  const out: [number, number][] = [[px, py]];
  for (const st of trackSteps(t)) {
    const x = X(st.p);
    const y = Y(st.p);
    if (st.loop) {
      const cx = st.corner[0] + M;
      const cy = st.corner[1] + M;
      const { a0, da } = sweep(cx, cy, px, py, x, y);
      const n = 18 * C.k;
      for (let i = 1; i <= n; i++) {
        const a = a0 + (da * i) / n;
        out.push([cx + C.k * Math.cos(a), cy + C.k * Math.sin(a)]);
      }
    } else out.push([x, y]);
    px = x;
    py = y;
  }
  return out;
}

const pts = (ps: [number, number][]) => ps.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' ');

function defs(): string {
  return `<defs>
    <linearGradient id="sk-teak" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b0743e"/><stop offset="0.5" stop-color="#93582a"/><stop offset="1" stop-color="#6c3c18"/></linearGradient>
    <linearGradient id="sk-frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a4418"/><stop offset="1" stop-color="#3c1e08"/></linearGradient>
    <linearGradient id="sk-brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbe08a"/><stop offset="0.5" stop-color="#d4a23c"/><stop offset="1" stop-color="#8a5e14"/></linearGradient>
    <linearGradient id="sk-jade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ad8b8"/><stop offset="0.5" stop-color="#2e9a78"/><stop offset="1" stop-color="#145a44"/></linearGradient>
    <radialGradient id="sk-saga" cx="36%" cy="30%" r="75%"><stop offset="0" stop-color="#ff9a7a"/><stop offset="0.3" stop-color="#f0301a"/><stop offset="0.8" stop-color="#a80e06"/><stop offset="1" stop-color="#4a0402"/></radialGradient>
    <radialGradient id="sk-snail" cx="40%" cy="34%" r="72%"><stop offset="0" stop-color="#fffdf4"/><stop offset="0.6" stop-color="#eadcbc"/><stop offset="1" stop-color="#a48c66"/></radialGradient>
    <radialGradient id="sk-copper" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="#ffb48a"/><stop offset="0.45" stop-color="#c8582a"/><stop offset="1" stop-color="#5a1c06"/></radialGradient>
    <radialGradient id="sk-silver" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#cfd0d4"/><stop offset="1" stop-color="#6e7076"/></radialGradient>
    <radialGradient id="sk-sh" cx="50%" cy="50%" r="50%"><stop offset="0.55" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <pattern id="sk-kawung" width="0.9" height="0.9" patternUnits="userSpaceOnUse">
      <rect width="0.9" height="0.9" fill="#ead9b4"/>
      <g fill="#c9a874" stroke="#8a5a2a" stroke-width="0.012">
        <ellipse cx="0.45" cy="0.2" rx="0.1" ry="0.17"/><ellipse cx="0.45" cy="0.7" rx="0.1" ry="0.17"/>
        <ellipse cx="0.2" cy="0.45" rx="0.17" ry="0.1"/><ellipse cx="0.7" cy="0.45" rx="0.17" ry="0.1"/>
      </g>
      <circle cx="0.45" cy="0.45" r="0.03" fill="#8a5a2a"/>
      <g fill="#d8c094"><circle cx="0" cy="0" r="0.05"/><circle cx="0.9" cy="0" r="0.05"/><circle cx="0" cy="0.9" r="0.05"/><circle cx="0.9" cy="0.9" r="0.05"/></g>
    </pattern>
    <pattern id="sk-parang" width="0.5" height="0.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="0.5" height="0.5" fill="#5a2e12"/>
      <path d="M0 0.12Q0.125 0 0.25 0.12T0.5 0.12V0.3Q0.375 0.42 0.25 0.3T0 0.3Z" fill="#e2cfa4"/>
      <circle cx="0.25" cy="0.41" r="0.035" fill="#e2cfa4"/>
    </pattern>
    <filter id="sk-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.25 3.5" numOctaves="2" seed="9" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.16  0 0 0 0 0.07  0 0 0 0 0.01  0 0 0 0.5 -0.1" result="g"/>
      <feComposite in="g" in2="SourceGraphic" operator="in" result="t"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge>
    </filter>
    <filter id="sk-cloth" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="4" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.3  0 0 0 0 0.2  0 0 0 0 0.1  0 0 0 0.35 -0.08" result="g"/>
      <feComposite in="g" in2="SourceGraphic" operator="in" result="t"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge>
    </filter>
  </defs>`;
}

/** Прямые линии сетки. */
function grid(): string {
  let d = '';
  for (let i = 0; i < N; i++) d += `M${M} ${M + i}H${M + N - 1}M${M + i} ${M}V${M + N - 1}`;
  return d;
}

/** Цветок-розетка в углах резной доски. */
function rosette(x: number, y: number, r: number, fill: string): string {
  let o = '';
  for (let i = 0; i < 8; i++) o += `<ellipse cx="${x}" cy="${y - r * 0.55}" rx="${r * 0.2}" ry="${r * 0.45}" transform="rotate(${i * 45} ${x} ${y})" fill="${fill}"/>`;
  return o + `<circle cx="${x}" cy="${y}" r="${r * 0.18}" fill="#2a1406"/>`;
}

function board(s: State): string {
  const W = SIZE;
  let o = defs();
  const G = grid();
  const small = circuitPath(0);
  const big = circuitPath(1);
  if (s.cfg.look === 'wood') {
    o += `<rect x="0" y="0" width="${W}" height="${W}" rx="0.35" fill="url(#sk-frame)"/>`;
    o += `<rect x="0.14" y="0.14" width="${W - 0.28}" height="${W - 0.28}" rx="0.28" fill="url(#sk-teak)" filter="url(#sk-grain)"/>`;
    o += `<rect x="0.3" y="0.3" width="${W - 0.6}" height="${W - 0.6}" rx="0.22" fill="none" stroke="#3c1e08" stroke-width="0.035"/>`;
    // резные розетки в углах (вне петель)
    for (const [x, y] of [
      [0.75, 0.75],
      [W - 0.75, 0.75],
      [0.75, W - 0.75],
      [W - 0.75, W - 0.75],
    ])
      o += rosette(x, y, 0.42, '#5a2e10');
    // жёлоба сетки
    o += `<path d="${G}" fill="none" stroke="#e0a868" stroke-width="0.06" transform="translate(0.016 0.02)" opacity="0.45"/>`;
    o += `<path d="${G}" fill="none" stroke="#3c1e08" stroke-width="0.05"/>`;
    // инкрустация: большой круг — зелёный камень, малый — латунь
    for (const [d, f] of [
      [big, 'url(#sk-jade)'],
      [small, 'url(#sk-brass)'],
    ]) {
      o += `<path d="${d}" fill="none" stroke="#2a1406" stroke-width="0.15" stroke-linejoin="round"/>`;
      o += `<path d="${d}" fill="none" stroke="${f}" stroke-width="0.09" stroke-linejoin="round"/>`;
    }
    for (let p = 0; p < N * N; p++) o += `<circle cx="${X(p)}" cy="${Y(p)}" r="0.1" fill="#2a1406" stroke="#e0a868" stroke-opacity="0.5" stroke-width="0.02"/>`;
  } else {
    o += `<rect x="0" y="0" width="${W}" height="${W}" fill="url(#sk-parang)" filter="url(#sk-cloth)"/>`;
    o += `<rect x="0.45" y="0.45" width="${W - 0.9}" height="${W - 0.9}" fill="url(#sk-kawung)" stroke="#3a1c0a" stroke-width="0.06" filter="url(#sk-cloth)"/>`;
    o += `<rect x="0.45" y="0.45" width="${W - 0.9}" height="${W - 0.9}" fill="#f2e6c8" opacity="0.45"/>`;
    o += `<path d="${G}" fill="none" stroke="#3a1c0a" stroke-width="0.05"/>`;
    o += `<path d="${big}" fill="none" stroke="#9a3e14" stroke-width="0.11" stroke-linejoin="round"/>`;
    o += `<path d="${small}" fill="none" stroke="#24387a" stroke-width="0.11" stroke-linejoin="round"/>`;
    for (let p = 0; p < N * N; p++) o += `<circle cx="${X(p)}" cy="${Y(p)}" r="0.09" fill="#3a1c0a"/>`;
  }
  return o;
}

const tilt = (p: number) => ((p * 53) % 80) - 40;

/** Семя саги: глянцевая алая «капля» с рубчиком. */
function saga(x: number, y: number, p: number, r = 0.31): string {
  return `<ellipse cx="${x + 0.04}" cy="${y + 0.06}" rx="${r * 1.05}" ry="${r * 0.92}" fill="url(#sk-sh)"/>
    <g transform="rotate(${tilt(p)} ${x} ${y})">
      <path d="M${x - r} ${y}C${x - r} ${y - r * 0.95} ${x + r * 0.7} ${y - r * 1.02} ${x + r} ${y - r * 0.15}C${x + r * 1.05} ${y + r * 0.8} ${x - r * 0.6} ${y + r * 0.98} ${x - r} ${y}Z"
        fill="url(#sk-saga)" stroke="#3a0402" stroke-width="0.02"/>
      <ellipse cx="${x + r * 0.78}" cy="${y - r * 0.1}" rx="${r * 0.12}" ry="${r * 0.06}" fill="#2a0402" opacity="0.8"/>
      <ellipse cx="${x - r * 0.3}" cy="${y - r * 0.42}" rx="${r * 0.3}" ry="${r * 0.13}" fill="#fff" opacity="0.65"/>
    </g>`;
}

/** Ракушка-улитка: завиток спиралью. */
function snail(x: number, y: number, p: number, r = 0.32): string {
  let d = '';
  let a = 0;
  for (let i = 0; i <= 40; i++) {
    const rr = r * 0.85 * (1 - i / 46);
    a = (i / 40) * Math.PI * 4.2;
    d += `${i ? 'L' : 'M'}${(x + rr * Math.cos(a)).toFixed(3)} ${(y + rr * Math.sin(a)).toFixed(3)}`;
  }
  return `<ellipse cx="${x + 0.04}" cy="${y + 0.06}" rx="${r * 1.02}" ry="${r * 0.98}" fill="url(#sk-sh)"/>
    <g transform="rotate(${tilt(p) * 3} ${x} ${y})">
      <circle cx="${x}" cy="${y}" r="${r}" fill="url(#sk-snail)" stroke="#8a7452" stroke-width="0.02"/>
      <path d="${d}" fill="none" stroke="#9a7a4e" stroke-width="0.03" stroke-linecap="round"/>
      <circle cx="${x}" cy="${y}" r="${r * 0.1}" fill="#c0a274"/>
    </g>
    <ellipse cx="${x - r * 0.35}" cy="${y - r * 0.45}" rx="${r * 0.26}" ry="${r * 0.12}" fill="#fff" opacity="0.7"/>`;
}

/** Монетка-кепенг с квадратной дыркой. */
function coin(x: number, y: number, p: number, red: boolean, r = 0.32): string {
  const g = red ? 'sk-copper' : 'sk-silver';
  const ink = red ? '#4a1604' : '#55575c';
  const q = r * 0.24;
  let marks = '';
  for (let i = 0; i < 4; i++) marks += `<rect x="${x - 0.025}" y="${y - r * 0.72}" width="0.05" height="${r * 0.22}" fill="${ink}" opacity="0.55" transform="rotate(${i * 90 + tilt(p) / 4} ${x} ${y})"/>`;
  return `<ellipse cx="${x + 0.04}" cy="${y + 0.06}" rx="${r * 1.04}" ry="${r * 1.0}" fill="url(#sk-sh)"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="url(#${g})" stroke="${ink}" stroke-width="0.025"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.86}" fill="none" stroke="${ink}" stroke-width="0.018" opacity="0.6"/>
    ${marks}
    <rect x="${x - q}" y="${y - q}" width="${2 * q}" height="${2 * q}" fill="#3a1c0a" stroke="${ink}" stroke-width="0.02" transform="rotate(${tilt(p) / 4} ${x} ${y})"/>
    <ellipse cx="${x - r * 0.38}" cy="${y - r * 0.45}" rx="${r * 0.25}" ry="${r * 0.1}" fill="#fff" opacity="0.5"/>`;
}

function piece(s: State, kind: string, x: number, y: number, p: number): string {
  const red = kind === 'r';
  if (s.cfg.look === 'batik') return coin(x, y, p, red);
  return red ? saga(x, y, p) : snail(x, y, p);
}

const kindOf = (v: number) => (v === RED ? 'r' : 'w');

class SurakartaView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private s: State | null = null;
  /** Летящая по кругу фишка: вид, путь, текущая точка. */
  private fly: { kind: string; path: [number, number][]; x: number; y: number } | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="sk-info"></div>`);
    ctx.controls.appendChild(this.info);
    if (!ctx.demo)
      ctx.controls.appendChild(
        h(`<div class="sk-hint">Нажмите на свою фишку и на точку рядом, куда шагнуть. Чужие фишки, которые можно взять проездом через петлю, подсвечены красным — наведите, чтобы увидеть путь. Брать не обязательно.</div>`)
      );
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: () => N * N,
        size: () => [SIZE, SIZE],
        xy: (_s, p) => [X(p), Y(p)],
        board,
        pieces: (s) => s.board.flatMap((v, p) => (v ? [{ p, kind: kindOf(v) }] : [])),
        piece,
        legal: (s, seat) => (s.turn === seat && !s.over && !this.fly ? legalOf(s) : []),
        spot: (a) => ({ from: a.from, to: a.to }),
        hit: 0.45,
        ring: 0.4,
      },
      'sk-wrap'
    );
    this.pb.extra = (s) => this.marks(s);
  }

  /** Путь взятия под мышью и летящая фишка. */
  private marks(s: State): string {
    let o = '';
    const from = this.pb.selected;
    const to = this.pb.hovered;
    if (!this.fly && from >= 0 && to >= 0 && s.board[to] && s.board[to] !== s.board[from]) {
      const t = takesFrom(s.board, from).get(to);
      if (t && s.turn === (s.board[from] === RED ? 0 : 1)) o += `<polyline points="${pts(trackPoints(t))}" class="sk-path"/>`;
    }
    if (this.fly) {
      const f = this.fly;
      o += `<polyline points="${pts(f.path)}" class="sk-trail"/>`;
      const [x0, y0] = f.path[0];
      o += `<g class="sk-fly" transform="translate(${f.x - x0} ${f.y - y0})">${piece(s, f.kind, x0, y0, 0)}</g>`;
    }
    return o;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    let t = `<div>На доске: красных <b>${count(s, 0)}</b> · белых <b>${count(s, 1)}</b></div>`;
    if (s.cfg.games > 1) t += `<div>Партия <b>${Math.min(s.game + 1, s.cfg.games)}</b> из ${s.cfg.games} · счёт <b>${s.score[0]} : ${s.score[1]}</b></div>`;
    if (s.quiet >= 40 && !s.over) t += `<small>Без взятий ${s.quiet} полуходов из 80 — потом счёт по фишкам</small>`;
    this.info.innerHTML = t;
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  /** Проезд фишки по пути взятия. */
  private async ride(base: State, kind: string, t: Track) {
    const path = trackPoints(t);
    let len = 0;
    const seg: number[] = [0];
    for (let i = 1; i < path.length; i++) seg.push((len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])));
    const dur = Math.min(1900, 260 + len * 95) / this.ctx.speed();
    this.fly = { kind, path, x: path[0][0], y: path[0][1] };
    this.pb.set(base);
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const frame = () => {
        const k = Math.min(1, (performance.now() - t0) / dur);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const d = e * len;
        let i = 1;
        while (i < seg.length - 1 && seg[i] < d) i++;
        const u = seg[i] > seg[i - 1] ? (d - seg[i - 1]) / (seg[i] - seg[i - 1]) : 1;
        const f = this.fly!;
        f.x = path[i - 1][0] + (path[i][0] - path[i - 1][0]) * Math.min(1, u);
        f.y = path[i - 1][1] + (path[i][1] - path[i - 1][1]) * Math.min(1, u);
        const g = this.pb.svg.querySelector('.sk-fly');
        if (g) g.setAttribute('transform', `translate(${f.x - path[0][0]} ${f.y - path[0][1]})`);
        if (k < 1) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
    this.fly = null;
  }

  async play(events: Event[], v: State) {
    // доска по ходу событий (в серии после взятия последней фишки v — уже новая партия)
    let cur: State = this.s ? { ...this.s } : v;
    for (const ev of events) {
      if (ev.type === 'step' || ev.type === 'take') {
        const board = cur.board.slice();
        const kind = kindOf(board[ev.from]);
        const enemy = board[ev.to];
        board[ev.to] = board[ev.from];
        board[ev.from] = 0;
        const after: State = { ...cur, board, last: [ev.from, ev.to] };
        if (ev.type === 'take') {
          const base = cur.board.slice();
          base[ev.from] = 0;
          Sound.step();
          await this.ride({ ...cur, board: base, last: [ev.from] }, kind, ev.track);
          this.pb.show(after, null, [{ p: ev.to, kind: kindOf(enemy) }]);
          this.pb.mark([ev.from, ev.to]);
          Sound.capture();
          await sleep(380 / this.ctx.speed());
        } else {
          this.pb.show(after, { from: ev.from, to: ev.to, kind });
          Sound.step();
          await sleep(340 / this.ctx.speed());
        }
        cur = after;
      } else if (ev.type === 'round') {
        Sound.win();
        await sleep(1100 / this.ctx.speed());
        cur = v;
        this.pb.mark([]);
      } else if (ev.type === 'end') Sound.win();
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
    if (v.over) return v.winner == null ? 'Ничья' : `Победа: ${this.ctx.name(v.winner)}`;
    if (!interactive.includes(toAct[0])) return `Ходят ${this.ctx.name(toAct[0])}…`;
    const take = legalOf(v).some((a) => v.board[a.to]);
    return take ? 'Ваш ход — есть взятие' : 'Ваш ход';
  }
}

export function createView(): GameView<State, Event> {
  return new SurakartaView();
}

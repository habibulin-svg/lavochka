/* «Поединок» — отрисовка кодом по фото настоящей игры («Электромера»; разрешение пользователя — оригинальной графики нет,
 * только фото и 3D-рендеры): чёрная пластиковая рамка, жёлтое поле 9×8 с тиснёными кругами, по краям прозрачные тубы
 * для взятых кубиков. Кубики — вид сверху: верхняя грань и полоска ближней к игроку грани. Король — «крест с большой точкой».
 * Ход: касание кубика, затем клетки; путь подсвечивается. Если к клетке ведут два пути с разными гранями сверху, — кнопки. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { col, COLS, legal, N, PALACE, QUIET, roll, routes, row, ROWS, type Action, type Die, type Dir, type Event, type Route, type State } from './engine';
import './poedinok.css';

const CELL = 100;
const MX = 50;
const TUBE = 120;
const W = COLS * CELL + MX * 2;
const H = ROWS * CELL + TUBE * 2 + 40;
const FY = TUBE + 20;

type Move = Extract<Action, { type: 'move' }>;
type Pick = { type: 'pick'; from: number; to: number } | { type: 'cancel' };
type UiAction = Action | Pick;

/** Точки грани n в квадрате со стороной 1 (центр 0,0). */
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-0.25, -0.25],
    [0.25, 0.25],
  ],
  3: [
    [-0.27, -0.27],
    [0, 0],
    [0.27, 0.27],
  ],
  4: [
    [-0.25, -0.25],
    [0.25, -0.25],
    [-0.25, 0.25],
    [0.25, 0.25],
  ],
  5: [
    [-0.27, -0.27],
    [0.27, -0.27],
    [0, 0],
    [-0.27, 0.27],
    [0.27, 0.27],
  ],
  6: [
    [-0.25, -0.28],
    [0.25, -0.28],
    [-0.25, 0],
    [0.25, 0],
    [-0.25, 0.28],
    [0.25, 0.28],
  ],
};

function pips(n: number, cx: number, cy: number, sx: number, sy: number, r: number, fill: string): string {
  return PIPS[n].map(([x, y]) => `<ellipse cx="${(cx + x * sx).toFixed(1)}" cy="${(cy + y * sy).toFixed(1)}" rx="${r}" ry="${((r * sy) / sx).toFixed(1)}" fill="${fill}"/>`).join('');
}

/** «Крест с большой точкой» — грань короля. */
function cross(cx: number, cy: number, sx: number, sy: number, fill: string): string {
  const k = sy / sx;
  const sm = sx * 0.055;
  const o = sx * 0.27;
  return `<ellipse cx="${cx}" cy="${cy}" rx="${sx * 0.1}" ry="${sx * 0.1 * k}" fill="${fill}"/>
    <ellipse cx="${cx}" cy="${cy - o * k}" rx="${sm}" ry="${sm * k}" fill="${fill}"/><ellipse cx="${cx}" cy="${cy + o * k}" rx="${sm}" ry="${sm * k}" fill="${fill}"/>
    <ellipse cx="${cx - o}" cy="${cy}" rx="${sm}" ry="${sm * k}" fill="${fill}"/><ellipse cx="${cx + o}" cy="${cy}" rx="${sm}" ry="${sm * k}" fill="${fill}"/>`;
}

/** Кубик: kind = «место:король:верх:ближняя грань». */
function die(kind: string, x: number, y: number, scale = 1): string {
  const [o, k, t, f] = kind.split(':');
  const white = o === '0';
  const king = k === '1';
  const body = white ? '#f3efe2' : '#1c1c1e';
  const side = white ? '#cfc8b4' : '#0b0b0c';
  const ink = white ? '#141414' : '#f4f4f0';
  const edge = white ? '#9c9480' : '#000';
  const S = 82 * scale;
  const hs = S / 2;
  const fh = 15 * scale;
  const top = y - hs - fh / 2 + 4 * scale;
  const face = king ? cross(x, top + hs, S, S, ink) : pips(Number(t), x, top + hs, S, S, S * 0.075, ink);
  const front = king ? cross(x, top + S + fh / 2, S * 0.9, fh * 0.9, ink) : pips(Number(f), x, top + S + fh / 2, S * 0.9, fh * 0.9, S * 0.06, ink);
  return `<g>
    <rect x="${x - hs + 5 * scale}" y="${top + 10 * scale}" width="${S}" height="${S + fh}" rx="${8 * scale}" fill="#000" opacity="0.35" filter="url(#pd-sh)"/>
    <rect x="${x - hs}" y="${top + S - 6 * scale}" width="${S}" height="${fh + 6 * scale}" rx="${5 * scale}" fill="${side}" stroke="${edge}" stroke-width="1.2"/>
    ${front}
    <rect x="${x - hs}" y="${top}" width="${S}" height="${S}" rx="${8 * scale}" fill="${body}" stroke="${edge}" stroke-width="1.4"/>
    <rect x="${x - hs + 4 * scale}" y="${top + 3 * scale}" width="${S - 8 * scale}" height="${S * 0.35}" rx="${6 * scale}" fill="#fff" opacity="${white ? 0.35 : 0.08}"/>
    ${face}
  </g>`;
}

const ARROW: Record<Dir, string> = { n: '↑', s: '↓', e: '→', w: '←' };
const FLIPDIR: Record<Dir, Dir> = { n: 's', s: 'n', e: 'w', w: 'e' };
const BACK = FLIPDIR;
function stepDir(a: number, b: number): Dir {
  if (b === a - COLS) return 'n';
  if (b === a + COLS) return 's';
  return b === a + 1 ? 'e' : 'w';
}

class PoedinokView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, UiAction>;
  private info!: HTMLElement;
  private hint!: HTMLElement;
  private s: State | null = null;
  private flip = false;
  private seat: number | null = null;
  /** Выбор пути к клетке, куда ведут разные пути. */
  private pending: { from: number; to: number; opts: Route[] } | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.flip = !ctx.demo && ctx.mySeats.length === 1 && ctx.mySeats[0] === 1;
    this.info = h(`<div class="pd-info"></div>`);
    ctx.controls.appendChild(this.info);
    this.hint = h(`<div class="pd-hint"></div>`);
    if (!ctx.demo) ctx.controls.appendChild(this.hint);
    const inner: ViewCtx = { ...ctx, act: (seat, a) => this.act(seat, a as UiAction) };
    this.pb = new PointBoard<State, UiAction>(
      root,
      inner,
      {
        count: () => N,
        size: () => [W, H],
        xy: (_s, p) => this.xy(p),
        board: (s) => this.board(s),
        pieces: (s) => {
          const out: { p: number; kind: string }[] = [];
          s.cells.forEach((d, p) => {
            if (d) out.push({ p, kind: `${d.owner}:${d.king ? 1 : 0}:${d.t}:${this.flip ? d.n : 7 - d.n}` });
          });
          return out;
        },
        piece: (_s, kind, x, y) => die(kind, x, y),
        legal: (s, seat) => this.legal(s, seat),
        spot: (a) => (a.type === 'move' ? (this.pending ? null : { from: a.from, to: this.target(a) }) : a.type === 'pick' ? { from: a.from, to: a.to } : null),
        label: (a) => this.label(a),
        hit: 50,
        ring: 50,
      },
      'pd'
    );
    this.pb.extra = (s) => this.preview(s);
  }

  private xy(p: number): [number, number] {
    let c = col(p);
    let r = row(p);
    if (this.flip) {
      c = COLS - 1 - c;
      r = ROWS - 1 - r;
    }
    return [MX + CELL * (c + 0.5), FY + CELL * (r + 0.5)];
  }

  private target(a: Move): number {
    const s = this.s;
    if (!s) return -1;
    return routes(s, a.from).find((r) => r.a.d1 === a.d1 && r.a.k === a.k && r.a.d2 === a.d2)?.to ?? -1;
  }

  private legal(s: State, seat: number): UiAction[] {
    if (this.pending) return [...this.pending.opts.map((r) => r.a), { type: 'cancel' }];
    const acts = legal(s, seat);
    if (acts.length === 1 && acts[0].type === 'pass') return acts;
    const out: UiAction[] = [];
    const seen = new Set<string>();
    for (let p = 0; p < N; p++) {
      const d = s.cells[p];
      if (!d || d.owner !== seat) continue;
      const rs = routes(s, p);
      for (const r of rs) {
        const key = `${p}-${r.to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const group = rs.filter((x) => x.to === r.to);
        const kinds = new Set(group.map((x) => `${x.die.t}:${x.die.n}:${x.die.e}`));
        out.push(kinds.size > 1 ? { type: 'pick', from: p, to: r.to } : r.a);
      }
    }
    return out;
  }

  private label(a: UiAction): string {
    if (a.type === 'pass') return 'Ходов нет — пропустить';
    if (a.type === 'cancel') return 'Отмена';
    if (a.type === 'move') {
      const d = (x: Dir) => ARROW[this.flip ? FLIPDIR[x] : x];
      const r = this.pending?.opts.find((o) => o.a === a);
      const top = r ? (r.die.king ? '' : ` — сверху станет ${r.die.t}`) : '';
      return a.d2 ? `${d(a.d1)} ${a.k}, затем ${d(a.d2)}${top}` : `${d(a.d1)} прямо${top}`;
    }
    return '…';
  }

  private act(seat: number, a: UiAction) {
    if (a.type === 'pick') {
      const s = this.s!;
      this.pending = { from: a.from, to: a.to, opts: routes(s, a.from).filter((r) => r.to === a.to) };
      Sound.ui();
      this.pb.turn(seat);
      this.text();
      return;
    }
    if (a.type === 'cancel') {
      this.pending = null;
      this.pb.turn(seat);
      this.text();
      return;
    }
    this.pending = null;
    this.ctx.act(seat, a);
  }

  /** Путь к клетке под мышью (или варианты при выборе). */
  private preview(s: State): string {
    let paths: number[][] = [];
    if (this.pending) paths = this.pending.opts.map((r) => r.path);
    else {
      const from = this.pb.selected;
      const to = this.pb.hovered;
      if (from >= 0 && to >= 0 && this.seat != null) paths = routes(s, from).filter((r) => r.to === to).map((r) => r.path);
      else if (s.path.length > 1) return `<polyline points="${s.path.map((p) => this.xy(p).join(',')).join(' ')}" class="pd-last"/>`;
    }
    return paths.map((p, i) => `<polyline points="${p.map((q) => this.xy(q).join(',')).join(' ')}" class="pd-path pd-path${i}"/>`).join('');
  }

  private board(s: State): string {
    let o = `<defs>
      <filter id="pd-sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>
      <linearGradient id="pd-frame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a3c"/><stop offset="0.5" stop-color="#202022"/><stop offset="1" stop-color="#151516"/></linearGradient>
      <linearGradient id="pd-tube" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="0.25" stop-color="#fff" stop-opacity="0.08"/><stop offset="0.7" stop-color="#fff" stop-opacity="0.04"/><stop offset="0.9" stop-color="#fff" stop-opacity="0.3"/><stop offset="1" stop-color="#fff" stop-opacity="0.1"/></linearGradient>
      <linearGradient id="pd-cell" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2c23a"/><stop offset="1" stop-color="#d79a12"/></linearGradient>
    </defs>
    <rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="34" fill="url(#pd-frame)" stroke="#000" stroke-width="3"/>`;
    // тубы для взятых кубиков: у каждого — свои трофеи (у верхней кромки — у того, кто сидит сверху)
    const tubes = [
      [TUBE / 2 + 6, this.flip ? 0 : 1],
      [H - TUBE / 2 - 6, this.flip ? 1 : 0],
    ] as const;
    for (const [cy, seat] of tubes) {
      o += `<rect x="${MX - 10}" y="${cy - 42}" width="${W - 2 * MX + 20}" height="84" rx="40" fill="#0d0d0e" stroke="#555" stroke-width="2"/>`;
      // трофеи места seat — взятые у соперника кубики
      const n = s.lost[1 - seat];
      for (let i = 0; i < n; i++) o += die(`${1 - seat}:0:${(i % 6) + 1}:${((i + 2) % 6) + 1}`, MX + 50 + i * 74, cy + 6, 0.72);
      o += `<rect x="${MX - 10}" y="${cy - 42}" width="${W - 2 * MX + 20}" height="84" rx="40" fill="url(#pd-tube)" stroke="#9aa" stroke-opacity="0.5" stroke-width="2"/>`;
    }
    o += `<rect x="${MX - 12}" y="${FY - 12}" width="${COLS * CELL + 24}" height="${ROWS * CELL + 24}" rx="10" fill="#c38a10" stroke="#5a3e04" stroke-width="3"/>`;
    for (let p = 0; p < N; p++) {
      const [x, y] = this.xy(p);
      const palace = !s.cfg.noPalace && (p === PALACE[0] || p === PALACE[1]);
      o += `<rect x="${x - 46}" y="${y - 46}" width="92" height="92" rx="5" fill="url(#pd-cell)" stroke="#a87408" stroke-width="2"/>
        <rect x="${x - 43}" y="${y - 43}" width="86" height="86" rx="4" fill="none" stroke="#ffe080" stroke-opacity="0.55" stroke-width="2"/>
        <circle cx="${x}" cy="${y}" r="27" fill="none" stroke="#b77e0a" stroke-width="2.5"/><circle cx="${x + 1}" cy="${y + 1.5}" r="27" fill="none" stroke="#ffd65a" stroke-opacity="0.6" stroke-width="1.5"/>`;
      if (palace) o += `<g class="pd-palace">${cross(x, y, 60, 60, '#9a6a06')}<circle cx="${x}" cy="${y}" r="38" fill="none" stroke="#9a6a06" stroke-width="3" stroke-dasharray="6 5"/></g>`;
    }
    return o;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const st = (seat: number) => 9 - s.lost[seat];
    this.info.innerHTML = `<div>${this.ctx.name(0)}: <b>${st(0)}</b> кубиков · ${this.ctx.name(1)}: <b>${st(1)}</b></div>
      <small>Без взятий: ${s.quiet} из ${QUIET} полуходов (потом — ничья)</small>`;
    this.hint.textContent = this.pending
      ? 'К этой клетке ведут два пути — сверху окажутся разные грани. Выберите путь кнопкой.'
      : 'Нажмите на свой кубик, потом на клетку: он перекатится ровно на столько клеток, сколько точек сверху, — по прямой или с одним поворотом. Король — на одну клетку.';
  }

  setView(v: State) {
    this.s = v;
    this.pending = null;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'move') {
        // перекат по шагам: кубик проходит путь клетка за клеткой
        const d = v.cells[ev.to];
        if (d) {
          // грани на каждом шаге: от конечного положения откатываем назад
          const dirs = ev.path.slice(1).map((q, i) => stepDir(ev.path[i], q));
          const at: Die[] = [d];
          for (let i = dirs.length - 1; i > 0; i--) at.unshift(d.king ? d : roll(at[0], BACK[dirs[i]]));
          for (let i = 1; i < ev.path.length; i++) {
            const di = at[i - 1];
            const kind = `${di.owner}:${di.king ? 1 : 0}:${di.t}:${this.flip ? di.n : 7 - di.n}`;
            const tmp: State = { ...v, cells: [...v.cells] };
            tmp.cells[ev.to] = null;
            if (ev.took && i < ev.path.length - 1) tmp.cells[ev.to] = ev.took;
            tmp.cells[ev.path[i]] = di;
            this.s = tmp;
            const taken = ev.took && i === ev.path.length - 1 ? [{ p: ev.to, kind: `${ev.took.owner}:${ev.took.king ? 1 : 0}:${ev.took.t}:${this.flip ? ev.took.n : 7 - ev.took.n}` }] : [];
            this.pb.show(tmp, { from: ev.path[i - 1], to: ev.path[i], kind }, taken);
            Sound.step();
            await sleep(170 / this.ctx.speed());
          }
          if (ev.took) Sound.capture();
        }
      } else if (ev.type === 'pass') {
        Sound.nomove();
        await sleep(300 / this.ctx.speed());
      } else if (ev.type === 'end') {
        if (ev.winner == null) Sound.nomove();
        else Sound.win();
      }
    }
    this.s = v;
    this.pending = null;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.seat = s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    this.pb.turn(this.seat);
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) {
      if (v.winner == null) return 'Ничья';
      return `${v.winner === 0 ? 'Белые' : 'Чёрные'} победили: ${v.why === 'palace' ? 'король во дворце!' : 'король взят!'}`;
    }
    if (!interactive.some((x) => toAct.includes(x))) return `Ходят ${v.turn === 0 ? 'белые' : 'чёрные'}…`;
    return 'Ваш ход: кубик, потом клетка';
  }

  playerStats(v: State, seat: number) {
    return `${9 - v.lost[seat]} кубиков`;
  }
}

export function createView(): GameView<State, Event> {
  return new PoedinokView();
}

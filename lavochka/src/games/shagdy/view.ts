/* Шагды — отрисовка по коробке: чёрная пластмассовая доска 8×8 с лунками, на каждой клетке два номера (свой — внизу слева,
 * соперника — вверх ногами в правом верхнем углу), крепости — белая (своя у белых) и лососёвая (у красных). Фишки — штырьки
 * сверху: белые и красные. Над и под доской — запасы (по 10 лунок), справа — вспомогательные поля сочетаний: квадрат с
 * диагональю, большая цифра вверху справа, меньшая внизу слева; закрытое сочетание — со штырьком.
 * Единица — клетка доски. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { ALL, combos, fortOf, home, N, PIECES, POS, progress, RESERVE, stepMoves, type Action, type Event, type State } from './engine';
import './shagdy.css';

const BX = 0.5;
const BY = 1.35;
const AX = 9.3;
const CS = 0.5;
const GY = [6.0, 0.85]; // верх полей сочетаний: место 0 — нижнее, место 1 — верхнее
const W = AX + 8 * CS + 0.4;
const H = BY + 8 + 1.35;
const RES = [N * N, N * N + 1];
const comboPt = (seat: number, k: number) => N * N + 2 + seat * ALL.length + k;
const resY = (seat: number) => (seat === 0 ? BY + 8 + 0.68 : BY - 0.68);

function xy(p: number): [number, number] {
  if (p < N * N) return [BX + (p % N) + 0.5, BY + Math.floor(p / N) + 0.5];
  if (p < N * N + 2) return [BX + 0.75, resY(p - N * N)];
  const q = p - N * N - 2;
  const seat = Math.floor(q / ALL.length);
  const [a, b] = ALL[q % ALL.length];
  return [AX + a * CS + CS / 2, GY[seat] + (7 - b) * CS + CS / 2];
}

const label = (pos: number, slot: number) => `${pos}${slot === 1 ? '′' : slot === 2 ? '″' : ''}`;

function peg(seat: number, x: number, y: number, r = 0.33): string {
  const [base, top, edge] = seat === 0 ? ['#d9d2c2', '#fbf8ef', '#8f8778'] : ['#a8140e', '#ec3a2e', '#5a0806'];
  return `<circle cx="${x + 0.05}" cy="${y + 0.08}" r="${r * 1.05}" fill="#000" opacity="0.45"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${base}" stroke="${edge}" stroke-width="0.025"/>
    <ellipse cx="${x - r * 0.12}" cy="${y - r * 0.22}" rx="${r * 0.62}" ry="${r * 0.6}" fill="${top}" stroke="${edge}" stroke-width="0.02"/>
    <ellipse cx="${x - r * 0.28}" cy="${y - r * 0.4}" rx="${r * 0.2}" ry="${r * 0.12}" fill="#fff" opacity="${seat === 0 ? 0.7 : 0.35}"/>`;
}

function board(s: State): string {
  let o = `<rect x="0" y="0" width="${W}" height="${H}" rx="0.25" fill="#141416"/>`;
  o += `<rect x="0.12" y="0.12" width="${AX - 0.45}" height="${H - 0.24}" rx="0.18" fill="#1d1d20" stroke="#2c2c30" stroke-width="0.04"/>`;
  // клетки
  for (let cell = 0; cell < N * N; cell++) {
    const x = BX + (cell % N);
    const y = BY + Math.floor(cell / N);
    const f = fortOf(cell);
    const fill = f === 0 ? '#ece6d8' : f === 1 ? '#f0896a' : '#202023';
    o += `<rect x="${x + 0.03}" y="${y + 0.03}" width="0.94" height="0.94" rx="0.04" fill="${fill}" stroke="${f >= 0 ? 'rgba(0,0,0,0.25)' : '#0b0b0c'}" stroke-width="0.03"/>`;
    const p0 = POS[0][cell];
    const p1 = POS[1][cell];
    if (p0.pos < 0 && p1.pos < 0) continue;
    o += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.13" fill="#050505" opacity="${f >= 0 ? 0.55 : 0.9}"/>`;
    const ink = f >= 0 ? '#5a4a40' : '#8a8a90';
    if (p0.pos > 0) o += `<text x="${x + 0.1}" y="${y + 0.88}" class="sg-num" fill="${ink}">${label(p0.pos, p0.slot)}</text>`;
    if (p1.pos > 0) o += `<text x="${x + 0.9}" y="${y + 0.12}" class="sg-num" fill="${ink}" transform="rotate(180 ${x + 0.9} ${y + 0.12})">${label(p1.pos, p1.slot)}</text>`;
  }
  // запасы: по 10 лунок над и под доской
  for (const seat of [0, 1]) {
    const y = resY(seat);
    for (let i = 0; i < PIECES; i++) {
      const x = BX + 0.75 + i * 0.72;
      o += `<circle cx="${x}" cy="${y}" r="0.12" fill="#050505"/>`;
      if (i > 0 && i < s.reserve[seat]) o += peg(seat, x, y, 0.27);
    }
  }
  // поля сочетаний
  const avail = new Set(combos(s.cfg.variant).map(([a, b]) => `${a}/${b}`));
  for (const seat of [1, 0]) {
    const used = new Set(s.used[seat].map((i) => combos(s.cfg.variant)[i].join('/')));
    o += `<text x="${AX + 0.05}" y="${GY[seat] - 0.18}" class="sg-cap">${seat === 0 ? 'Белые' : 'Красные'}: ходов ${s.moves[seat]} из ${avail.size}</text>`;
    ALL.forEach(([a, b], k) => {
      const [cx, cy] = xy(comboPt(seat, k));
      const x = cx - CS / 2;
      const y = cy - CS / 2;
      const on = avail.has(`${a}/${b}`);
      o += `<g opacity="${on ? 1 : 0.28}"><rect x="${x + 0.02}" y="${y + 0.02}" width="${CS - 0.04}" height="${CS - 0.04}" fill="#26262a" stroke="#0a0a0b" stroke-width="0.02"/>
        <line x1="${x + 0.04}" y1="${y + 0.04}" x2="${x + CS - 0.04}" y2="${y + CS - 0.04}" stroke="#55555c" stroke-width="0.015"/>
        <text x="${x + CS - 0.06}" y="${y + 0.17}" class="sg-dig" text-anchor="end">${a}</text>
        <text x="${x + 0.06}" y="${y + CS - 0.05}" class="sg-dig">${b}</text></g>`;
      if (used.has(`${a}/${b}`)) o += peg(seat, cx, cy, 0.17);
    });
  }
  return o;
}

class ShagdyView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private s: State | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="sg-info"></div>`);
    ctx.controls.appendChild(this.info);
    if (!ctx.demo)
      ctx.controls.appendChild(
        h(`<div class="sg-hint">Выберите сочетание цифр на своём поле справа, затем делайте шаги: нажмите на фишку (или на запас) и на подсвеченную клетку.</div>`)
      );
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        size: () => [W, H],
        count: () => N * N + 2 + 2 * ALL.length,
        xy: (_s, p) => xy(p),
        board,
        pieces: (s) => {
          const out = s.board.flatMap((v, p) => (v ? [{ p, kind: String(v - 1) }] : []));
          for (const seat of [0, 1]) if (s.reserve[seat] > 0) out.push({ p: RES[seat], kind: String(seat) });
          return out;
        },
        piece: (_s, kind, x, y, p) => peg(Number(kind), x, y, p >= N * N ? 0.27 : 0.33),
        legal: (s, seat) => (s.turn === seat && !s.over ? (s.pick < 0 ? combosLegal(s) : stepMoves(s)) : []),
        // точки действий зависят от того, чей ход: сочетание — на его поле, ввод — из его запаса
        spot: (a) => {
          const s = this.s;
          const seat = s ? s.turn : 0;
          if (a.type === 'combo') {
            const [x, y] = combos(s!.cfg.variant)[a.i];
            return { to: comboPt(seat, ALL.findIndex(([p, q]) => p === x && q === y)) };
          }
          return { from: a.from === RESERVE ? RES[seat] : a.from, to: a.to };
        },
        hit: 0.48,
        ring: 0.4,
      },
      'sg-wrap'
    );
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const line = (seat: number) =>
      `<div>${seat === 0 ? 'Белые' : 'Красные'}: в запасе <b>${s.reserve[seat]}</b>, в крепости <b>${home(s, seat)}</b> из 10, продвижение <b>${progress(s, seat)}</b></div>`;
    let cur = '';
    if (!s.over && s.pick >= 0) {
      const [a, b] = combos(s.cfg.variant)[s.pick];
      cur = `<div class="sg-cur">Сочетание <b>${a}/${b}</b>, осталось шагов: <b>${s.left.join(', ')}</b></div>`;
    }
    this.info.innerHTML = line(0) + line(1) + cur;
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'combo') {
        this.s = v;
        this.pb.set(v);
        this.text();
        Sound.place();
        await sleep(320 / this.ctx.speed());
      } else if (ev.type === 'step') {
        const from = ev.from === RESERVE ? RES[ev.seat] : ev.from;
        this.pb.show(v, { from, to: ev.to, kind: String(ev.seat) }, ev.took >= 0 ? [{ p: ev.to, kind: String(1 - ev.seat) }] : []);
        if (ev.took >= 0) Sound.capture();
        else if (ev.enter) Sound.enter();
        else Sound.step();
        await sleep(380 / this.ctx.speed());
      } else if (ev.type === 'pass') {
        Sound.nomove();
        await sleep(300 / this.ctx.speed());
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
    this.text();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : `Победа: ${v.winner === 0 ? 'белые' : 'красные'}`;
    const who = toAct[0] === 0 ? 'белые' : 'красные';
    if (!interactive.includes(toAct[0])) return `Ходят ${who}…`;
    return v.pick < 0 ? 'Выберите сочетание цифр' : `Шаги: ${v.left.join(', ')}`;
  }
}

function combosLegal(s: State): Action[] {
  const used = new Set(s.used[s.turn]);
  return combos(s.cfg.variant).flatMap((_, i) => (used.has(i) ? [] : [{ type: 'combo', i } as Action]));
}

export function createView(): GameView<State, Event> {
  return new ShagdyView();
}

/* «В атаку!» — отрисовка. Поле — выпрямленное фото настоящего поля (public/vataku/board.webp, клетка 72 px, поля 52 px
 * с подписями А…Ф и 1…15). Фигуры — пластиковые солдатики сбоку, силуэты обведены по фото комплекта (красные и зелёные):
 * ракета на круглой подставке, самолёт на стойке, танк, пушка на колёсах, пехотинец с автоматом.
 * Расстановка — за «стенкой»: чужих фигур не видно; две свои мины — флажки в углу клетки, их можно переставить. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { col, deployCells, legal, N, RESERVE, row, SERIES, type Action, type Event, type Kind, type State } from './engine';
import './vataku.css';

const BASE = `${import.meta.env.BASE_URL}vataku/`;
const C = 72;
const M = 52;
const W = 20 * C + 2 * M;
const H = 15 * C + 2 * M;
const PLASTIC = [
  ['#ff6a50', '#d8281a', '#7a0c04'],
  ['#5cbc5a', '#2a7c2c', '#0e3e10'],
];

/** Силуэты (вид сбоку, смотрят вправо), в квадрате ±30. */
const SHAPE: Record<Kind, string> = {
  inf: `<ellipse cx="0" cy="26" rx="15" ry="5"/><circle cx="-1" cy="-22" r="6"/><path d="M-6,-18 h10 l3,10 l-2,14 l3,20 h-6 l-3,-16 l-3,16 h-6 l2,-20 l-2,-14 z"/><path d="M-4,-8 l20,-4 l1,3 l-20,5 z"/><path d="M-8,-26 h13 l-1,-4 h-11 z"/>`,
  tank: `<path d="M-28,8 h56 a8,8 0 0 1 0,16 h-56 a8,8 0 0 1 0,-16 z"/><path d="M-24,0 h48 l4,8 h-56 z"/><path d="M-12,-10 h18 l4,10 h-26 z"/><rect x="8" y="-8" width="24" height="4" rx="1.5"/>`,
  gun: `<circle cx="-4" cy="16" r="11"/><path d="M-28,24 l20,-12 l4,4 l-20,12 z"/><path d="M-10,0 l36,-16 l2,4 l-34,18 z"/><path d="M-14,-4 h12 v14 h-12 z"/>`,
  rocket: `<ellipse cx="0" cy="24" rx="17" ry="6"/><path d="M0,-30 c6,8 7,18 7,30 v16 h-14 v-16 c0,-12 1,-22 7,-30 z"/><path d="M-7,6 l-8,12 h8 z M7,6 l8,12 h-8 z"/>`,
  plane: `<ellipse cx="0" cy="24" rx="13" ry="5"/><rect x="-2" y="0" width="4" height="24"/><path d="M-28,-2 c10,-6 40,-8 56,-2 c-4,4 -40,6 -56,2 z"/><path d="M-4,-4 l-12,-12 h6 l14,10 z"/><path d="M-26,-4 l-4,-12 h5 l6,10 z"/>`,
};

class VatakuView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private hint!: HTMLElement;
  private root!: HTMLElement;
  private s: State | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = root;
    this.info = h(`<div class="va-info"></div>`);
    ctx.controls.appendChild(this.info);
    this.hint = h(`<div class="va-hint"></div>`);
    if (!ctx.demo) ctx.controls.appendChild(this.hint);
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: () => 2 * N,
        size: () => [W, H],
        xy: (_s, p) => this.xy(p),
        board: () => this.board(),
        pieces: (s) => {
          const out: { p: number; kind: string }[] = [];
          s.cells.forEach((c, p) => {
            if (c) out.push({ p, kind: `${c.side}${c.kind}:${c.face}` });
          });
          return out;
        },
        piece: (_s, kind, x, y) => this.figure(kind, x, y),
        legal: (s, seat) => this.legal(s, seat),
        spot: (a) =>
          a.type === 'move' || a.type === 'shoot' ? { from: a.from, to: a.to } : a.type === 'swap' ? { from: a.a, to: a.b } : a.type === 'mine' ? { from: N + a.from, to: N + a.to } : null,
        label: (a) => (a.type === 'ready' ? 'Убрать стенку — в бой!' : a.type === 'auto' ? 'Расставить заново' : '…'),
        hit: 30,
        ring: 30,
      },
      'va'
    );
    this.pb.extra = (s) => this.marks(s);
  }

  /** Точка p < N — центр клетки, N + p — угол клетки (место мины). */
  private xy(q: number): [number, number] {
    const p = q % N;
    const x = M + C * (col(p) + 0.5);
    const y = M + C * (row(p) + 0.5);
    return q >= N ? [x + 22, y + 22] : [x, y];
  }

  private board(): string {
    return `<defs><filter id="va-sh" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.5"/></filter>
      ${[0, 1].map((i) => `<linearGradient id="va-p${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${PLASTIC[i][0]}"/><stop offset="0.55" stop-color="${PLASTIC[i][1]}"/><stop offset="1" stop-color="${PLASTIC[i][2]}"/></linearGradient>`).join('')}
    </defs><image href="${BASE}board.webp" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`;
  }

  private figure(kind: string, x: number, y: number): string {
    const side = Number(kind[0]);
    const [k, f] = kind.slice(1).split(':') as [Kind, string];
    const flip = f === '-1' ? -1 : 1;
    return `<g transform="translate(${x} ${y - 4}) scale(${flip * 0.95} 0.95)">
      <g transform="translate(4 5)" fill="#000" opacity="0.35" filter="url(#va-sh)">${SHAPE[k]}</g>
      <g fill="url(#va-p${side})" stroke="${PLASTIC[side][2]}" stroke-width="1.2">${SHAPE[k]}</g>
    </g>`;
  }

  private legal(s: State, seat: number): Action[] {
    if (s.phase === 'deploy') {
      if (s.ready[seat]) return [];
      const cells = deployCells(seat);
      const out: Action[] = [];
      for (const a of cells) if (s.cells[a]?.side === seat) for (const b of cells) if (b !== a) out.push({ type: 'swap', a, b });
      for (const m of s.mines[seat]) for (const b of cells) if (!RESERVE.has(b) && !s.mines[seat].includes(b)) out.push({ type: 'mine', from: m, to: b });
      out.push({ type: 'auto' }, { type: 'ready' });
      return out;
    }
    return legal(s, seat);
  }

  /** Мины (свои — флажки), резерв, рамки — подсказки поверх поля. */
  private marks(s: State): string {
    let o = '';
    s.mines.forEach((ms, side) =>
      ms.forEach((p) => {
        const [x, y] = this.xy(N + p);
        o += `<g class="va-mine" transform="translate(${x} ${y})"><circle r="9" fill="#111" stroke="${PLASTIC[side][1]}" stroke-width="3"/><path d="M-4,-4 l8,8 M4,-4 l-8,8" stroke="#ffe066" stroke-width="2"/></g>`;
      })
    );
    return o;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    this.root.classList.toggle('va-deploy', s.phase === 'deploy');
    const n = (side: number) => s.cells.filter((c) => c && c.side === side).length;
    const inf = (side: number) => s.cells.filter((c) => c && c.side === side && c.kind === 'inf').length;
    const series = SERIES[s.series] ?? 3;
    this.info.innerHTML =
      s.phase === 'deploy'
        ? `<div>Расстановка за стенкой: ${s.ready[0] ? '✔' : '…'} ${this.ctx.name(0)} · ${s.ready[1] ? '✔' : '…'} ${this.ctx.name(1)}</div>`
        : `<div>${this.ctx.name(0)}: фигур <b>${n(0)}</b>, пехоты ${inf(0)}</div><div>${this.ctx.name(1)}: фигур <b>${n(1)}</b>, пехоты ${inf(1)}</div>
           <div>Серия: ход <b>${series - s.left + 1}</b> из ${series}</div><small>Победа — все 6 клеток рамки соперника, среди них трое пехотинцев.</small>`;
    this.hint.textContent =
      s.phase === 'deploy'
        ? 'Расставьте фигуры на своей половине: нажмите на фигуру, потом на клетку (свободную или с другой фигурой). Мины — чёрные кружки в углу клетки: их тоже можно переставить. Не на реку.'
        : 'Нажмите на фигуру и на клетку. Пушка стреляет по прямой на 3 клетки и остаётся на месте; ракета бьёт один раз.';
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'swap' || ev.type === 'layout') {
        this.s = v;
        this.pb.set(v);
        Sound.place();
      } else if (ev.type === 'start') {
        this.s = v;
        this.pb.set(v);
        Sound.turn();
        await sleep(300 / this.ctx.speed());
      } else if (ev.type === 'move') {
        const prev = this.s ?? v;
        const pc = prev.cells[ev.from];
        const kind = pc ? `${pc.side}${pc.kind}:${col(ev.to) > col(ev.from) ? 1 : col(ev.to) < col(ev.from) ? -1 : pc.face}` : '';
        const gone = [];
        if (ev.took) gone.push({ p: ev.to, kind: `${ev.took.side}${ev.took.kind}:${ev.took.face}` });
        const end = ev.path[ev.path.length - 1];
        if (ev.boom >= 0 || (ev.kind === 'rocket' && ev.took)) gone.push({ p: end, kind });
        this.s = v;
        this.pb.show(v, ev.boom >= 0 || (ev.kind === 'rocket' && ev.took) ? null : { from: ev.from, to: ev.to, kind }, gone);
        if (ev.boom >= 0) Sound.nomove();
        else if (ev.took) Sound.capture();
        else Sound.step();
        await sleep((ev.boom >= 0 ? 600 : 360) / this.ctx.speed());
      } else if (ev.type === 'shoot') {
        this.s = v;
        this.pb.show(v, null, [{ p: ev.to, kind: `${ev.took.side}${ev.took.kind}:${ev.took.face}` }]);
        Sound.capture();
        await sleep(420 / this.ctx.speed());
      } else if (ev.type === 'end') {
        if (ev.winner == null) Sound.nomove();
        else Sound.win();
      }
    }
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.pb.turn(s && s.phase !== 'over' && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null);
  }

  status(v: State, toAct: number[], interactive: number[]) {
    const names = ['красные', 'зелёные'];
    if (v.phase === 'over') {
      if (v.winner == null) return 'Ничья';
      return `Победили ${names[v.winner]}: ${v.why === 'frame' ? 'рамка занята!' : 'армия соперника разбита'}`;
    }
    const mine = interactive.some((x) => toAct.includes(x));
    if (v.phase === 'deploy') return mine ? 'Расставьте фигуры и мины, потом — «в бой»' : 'Соперник расставляется за стенкой…';
    if (!mine) return `Ходят ${names[v.side]}…`;
    const series = SERIES[v.series] ?? 3;
    return `Ваш ход: ${series - v.left + 1} из ${series}`;
  }

  playerStats(v: State, seat: number) {
    return `${v.cells.filter((c) => c && c.side === seat).length} фигур`;
  }
}

export function createView(): GameView<State, Event> {
  return new VatakuView();
}

/* Манкала — отрисовка: резная доска-картинка (tools/boards/mancala.py, геометрия — layout.ts), свой ряд снизу.
 * Камни — картинки с тенью: стеклянные шарики (калах), семена цезальпинии (оваре), окатыши-кумалаки (тогыз);
 * в лунке лежат россыпью в несколько слоёв, в казанах тогыза — рядами вдоль паза. Сверху — зоны касания и счётчики.
 * Ход — касание своей лунки; раскладка показывается по камню. Туздык — кольцо цвета хозяина.
 * Бао и катра — четыре ряда, свои два снизу; ход — лунка, затем соседняя лунка, куда сеять (направление). */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { isFour, legal, pitsPerRow, type Event, type State } from './engine';
import { fOwner, fPit } from './four';
import { SEATS } from './def';
import { BAO, KALAH, KATRA, TOGYZ, type BoardGeo, type Hole } from './layout';
import './mancala.css';

const TEX = `${import.meta.env.BASE_URL}tex/mancala/`;
const SPRITES: Record<string, string[]> = {
  kalah: Array.from({ length: 7 }, (_, i) => `marble${i}`),
  oware: Array.from({ length: 4 }, (_, i) => `seed${i}`),
  togyz: Array.from({ length: 6 }, (_, i) => `kum${i}`),
};
SPRITES.bao = SPRITES.katra = SPRITES.oware;
/** Больше этого камней в лунке не рисуем (дальше — только число). */
const MAX_PIT = 26;
const MAX_STORE = 96;

/** Россыпь в эллипсе: подсолнух по слоям, каждый следующий слой чуть сдвинут и ближе к центру. Координаты — доли полуосей. */
function spill(n: number, cap: number, seed: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / cap);
    const j = i % cap;
    const m = Math.min(cap, n - layer * cap);
    const r = (m === 1 ? 0.08 : 0.6 * Math.sqrt((j + 0.5) / m)) * (1 - 0.15 * Math.min(layer, 3));
    const a = j * 2.39996 + seed * 1.7 + layer * 0.95;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/** Два ровных столбика вдоль отсека (тогыз): шаг — диаметр шарика; не влезли — третий столбик посередине поверх. */
function columns(n: number, hole: Hole, d: number, aspect: number): [number, number][] {
  const ball = d * 0.68;
  const stepV = (ball * aspect) / hole.ry;
  const du = (ball * 0.55) / hole.rx;
  const rows = Math.max(1, Math.floor(1.7 / stepV));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / (rows * 2));
    const k = i % (rows * 2);
    const row = Math.floor(k / 2);
    const u = layer ? 0 : k % 2 ? du : -du;
    out.push([u, -0.85 + stepV * (row + 0.5) + (layer ? stepV * 0.5 : 0)]);
  }
  return out;
}

/** Ряды вдоль длинного паза (казан тогыза). */
function groove(n: number, hole: Hole, d: number, seed: number): [number, number][] {
  const len = (hole.rx - hole.ry * 0.4) * 2;
  const step = d * 0.78;
  const cols = Math.max(1, Math.floor(len / step));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / (cols * 2));
    const k = i % (cols * 2);
    const col = Math.floor(k / 2);
    const rowv = k % 2;
    const jit = Math.sin((i + seed) * 12.9898) * 0.08;
    const x = -len / 2 + step * (col + 0.5 + (layer % 2) * 0.5) + jit * d;
    out.push([x / hole.rx, (rowv ? 0.32 : -0.32) + jit + (layer ? -0.05 : 0)]);
  }
  return out;
}

class MancalaView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private board!: HTMLElement;
  private hint!: HTMLElement;
  private s: State | null = null;
  private actSeat: number | null = null;
  private me = 0;
  private hot = -1;
  private kind = '';
  /** Бао и катра: выбранная лунка, ждём направление. */
  private sel = -1;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h('<div class="mc-wrap"><div class="mc-board"></div></div>');
    root.appendChild(wrap);
    this.board = wrap.querySelector('.mc-board') as HTMLElement;
    this.hint = h('<div class="mc-hint"></div>');
    ctx.controls.appendChild(this.hint);
    this.board.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-pit]') as HTMLElement | null;
      const s = this.s;
      if (!el || !s || this.actSeat == null) return;
      const pit = Number(el.dataset.pit);
      const seat = this.actSeat;
      if (isFour(s.cfg.variant) && this.sel >= 0) {
        const d = neighbour(pitsPerRow(s.cfg), this.sel, pit);
        if (d) {
          e.preventDefault();
          e.stopPropagation();
          const from = this.sel;
          this.sel = -1;
          this.actSeat = null;
          Sound.unlock();
          this.ctx.act(seat, { type: 'sow', pit: from, dir: d });
          return;
        }
      }
      if (!legal(s, seat).includes(pit)) return;
      e.preventDefault();
      e.stopPropagation();
      if (isFour(s.cfg.variant)) {
        // сначала лунка, потом — куда сеять
        this.sel = this.sel === pit ? -1 : pit;
        Sound.unlock();
        this.draw();
        return;
      }
      this.actSeat = null;
      Sound.unlock();
      this.ctx.act(seat, { type: 'sow', pit });
    });
  }

  private geo(s: State): BoardGeo {
    const v = s.cfg.variant;
    return v === 'togyz' ? TOGYZ : v === 'katra' ? KATRA : isFour(v) ? BAO : KALAH;
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    const g = this.geo(s);
    const me = this.me;
    const N = pitsPerRow(s.cfg);
    if (this.kind !== s.cfg.variant) {
      this.kind = s.cfg.variant;
      this.board.style.setProperty('--img', `url("${TEX}${g.img}")`);
      this.board.style.aspectRatio = String(g.aspect);
      this.board.style.width = `min(100cqw, calc(100cqh * ${g.aspect.toFixed(3)}))`;
      this.board.classList.toggle('four', !!g.rows);
      this.board.dataset.kind = s.cfg.variant;
      for (const f of SPRITES[s.cfg.variant]) new Image().src = `${TEX}${f}.webp`;
    }
    // свой ряд снизу слева направо, чужой — сверху справа налево (по ходу раскладки против часовой)
    const mine = Array.from({ length: N }, (_, i) => me * N + i);
    const theirs = Array.from({ length: N }, (_, i) => (1 - me) * N + (N - 1 - i));
    const sprites = SPRITES[s.cfg.variant] ?? SPRITES.kalah;
    const d = g.stone * g.bottom[0].rx * 2; // камень — доля ширины доски
    const stones: string[] = [];
    const put = (hole: Hole, n: number, seed: number, long: boolean, max: number) => {
      const k = Math.min(n, max);
      const store = hole === g.mine || hole === g.theirs;
      const pts = long ? groove(k, hole, d, seed) : g.columns && !store ? columns(k, hole, d, g.aspect) : spill(k, store ? g.cap * 2 : g.cap, seed);
      pts.forEach(([u, v], i) => {
        const x = hole.x + u * hole.rx;
        const y = hole.y + v * hole.ry;
        const f = sprites[(i * 5 + seed * 3) % sprites.length];
        stones.push(`<i style="left:${(x * 100).toFixed(2)}%;top:${(y * 100).toFixed(2)}%;background-image:url('${TEX}${f}.webp')"></i>`);
      });
    };
    const ok = this.actSeat != null ? legal(s, this.actSeat) : [];
    const longStore = s.cfg.variant === 'togyz';
    let hits = '';
    const tuzOwner = (p: number) => (s.tuz?.[0] === p ? 0 : s.tuz?.[1] === p ? 1 : -1);
    const pitEl = (p: number, hole: Hole, up: boolean) => {
      put(hole, s.pits[p], p + 1, false, MAX_PIT);
      const t = tuzOwner(p);
      // туздык — белый шарик в лунке, как на турнирной доске
      if (t >= 0) stones.push(`<i style="left:${(hole.x * 100).toFixed(2)}%;top:${(hole.y * 100).toFixed(2)}%;background-image:url('${TEX}tuz.webp')"></i>`);
      const cls = `mc-hole${ok.includes(p) ? ' can' : ''}${p === this.hot ? ' hot' : ''}${s.last?.captured.includes(p) ? ' took' : ''}${t >= 0 ? ' tuz' : ''}`;
      hits += `<div class="${cls}" data-pit="${p}" style="${box(hole)}${t >= 0 ? `;--tc:${SEATS[t].color}` : ''}"><b class="${up ? 'up' : ''}">${t >= 0 ? 'туздык' : s.pits[p]}</b></div>`;
    };
    if (g.rows) {
      // четыре ряда: сверху внешний и внутренний соперника (его столбцы — справа налево), снизу свой внутренний и внешний
      const opp = 1 - me;
      const sel = this.actSeat != null ? this.sel : -1;
      const at = [
        (x: number) => fPit(N, opp, false, N - 1 - x),
        (x: number) => fPit(N, opp, true, N - 1 - x),
        (x: number) => fPit(N, me, true, x),
        (x: number) => fPit(N, me, false, x),
      ];
      // стрелка «куда сеять» — от выбранной лунки к соседней
      const where = new Map<number, [number, number]>();
      g.rows.forEach((rowHoles, r) => rowHoles.forEach((_, x) => where.set(at[r](x), [r, x])));
      const arrow = (p: number) => {
        const [r0, x0] = where.get(sel)!;
        const [r1, x1] = where.get(p)!;
        return x1 > x0 ? '→' : x1 < x0 ? '←' : r1 > r0 ? '↓' : '↑';
      };
      g.rows.forEach((rowHoles, r) =>
        rowHoles.forEach((hole, x) => {
          const p = at[r](x);
          put(hole, s.pits[p], p + 1, false, MAX_PIT);
          const can = ok.includes(p) && fOwner(N, p) === this.actSeat;
          const dir = sel >= 0 && neighbour(N, sel, p) !== 0;
          const cls = `mc-hole${can ? ' can' : ''}${p === sel ? ' sel' : ''}${dir ? ' dir' : ''}${p === this.hot ? ' hot' : ''}${s.last?.captured.includes(p) ? ' took' : ''}`;
          hits += `<div class="${cls}" data-pit="${p}"${dir ? ` data-arrow="${arrow(p)}"` : ''} style="${box(hole)}"><b>${s.pits[p]}</b></div>`;
        }),
      );
      this.board.style.setProperty('--d', `${(d * 100).toFixed(2)}%`);
      this.board.innerHTML = `<div class="mc-stones">${stones.join('')}</div>${hits}`;
      if (!this.ctx.demo)
        this.hint.textContent =
          this.actSeat != null
            ? sel >= 0
              ? 'Куда сеять: коснитесь соседней лунки со стрелкой (или другой своей лунки).'
              : 'Ваш ход: коснитесь своей лунки (два нижних ряда), затем соседней — куда сеять.'
            : s.over
              ? 'Партия окончена.'
              : '';
      return;
    }
    mine.forEach((p, i) => pitEl(p, g.bottom[i], false));
    theirs.forEach((p, i) => pitEl(p, g.top[i], true));
    const storeEl = (seat: number, hole: Hole, own: boolean) => {
      put(hole, s.store[seat], seat + 40, longStore, MAX_STORE);
      hits += `<div class="mc-store${longStore ? ' long' : ''}${own ? ' own' : ''}" style="${box(hole)};--c:${SEATS[seat].color}"><b>${s.store[seat]}</b><small>${esc2(this.ctx.name(seat))}</small></div>`;
    };
    storeEl(me, g.mine, true);
    storeEl(1 - me, g.theirs, false);
    this.board.style.setProperty('--d', `${(d * 100).toFixed(2)}%`);
    this.board.innerHTML = `<div class="mc-stones">${stones.join('')}</div>${hits}`;
    if (!this.ctx.demo) this.hint.textContent = this.actSeat != null ? 'Ваш ход: коснитесь своей лунки (нижний ряд).' : s.over ? 'Партия окончена.' : '';
  }

  setView(v: State) {
    this.s = v;
    this.draw();
  }

  async play(events: Event[], v: State) {
    const sp = this.ctx.speed();
    for (const ev of events) {
      if (ev.type !== 'sow' || !this.s) continue;
      // по камню: из лунки — по пути
      const cur: State = { ...this.s, pits: this.s.pits.slice(), store: [...this.s.store] as [number, number], last: null };
      cur.pits[ev.pit] = 0;
      this.s = cur;
      this.hot = ev.pit;
      this.draw();
      const lifts = ev.lifts ?? [];
      const four = isFour(cur.cfg.variant);
      for (let i = 0; i < ev.path.length; i++) {
        const q = ev.path[i];
        const up = lifts.find((l) => l.at === i);
        if (up) {
          // реле или взятие: лунку (и взятые лунки соперника) выгребают в руку
          await sleep(Math.max(60, 220 / sp));
          if (up.pits.length > 1) Sound.capture();
          for (const x of up.pits) cur.pits[x] = 0;
          this.hot = up.pits[0];
          this.draw();
        }
        await sleep(four ? Math.max(25, 110 / sp) : Math.max(40, 160 / sp));
        if (q === -1) cur.store[0]++;
        else if (q === -2) cur.store[1]++;
        else cur.pits[q]++;
        this.hot = q < 0 ? -1 : q;
        Sound.step();
        this.draw();
      }
      if (ev.captured.length && !lifts.length) {
        await sleep(300 / sp);
        Sound.capture();
      }
      this.hot = -1;
    }
    this.s = v;
    this.draw();
    if (v.over) Sound.win();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    const mine = this.ctx.mySeats.filter((x) => x === 0 || x === 1);
    const who = interactive.find((x) => toAct.includes(x));
    if (who != null) this.me = who;
    else if (mine.length === 1) this.me = mine[0];
    this.actSeat = s && !s.over && !this.ctx.demo ? (who ?? null) : null;
    if (this.actSeat == null) this.sel = -1;
    this.draw();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : 'Партия окончена';
    return interactive.includes(toAct[0]) ? 'Ваш ход' : `Ходит ${this.ctx.name(toAct[0])}…`;
  }

  playerStats(v: State, seat: number) {
    if (isFour(v.cfg.variant)) return `камней: ${v.store[seat]}`;
    return `${v.cfg.variant === 'kalah' ? 'в доме' : v.cfg.variant === 'togyz' ? 'в казане' : 'взято'}: ${v.store[seat]}`;
  }
}

/** Бао и катра: to — соседка from по кругу его половины? 1 — по ходу номеров (против часовой со своей стороны), -1 — назад. */
function neighbour(n: number, from: number, to: number): 1 | -1 | 0 {
  const base = from - (from % (2 * n));
  const nb = (d: number) => base + ((((from - base + d) % (2 * n)) + 2 * n) % (2 * n));
  return to === nb(1) ? 1 : to === nb(-1) ? -1 : 0;
}

/** Место лунки на доске (проценты). */
function box(o: Hole): string {
  return `left:${((o.x - o.rx) * 100).toFixed(2)}%;top:${((o.y - o.ry) * 100).toFixed(2)}%;width:${(o.rx * 200).toFixed(2)}%;height:${(o.ry * 200).toFixed(2)}%`;
}

const esc2 = (s: string) => s.replace(/<[^>]+>/g, '');

export function createView(): GameView<State, Event> {
  return new MancalaView();
}

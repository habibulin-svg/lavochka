/* «Воздушный бой» — отрисовка. Поле — сканы: «Игрушка» — три листа, сшитые в одно (public/vozboy/igrushka.webp),
 * «Аэрофото» — целиком (aerofoto.webp); узлы сетки — grid.ts. Самолёты — силуэты пластиковых фишек «Игрушки»
 * (обведены по фото, вид сверху): бомбардировщик — широкое стреловидное крыло с моторами, истребитель — узкий, со
 * стреловидным крылом. Ход: касание самолёта, затем метки у узлов — кружок со стороны, куда самолёт будет смотреть. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { DIRS, flights, mapOf, type Action, type Dir, type Event, type Flight, type Plane, type State } from './engine';
import { AEROFOTO, IGRUSHKA } from './grid';
import './vozboy.css';

const BASE = `${import.meta.env.BASE_URL}vozboy/`;
const ROT: Record<Dir, number> = { n: 0, e: 90, s: 180, w: 270 };
/** Цвета пластика: синие и красные (в «Аэрофото» вторая сторона — жёлтая, как точки на поле). */
const PLASTIC = {
  a: [
    ['#3f8fe8', '#1f5fc0', '#0d3a84'],
    ['#e83a2e', '#c01e14', '#7a0a04'],
  ],
  b: [
    ['#3f8fe8', '#1f5fc0', '#0d3a84'],
    ['#f2c430', '#d49a10', '#7a5404'],
  ],
};

/** Бомбардировщик, нос вверх, размах ≈ 1 (в единицах s). */
function bomber(s: number): string {
  const k = s / 100;
  return `<path transform="scale(${k})" d="M0,-50 C5,-48 6,-40 6,-30 L6,-8 L48,14 L48,22 L6,12 L6,30 L20,40 L20,46 L2,42 L0,48 L-2,42 L-20,46 L-20,40 L-6,30 L-6,12 L-48,22 L-48,14 L-6,-8 L-6,-30 C-6,-40 -5,-48 0,-50 Z"/>
    <g transform="scale(${k})"><rect x="16" y="2" width="5" height="16" rx="2"/><rect x="30" y="8" width="5" height="14" rx="2"/><rect x="-21" y="2" width="5" height="16" rx="2"/><rect x="-35" y="8" width="5" height="14" rx="2"/></g>`;
}
/** Истребитель: узкий фюзеляж, стреловидное крыло, стабилизаторы. */
function fighter(s: number): string {
  const k = s / 100;
  return `<path transform="scale(${k})" d="M0,-50 C3,-46 4,-36 4,-24 L4,-4 L34,18 L34,24 L4,16 L4,30 L16,40 L16,45 L2,42 L0,47 L-2,42 L-16,45 L-16,40 L-4,30 L-4,16 L-34,24 L-34,18 L-4,-4 L-4,-24 C-4,-36 -3,-46 0,-50 Z"/>`;
}

class VozboyView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private hint!: HTMLElement;
  private s: State | null = null;
  private fl: Flight[] = [];

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="vb-info"></div>`);
    ctx.controls.appendChild(this.info);
    this.hint = h(`<div class="vb-hint"></div>`);
    if (!ctx.demo) ctx.controls.appendChild(this.hint);
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: (s) => mapOf(s.cfg.ver).w * mapOf(s.cfg.ver).h * 5,
        size: (s) => {
          const g = s.cfg.ver === 'b' ? AEROFOTO : IGRUSHKA;
          return [g.w, g.h];
        },
        xy: (s, p) => this.xy(s, p),
        board: (s) => this.board(s),
        pieces: (s) => s.planes.map((pl) => ({ p: pl.p * 5, kind: this.kind(pl) })),
        piece: (s, kind, x, y) => this.plane(s, kind, x, y),
        legal: (s, seat) => {
          this.fl = flights(s, seat);
          return this.fl.map((f) => f.a);
        },
        spot: (a) => {
          const f = this.fl.find((x) => x.a === a);
          const pl = this.s?.planes.find((x) => x.id === a.id);
          if (!f || !pl) return null;
          return { from: pl.p * 5, to: f.end * 5 + 1 + DIRS.indexOf(f.dir) };
        },
        zoom: true,
        hit: 16,
        ring: 14,
      },
      'vb'
    );
    this.pb.extra = (s) => this.marks(s);
  }

  private step(s: State): number {
    const g = s.cfg.ver === 'b' ? AEROFOTO : IGRUSHKA;
    return g.xs[1] - g.xs[0];
  }

  /** Точка p·5 — узел, p·5+1…4 — метка курса у узла (север, восток, юг, запад). */
  private xy(s: State, q: number): [number, number] {
    const m = mapOf(s.cfg.ver);
    const g = s.cfg.ver === 'b' ? AEROFOTO : IGRUSHKA;
    const p = Math.floor(q / 5);
    const k = q % 5;
    const x = g.xs[p % m.w];
    const y = g.ys[Math.floor(p / m.w)];
    if (!k) return [x, y];
    const off = this.step(s) * 0.3;
    const [dx, dy] = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ][k - 1];
    return [x + dx * off, y + dy * off];
  }

  private kind(pl: Plane): string {
    return `${pl.side}${pl.kind}${pl.dir}${pl.up ? 1 : 0}`;
  }

  private board(s: State): string {
    const g = s.cfg.ver === 'b' ? AEROFOTO : IGRUSHKA;
    const img = s.cfg.ver === 'b' ? 'aerofoto.webp' : 'igrushka.webp';
    return `<defs><filter id="vb-sh" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter></defs>
      <image href="${BASE}${img}" x="0" y="0" width="${g.w}" height="${g.h}" preserveAspectRatio="none"/>`;
  }

  private plane(s: State, kind: string, x: number, y: number): string {
    const side = Number(kind[0]);
    const k = kind[1];
    const dir = kind[2] as Dir;
    const [hi, mid, dark] = PLASTIC[s.cfg.ver][side];
    const size = this.step(s) * (k === 'b' ? 0.95 : 0.78);
    const shape = k === 'b' ? bomber(size) : fighter(size);
    const id = `vb${side}`;
    return `<g transform="translate(${x} ${y}) rotate(${ROT[dir]})">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="0.6" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
      <g transform="translate(${size * 0.08} ${size * 0.1})" fill="#000" opacity="0.38" filter="url(#vb-sh)">${shape}</g>
      <g fill="url(#${id})" stroke="${dark}" stroke-width="${size / 80}" opacity="0.94">${shape}</g>
      <ellipse cx="${-size * 0.03}" cy="${-size * 0.22}" rx="${size * 0.025}" ry="${size * 0.16}" fill="#fff" opacity="0.45"/>
    </g>`;
  }

  /** Пока самолёт выбран — у меток курса стрелки, у опасных (зенитка) — крестик. */
  private marks(s: State): string {
    const sel = this.pb.selected;
    if (sel < 0 || sel % 5) return '';
    const pl = s.planes.find((x) => x.p * 5 === sel);
    if (!pl) return '';
    let o = '';
    for (const f of this.fl) {
      if (f.a.id !== pl.id) continue;
      const [x, y] = this.xy(s, f.end * 5 + 1 + DIRS.indexOf(f.dir));
      const r = this.step(s) * 0.11;
      if (f.shot >= 0) o += `<g class="vb-bad"><line x1="${x - r}" y1="${y - r}" x2="${x + r}" y2="${y + r}"/><line x1="${x - r}" y1="${y + r}" x2="${x + r}" y2="${y - r}"/></g>`;
      else o += `<path class="vb-arrow${f.took || f.hq ? ' vb-hit' : ''}" transform="translate(${x} ${y}) rotate(${ROT[f.dir]})" d="M0,${-r * 1.3} L${r},${r * 0.6} L0,${r * 0.1} L${-r},${r * 0.6} Z"/>`;
    }
    return o;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const n = (side: number, k: 'b' | 'f') => s.planes.filter((x) => x.side === side && x.kind === k).length;
    const goal = s.cfg.ver === 'a' ? 'Победа: штаб или все бомбардировщики и 8 истребителей' : 'Победа: бомбардировщик на штабе или все самолёты соперника';
    this.info.innerHTML = `<div>${this.ctx.name(0)}: ✈ бомб. <b>${n(0, 'b')}</b> · истр. <b>${n(0, 'f')}</b></div>
      <div>${this.ctx.name(1)}: ✈ бомб. <b>${n(1, 'b')}</b> · истр. <b>${n(1, 'f')}</b></div>
      <small>${goal}${s.cfg.ver === 'b' && s.moved.length ? ` · уже летал ${s.moved[0] === 'b' ? 'бомбардировщик' : 'истребитель'}` : ''}</small>`;
    this.hint.textContent =
      s.cfg.ver === 'a'
        ? 'Нажмите на самолёт, затем на стрелку у узла: куда он прилетит и куда будет смотреть. Крестик — там собьёт зенитка.'
        : 'За ход — один истребитель и один бомбардировщик. Нажмите на самолёт, затем на стрелку: куда прилетит и куда будет смотреть.';
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.path.map((p) => p * 5));
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type !== 'fly') continue;
      const prev = this.s;
      if (!prev) continue;
      const pl = prev.planes.find((x) => x.id === ev.id);
      if (!pl) continue;
      // полёт по шагам: каждый поворот и каждый узел
      for (let i = 1; i < ev.path.length; i++) {
        const a = ev.path[i - 1];
        const b = ev.path[i];
        const last = i === ev.path.length - 1;
        // сбитый ударом исчезает на последнем шаге
        const rest = prev.planes.filter((x) => x.id !== pl.id && !(last && ev.took && x.id === ev.took.id));
        const tmp: State = { ...prev, planes: [...rest, { ...pl, p: b.p, dir: b.dir }] };
        this.s = tmp;
        const kind = `${pl.side}${pl.kind}${b.dir}1`;
        const gone = last && ev.took ? [{ p: ev.took.p * 5, kind: this.kind(ev.took) }] : [];
        this.pb.show(tmp, a.p !== b.p ? { from: a.p * 5, to: b.p * 5, kind } : null, gone);
        if (a.p !== b.p) Sound.step();
        else Sound.ui();
        await sleep(160 / this.ctx.speed());
      }
      if (ev.took) Sound.capture();
      if (ev.shot >= 0) {
        Sound.nomove();
        const tmp: State = { ...v };
        this.pb.show(tmp, null, [{ p: ev.shot * 5, kind: `${pl.side}${pl.kind}${ev.path[ev.path.length - 1].dir}1` }]);
        await sleep(400 / this.ctx.speed());
      }
      if (ev.hq) Sound.win();
    }
    this.s = v;
    this.pb.mark(v.path.map((p) => p * 5));
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.pb.turn(s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null);
  }

  status(v: State, toAct: number[], interactive: number[]) {
    const names = v.cfg.ver === 'b' ? ['синие', 'жёлтые'] : ['синие', 'красные'];
    if (v.over) {
      if (v.winner == null) return 'Ничья';
      const how = v.why === 'hq' ? 'штаб разбомблен' : v.why === 'stuck' ? 'соперник не может лететь' : 'авиация соперника разбита';
      return `Победили ${names[v.winner]}: ${how}!`;
    }
    if (!interactive.some((x) => toAct.includes(x))) return `Летят ${names[v.side]}…`;
    if (v.cfg.ver === 'b') return v.moved.length ? `Теперь — ${v.moved[0] === 'b' ? 'истребитель' : 'бомбардировщик'}` : 'Ваш ход: истребитель и бомбардировщик';
    return 'Ваш ход: один самолёт';
  }

  playerStats(v: State, seat: number) {
    const side = seat % 2;
    return `${v.planes.filter((x) => x.side === side).length} самолётов`;
  }
}

export function createView(): GameView<State, Event> {
  return new VozboyView();
}

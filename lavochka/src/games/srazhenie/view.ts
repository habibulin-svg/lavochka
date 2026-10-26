/* «Сражение» — отрисовка. Поле — карта из набора для печати целиком (public/srazhenie/map.webp, 1200×1510):
 * сверху и снизу — легенда с портретами и названиями рангов, между ними 10×10 клеток с озёрами.
 * Фишки — сверху: белая лицевая сторона с цифрой со скана листа (faces.webp: 1…10, мина, знамя зелёное и синее)
 * и цветная полоса сгиба; чужая нераскрытая — цветная спинка. Синим поле поворачивается к себе. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import { FLAG, inZone, legalMoves, MINE, N, NAMES, RANKS, type Action, type Event, type State } from './engine';
import './srazhenie.css';

const BASE = `${import.meta.env.BASE_URL}srazhenie/`;
const W = 1200;
const H = 1510;
const X0 = 19;
const Y0 = 174;
const CELL = 116.2;
const FACE_W = 160;

class SrazhenieView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private hint!: HTMLElement;
  private s: State | null = null;
  /** Поле повёрнуто (за этим экраном — синие). */
  private flip = false;
  private root!: HTMLElement;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = root;
    this.flip = !ctx.demo && ctx.mySeats.length === 1 && ctx.mySeats[0] === 1;
    this.info = h(`<div class="sz-info"></div>`);
    ctx.controls.appendChild(this.info);
    this.hint = h(`<div class="sz-hint"></div>`);
    if (!ctx.demo) ctx.controls.appendChild(this.hint);
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: () => N,
        size: () => [W, H],
        xy: (_s, p) => this.xy(p),
        board: () => this.board(),
        pieces: (s) => {
          const out: { p: number; kind: string }[] = [];
          s.cells.forEach((c, p) => {
            if (c) out.push({ p, kind: `${c.owner}:${c.rank ?? 'x'}:${c.known ? 1 : 0}` });
          });
          return out;
        },
        piece: (_s, kind, x, y) => this.piece(kind, x, y),
        legal: (s, seat) => this.legal(s, seat),
        spot: (a) => (a.type === 'move' ? { from: a.from, to: a.to } : a.type === 'swap' ? { from: a.a, to: a.b } : null),
        label: (a) => (a.type === 'ready' ? 'В бой!' : a.type === 'auto' ? 'Расставить с умом' : a.type === 'shuffle' ? 'Перемешать' : '…'),
        zoom: true,
        hit: 56,
        ring: 52,
      },
      'sz'
    );
  }

  private xy(p: number): [number, number] {
    let c = p % 10;
    let r = Math.floor(p / 10);
    if (this.flip) {
      c = 9 - c;
      r = 9 - r;
    }
    return [X0 + CELL * (c + 0.5), Y0 + CELL * (r + 0.5)];
  }

  private board(): string {
    const img = `<image href="${BASE}map.webp" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`;
    return `<defs>
      <filter id="sz-sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>
      <linearGradient id="sz-g0" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fcf58"/><stop offset="1" stop-color="#58a836"/></linearGradient>
      <linearGradient id="sz-g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a70c4"/><stop offset="1" stop-color="#34488e"/></linearGradient>
    </defs>${this.flip ? `<g transform="rotate(180 ${W / 2} ${H / 2})">${img}</g>` : img}`;
  }

  private piece(kind: string, x: number, y: number): string {
    const [o, r, k] = kind.split(':');
    const owner = Number(o);
    const col = SEATS[owner];
    const S = 92;
    const hs = S / 2;
    const shadow = `<rect x="${-hs + 6}" y="${-hs + 9}" width="${S}" height="${S}" rx="7" fill="#000" opacity="0.4" filter="url(#sz-sh)"/>`;
    if (r === 'x')
      return `<g transform="translate(${x} ${y})">${shadow}
        <rect x="${-hs}" y="${-hs}" width="${S}" height="${S}" rx="7" fill="url(#sz-g${owner})" stroke="${col.dark}" stroke-width="2.5"/>
        <rect x="${-hs + 7}" y="${-hs + 7}" width="${S - 14}" height="${S - 14}" rx="4" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="2"/>
      </g>`;
    const rank = Number(r);
    const idx = rank === FLAG ? 11 + owner : rank === MINE ? 10 : rank - 1;
    // лицо: верхняя часть клетки листа с цифрой (160×200 → 140×130 от угла 10,10)
    const face = `<svg x="${-hs + 6}" y="${-hs + 20}" width="${S - 12}" height="${S - 26}" viewBox="${idx * FACE_W + 10} 6 140 130" preserveAspectRatio="xMidYMid meet"><image href="${BASE}faces.webp" x="0" y="0" width="${FACE_W * 13}" height="200"/></svg>`;
    const known = k === '1' ? `<circle cx="${hs - 11}" cy="${hs - 11}" r="7" fill="${col.color}" stroke="#fff" stroke-width="2"/>` : '';
    return `<g transform="translate(${x} ${y})">${shadow}
      <rect x="${-hs}" y="${-hs}" width="${S}" height="${S}" rx="7" fill="#fbfaf4" stroke="${col.dark}" stroke-width="2.5"/>
      <path d="M${-hs} ${-hs + 7}a7 7 0 0 1 7 -7h${S - 14}a7 7 0 0 1 7 7v9h${-S}z" fill="${col.color}"/>
      ${face}${known}
    </g>`;
  }

  private legal(s: State, seat: number): Action[] {
    if (s.phase === 'deploy') {
      if (s.ready[seat]) return [];
      const out: Action[] = [];
      for (let a = 0; a < N; a++) {
        if (!inZone(seat, a)) continue;
        for (let b = 0; b < N; b++) if (b !== a && inZone(seat, b)) out.push({ type: 'swap', a, b });
      }
      out.push({ type: 'shuffle' }, { type: 'auto' }, { type: 'ready' });
      return out;
    }
    if (s.phase !== 'play' || s.turn !== seat) return [];
    return legalMoves(s, seat);
  }

  private losses(seat: number): string {
    const s = this.s!;
    const lost = s.lost[seat];
    if (!lost.length) return '—';
    const cnt = new Map<number, number>();
    for (const r of lost) cnt.set(r, (cnt.get(r) ?? 0) + 1);
    return RANKS.filter((r) => cnt.has(r))
      .map((r) => `<span class="sz-chip" title="${NAMES[r]}">${r === MINE ? '💣' : r === FLAG ? '🚩' : r}${cnt.get(r)! > 1 ? `×${cnt.get(r)}` : ''}</span>`)
      .join('');
  }

  private text() {
    const s = this.s;
    if (!s) return;
    // при расстановке «откуда ходить» — все 40 фишек: кольца не нужны
    this.root.classList.toggle('sz-deploy', s.phase === 'deploy');
    const left = (seat: number) => 40 - s.lost[seat].length;
    this.info.innerHTML =
      s.phase === 'deploy'
        ? `<div>Расстановка: ${s.ready[0] ? '✔' : '…'} ${this.ctx.name(0)} · ${s.ready[1] ? '✔' : '…'} ${this.ctx.name(1)}</div>`
        : `<div class="sz-row">${this.ctx.name(0)}: <b>${left(0)}</b> фишек · потери ${this.losses(0)}</div>
           <div class="sz-row">${this.ctx.name(1)}: <b>${left(1)}</b> фишек · потери ${this.losses(1)}</div>
           <small>Меньше число — сильнее. Мину берёт только Сапёр (8), Маршала (1) — Разведчик (10), если нападёт сам.</small>`;
    this.hint.textContent =
      s.phase === 'deploy'
        ? 'Расставьте армию в своих четырёх рядах: нажмите на фишку, потом на другую — они поменяются местами. Готовы — «В бой!».'
        : 'Нажмите на свою фишку и на клетку, куда идти; клетка с чужой фишкой — нападение.';
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  private kindAt(v: State, p: number, rank: number | null, owner: number): string {
    const c = v.cells[p];
    return `${owner}:${rank ?? 'x'}:${c && c.known ? 1 : 0}`;
  }

  async play(events: Event[], v: State) {
    const sp = () => this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'swap') {
        this.s = v;
        this.pb.show(v, null);
        Sound.place();
      } else if (ev.type === 'layout') {
        this.s = v;
        this.pb.set(v);
        Sound.shuffle();
        await sleep(200 / sp());
      } else if (ev.type === 'start') {
        Sound.turn();
      } else if (ev.type === 'move') {
        this.s = v;
        const c = v.cells[ev.to];
        this.pb.show(v, { from: ev.from, to: ev.to, kind: c ? this.kindAt(v, ev.to, c.rank, c.owner) : '' });
        Sound.step();
        await sleep(340 / sp());
      } else if (ev.type === 'battle') {
        this.s = v;
        const att = ev.seat;
        const def = 1 - att;
        if (ev.res === 'win') {
          this.pb.show(v, { from: ev.from, to: ev.to, kind: this.kindAt(v, ev.to, ev.att, att) }, [{ p: ev.to, kind: `${def}:${ev.def}:1` }]);
          Sound.capture();
        } else if (ev.res === 'lose') {
          this.pb.show(v, null, [{ p: ev.from, kind: `${att}:${ev.att}:1` }]);
          if (ev.def === MINE) Sound.nomove();
          else Sound.capture();
        } else {
          this.pb.show(v, null, [
            { p: ev.from, kind: `${att}:${ev.att}:1` },
            { p: ev.to, kind: `${def}:${ev.def}:1` },
          ]);
          Sound.capture();
        }
        await sleep(650 / sp());
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
    if (v.phase === 'over') return v.winner == null ? 'Ничья' : `Победа: ${SEATS[v.winner].name.toLowerCase()}!`;
    const mine = interactive.some((x) => toAct.includes(x));
    if (v.phase === 'deploy') return mine ? 'Расставьте армию и нажмите «В бой!»' : 'Соперник расставляет армию…';
    if (!mine) return `Ходят ${SEATS[v.turn].name.toLowerCase()}…`;
    return 'Ваш ход';
  }

  playerStats(v: State, seat: number) {
    return v.phase === 'deploy' ? '' : `${40 - v.lost[seat].length} фишек`;
  }
}

export function createView(): GameView<State, Event> {
  return new SrazhenieView();
}

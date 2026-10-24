/* Сёги — отрисовка на общей доске PointBoard: доска из светлой кайи с тушевой сеткой и точками-звёздами, фигуры — плоские
 * «домики» из самшита с иероглифом (перевёрнутые — киноварью), остриём к сопернику. Рука каждого — ряд под и над доской:
 * коснитесь фигуры в руке, потом пустого поля. «Животные сёги» — зверята на плитках с точками-подсказками, куда ходят.
 * Чей ход и куда превращаться — в боковой панели. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { GEO, inCheck, legal, type Action, type Event, type Mode, type Piece, type State } from './engine';
import { pieceName } from './def';
import './shogi.css';

const M = 0.45;
const HAND = 1.15;

const KANJI: Record<string, string> = { R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩' };
const KANJI_PR: Record<string, string> = { R: '龍', B: '馬', S: '全', N: '圭', L: '杏', P: 'と' };
const RU: Record<string, string> = { K: 'Кр', R: 'Л', B: 'С', G: 'З', S: 'Сер', N: 'К', L: 'Коп', P: 'П' };
const RU_PR: Record<string, string> = { R: 'Дрк', B: 'Лшд', S: 'Сер', N: 'Кон', L: 'Коп', P: 'Ток' };
const ZOO: Record<string, string> = { K: '🦁', W: '🦒', F: '🐘', P: '🐤' };

/** Направления зверят (вперёд — dr > 0) для точек-подсказок. */
const ZOO_DIRS: Record<string, number[][]> = {
  K: [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, -1], [1, -1], [-1, -1]],
  W: [[0, 1], [0, -1], [1, 0], [-1, 0]],
  F: [[1, 1], [-1, 1], [1, -1], [-1, -1]],
  P: [[0, 1]],
  H: [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, -1]],
};

type Act = Action & { ask?: boolean };

class ShogiView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Act>;
  private panel!: HTMLElement;
  private s: State | null = null;

  private get flip() {
    const mine = this.ctx.mySeats;
    return mine.length === 1 && mine[0] === 1;
  }
  private g(s: State) {
    return GEO[s.cfg.mode];
  }
  private size(s: State): [number, number] {
    const g = this.g(s);
    return [g.w + 2 * M, g.h + 2 * M + 2 * HAND];
  }
  /** Слот руки: N + место * 8 + номер вида. */
  private slot(s: State, seat: number, kind: string) {
    const g = this.g(s);
    return g.w * g.h + seat * 8 + g.kinds.indexOf(kind);
  }
  private xy(s: State, p: number): [number, number] {
    const g = this.g(s);
    const n = g.w * g.h;
    if (p >= n) {
      const seat = Math.floor((p - n) / 8);
      const i = (p - n) % 8;
      const bottom = (seat === 0) !== this.flip;
      const x = M + (g.w - g.kinds.length) / 2 + i + 0.5;
      const H = this.size(s)[1];
      return [x, bottom ? H - HAND / 2 : HAND / 2];
    }
    const f = p % g.w;
    const r = Math.floor(p / g.w);
    const ff = this.flip ? g.w - 1 - f : f;
    const rr = this.flip ? r : g.h - 1 - r;
    return [M + ff + 0.5, M + HAND + rr + 0.5];
  }

  private board(s: State): string {
    const g = this.g(s);
    const [W, H] = this.size(s);
    const zoo = s.cfg.mode === 'dobutsu';
    let o = `<defs>
      <linearGradient id="sg-kaya" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0c878"/><stop offset=".6" stop-color="#e2b25e"/><stop offset="1" stop-color="#cf9a48"/></linearGradient>
      <linearGradient id="sg-pc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe7b4"/><stop offset="1" stop-color="#e4c27e"/></linearGradient>
      <linearGradient id="sg-stand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5a2a"/><stop offset="1" stop-color="#5a3414"/></linearGradient>
    </defs>`;
    o += `<rect x="0" y="0" width="${W}" height="${HAND - 0.05}" rx="0.15" fill="url(#sg-stand)" opacity=".9"/>`;
    o += `<rect x="0" y="${H - HAND + 0.05}" width="${W}" height="${HAND - 0.05}" rx="0.15" fill="url(#sg-stand)" opacity=".9"/>`;
    const top = HAND;
    o += `<rect x="0.04" y="${top + 0.04}" width="${W - 0.08}" height="${g.h + 2 * M - 0.08}" rx="0.12" fill="${zoo ? '#cfe8b8' : 'url(#sg-kaya)'}" stroke="${zoo ? '#6a9a4a' : '#7a4a1a'}" stroke-width="0.06"/>`;
    const line = zoo ? '#5a8a3a' : '#2a1608';
    for (let f = 0; f <= g.w; f++) o += `<line x1="${M + f}" y1="${top + M}" x2="${M + f}" y2="${top + M + g.h}" stroke="${line}" stroke-width="0.025"/>`;
    for (let r = 0; r <= g.h; r++) o += `<line x1="${M}" y1="${top + M + r}" x2="${M + g.w}" y2="${top + M + r}" stroke="${line}" stroke-width="0.025"/>`;
    if (s.cfg.mode === 'shogi') for (const [x, y] of [[3, 3], [6, 3], [3, 6], [6, 6]]) o += `<circle cx="${M + x}" cy="${top + M + y}" r="0.06" fill="${line}"/>`;
    if (zoo) {
      // свои поля — подкрашены
      o += `<rect x="${M}" y="${top + M}" width="${g.w}" height="1" fill="${this.flip ? '#8acb6a' : '#f0a0a0'}" opacity=".35"/>`;
      o += `<rect x="${M}" y="${top + M + g.h - 1}" width="${g.w}" height="1" fill="${this.flip ? '#f0a0a0' : '#8acb6a'}" opacity=".35"/>`;
    }
    return o;
  }

  private piece(s: State, kind: string, x: number, y: number): string {
    // kind: «0P+» — владелец, вид, перевёрнута; в руке — «h0P3»
    const hand = kind[0] === 'h';
    const k = hand ? kind.slice(1) : kind;
    const o = Number(k[0]);
    const t = k[1];
    const pr = k[2] === '+';
    const cnt = hand ? Number(k.slice(2)) : 0;
    const up = (o === 0) !== this.flip;
    const mode = s.cfg.mode;
    if (mode === 'dobutsu') return this.zoo(t, pr, o, up, x, y, cnt);
    const big = t === 'K' || t === 'R' || t === 'B';
    const w = big ? 0.42 : t === 'P' ? 0.34 : 0.38;
    const hh = big ? 0.46 : t === 'P' ? 0.38 : 0.42;
    const sgn = up ? 1 : -1;
    const pts = [
      [0, -hh],
      [w * 0.72, -hh * 0.62],
      [w, hh],
      [-w, hh],
      [-w * 0.72, -hh * 0.62],
    ].map(([dx, dy]) => `${x + dx * sgn} ${y + dy * sgn}`);
    const ink = pr ? '#b8231a' : '#1a1008';
    const ru = s.cfg.labels === 'ru';
    const label = ru ? (pr ? RU_PR[t] : RU[t]) : t === 'K' ? (o === 0 ? '玉' : '王') : pr ? KANJI_PR[t] : KANJI[t];
    const fs = ru ? (label.length > 2 ? 0.22 : 0.3) : big ? 0.42 : 0.36;
    let out = `<path d="M${pts.join('L')}Z" fill="rgba(0,0,0,0.3)" transform="translate(0.04 0.06)"/><path d="M${pts.join('L')}Z" fill="url(#sg-pc)" stroke="#8a6a3a" stroke-width="0.025"/>`;
    out += `<text x="${x}" y="${y + fs * 0.4 + 0.04 * sgn}" class="sg-ch${ru ? ' lat' : ''}" fill="${ink}" font-size="${fs}" transform="rotate(${up || ru ? 0 : 180} ${x} ${y + 0.04 * sgn})">${label}</text>`;
    if (cnt > 1) out += `<circle cx="${x + 0.36}" cy="${y + 0.32}" r="0.16" fill="#b8231a"/><text x="${x + 0.36}" y="${y + 0.38}" class="sg-cnt">${cnt}</text>`;
    return out;
  }

  private zoo(t: string, pr: boolean, o: number, up: boolean, x: number, y: number, cnt: number): string {
    const sgn = up ? 1 : -1;
    const bg = o === 0 ? '#f6fff0' : '#fff2f2';
    const edge = o === 0 ? '#4a9a3a' : '#c84a5a';
    let out = `<rect x="${x - 0.42}" y="${y - 0.42}" width="0.84" height="0.84" rx="0.12" fill="rgba(0,0,0,0.25)" transform="translate(0.03 0.05)"/><rect x="${x - 0.42}" y="${y - 0.42}" width="0.84" height="0.84" rx="0.12" fill="${bg}" stroke="${edge}" stroke-width="0.05"/>`;
    for (const [df, dr] of ZOO_DIRS[pr ? 'H' : t] ?? []) out += `<circle cx="${x + df * 0.32 * sgn}" cy="${y - dr * 0.32 * sgn}" r="0.04" fill="${edge}"/>`;
    out += `<text x="${x}" y="${y + 0.17}" class="sg-zoo" font-size="0.5">${pr ? '🐔' : ZOO[t]}</text>`;
    if (cnt > 1) out += `<circle cx="${x + 0.36}" cy="${y + 0.32}" r="0.16" fill="#b8231a"/><text x="${x + 0.36}" y="${y + 0.38}" class="sg-cnt">${cnt}</text>`;
    return out;
  }

  private acts(s: State, seat: number): Act[] {
    if (s.turn !== seat || s.over) return [];
    const ms = legal(s);
    const out: Act[] = [];
    const seen = new Map<string, Act>();
    for (const m of ms) {
      if (m.drop) {
        out.push({ type: 'drop', kind: m.drop, to: m.to });
        continue;
      }
      const k = `${m.from}-${m.to}`;
      const prev = seen.get(k);
      if (prev && prev.type === 'move') {
        prev.ask = true;
        prev.promo = undefined;
        continue;
      }
      const a: Act = { type: 'move', from: m.from, to: m.to, promo: m.promo };
      seen.set(k, a);
      out.push(a);
    }
    return out;
  }

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.panel = h('<div class="sg-panel"></div>');
    ctx.controls.appendChild(this.panel);
    if (!ctx.demo) ctx.controls.appendChild(h('<div class="sg-hint">Коснитесь фигуры, потом — подсвеченного поля. Фигуры в руке — в ряду у вашего края доски.</div>'));
    const wrapped = Object.create(ctx) as ViewCtx;
    wrapped.act = (seat, a) => this.act(seat, a as Act);
    this.pb = new PointBoard<State, Act>(
      root,
      wrapped,
      {
        count: (s) => this.g(s).w * this.g(s).h + 16,
        size: (s) => this.size(s),
        xy: (s, p) => this.xy(s, p),
        board: (s) => this.board(s),
        pieces: (s) => {
          const out = s.board.flatMap((x: Piece | null, p) => (x ? [{ p, kind: `${x.o}${x.k}${x.pr ? '+' : ''}` }] : []));
          for (const seat of [0, 1]) for (const [k, n] of Object.entries(s.hands[seat])) if (n > 0) out.push({ p: this.slot(s, seat, k), kind: `h${seat}${k}${n}` });
          return out;
        },
        piece: (s, kind, x, y) => this.piece(s, kind, x, y),
        legal: (s, seat) => this.acts(s, seat),
        spot: (a) => (a.type === 'move' ? { from: a.from, to: a.to } : a.type === 'drop' && this.s ? { from: this.slot(this.s, this.s.turn, a.kind), to: a.to } : null),
        hit: 0.5,
        ring: 0.46,
      },
      'sg-wrap'
    );
  }

  private act(seat: number, a: Act) {
    if (a.type === 'move' && a.ask) {
      this.panel.innerHTML = '';
      this.panel.appendChild(h('<div class="sg-ask">Перевернуть фигуру?</div>'));
      const row = h('<div class="sg-row"></div>');
      for (const [label, promo] of [
        ['Перевернуть', true],
        ['Оставить', false],
      ] as const) {
        const b = h<HTMLButtonElement>(`<button class="btn${promo ? ' primary' : ''}">${label}</button>`);
        b.onclick = () => {
          Sound.ui();
          this.panel.innerHTML = '';
          this.ctx.act(seat, { type: 'move', from: a.from, to: a.to, promo });
        };
        row.appendChild(b);
      }
      this.panel.appendChild(row);
      return;
    }
    this.ctx.act(seat, a);
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last ? [v.last.from, v.last.to] : []);
    this.pb.set(v);
  }

  async play(events: Event[], v: State) {
    let cur = this.s ?? v;
    for (const ev of events) {
      if (ev.type === 'move') {
        const board = cur.board.slice();
        const hands: State['hands'] = [{ ...cur.hands[0] }, { ...cur.hands[1] }];
        const from = ev.drop ? this.slot(cur, ev.seat, ev.kind) : ev.from;
        const moving = ev.drop ? { o: ev.seat as 0 | 1, k: ev.kind, pr: false } : { ...board[ev.from]!, pr: board[ev.from]!.pr || ev.promo };
        if (ev.drop) hands[ev.seat][ev.kind]--;
        else board[ev.from] = null;
        const taken = board[ev.to];
        if (taken) hands[ev.seat][taken.k] = (hands[ev.seat][taken.k] ?? 0) + 1;
        board[ev.to] = moving;
        const after: State = { ...cur, board, hands, last: { from, to: ev.to } };
        this.pb.mark([from, ev.to]);
        this.pb.show(after, { from, to: ev.to, kind: `${moving.o}${moving.k}${moving.pr ? '+' : ''}` }, taken ? [{ p: ev.to, kind: `${taken.o}${taken.k}${taken.pr ? '+' : ''}` }] : []);
        if (taken) Sound.capture();
        else Sound.place();
        if (ev.check) Sound.turn();
        await sleep(340 / this.ctx.speed());
        cur = after;
      } else if (ev.type === 'end') Sound.win();
    }
    this.setView(v);
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.panel.innerHTML = '';
    this.pb.turn(s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null);
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : `Победа: ${this.ctx.name(v.winner)}`;
    const who = toAct[0];
    const check = inCheck({ board: v.board, hands: v.hands, turn: v.turn, mode: v.cfg.mode as Mode }, who) ? ' — <b>шах!</b>' : '';
    return interactive.includes(who) ? `Ваш ход${check}` : `Ходят ${this.ctx.name(who)}${check}…`;
  }

  playerStats(v: State, seat: number) {
    const hand = Object.entries(v.hands[seat]).filter(([, n]) => n > 0);
    return hand.length ? `в руке: ${hand.map(([k, n]) => `${pieceName(k, v.cfg.mode)}${n > 1 ? ` ×${n}` : ''}`).join(', ')}` : '';
  }
}

export function createView(): GameView<State, Event> {
  return new ShogiView();
}

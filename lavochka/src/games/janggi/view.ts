/* Чанги — отрисовка на общей доске PointBoard: светлая доска без реки, два дворца с диагоналями. Фигуры — восьмиугольные
 * фишки из светлого дерева разного размера (генерал крупнее, солдат мельче), знак вырезан и залит краской: у Чо — синей, у Хан — красной.
 * Пропустить ход — кнопкой в панели. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { canPass, colorOf, fileOf, legal, N, points, rankOf, type Action, type Event, type State } from './engine';
import { NAME_RU } from './def';
import './janggi.css';

const M = 0.8;
const W = 8 + 2 * M;
const H = 9 + 2 * M;

const HANJA: Record<string, [string, string]> = { K: ['楚', '漢'], A: ['士', '士'], E: ['象', '象'], H: ['馬', '馬'], R: ['車', '車'], C: ['包', '包'], P: ['卒', '兵'] };
const RU: Record<string, string> = { K: 'Ген', A: 'Сов', E: 'Слон', H: 'Конь', R: 'Кол', C: 'Пуш', P: 'Сол' };
const SIZE: Record<string, number> = { K: 0.47, R: 0.4, C: 0.4, H: 0.4, E: 0.4, A: 0.33, P: 0.33 };

class JanggiView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private s: State | null = null;

  private get flip() {
    const mine = this.ctx.mySeats;
    return mine.length === 1 && mine[0] === 1;
  }
  private xy(p: number): [number, number] {
    const f = this.flip ? 8 - fileOf(p) : fileOf(p);
    const r = this.flip ? rankOf(p) : 9 - rankOf(p);
    return [M + f, M + r];
  }

  private board(): string {
    const line = '#3a2410';
    let o = `<defs>
      <linearGradient id="jg-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2d8a0"/><stop offset=".6" stop-color="#e6c482"/><stop offset="1" stop-color="#d4ac68"/></linearGradient>
      <radialGradient id="jg-pc" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff6e0"/><stop offset=".8" stop-color="#ead2a0"/><stop offset="1" stop-color="#c8a868"/></radialGradient>
    </defs>`;
    o += `<rect x="0.04" y="0.04" width="${W - 0.08}" height="${H - 0.08}" rx="0.2" fill="url(#jg-wood)" stroke="#7a4a1a" stroke-width="0.08"/>`;
    const L = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${M + x1}" y1="${M + y1}" x2="${M + x2}" y2="${M + y2}" stroke="${line}" stroke-width="0.03"/>`;
    for (let r = 0; r <= 9; r++) o += L(0, r, 8, r);
    for (let f = 0; f <= 8; f++) o += L(f, 0, f, 9);
    o += L(3, 0, 5, 2) + L(5, 0, 3, 2) + L(3, 7, 5, 9) + L(5, 7, 3, 9);
    for (let f = 0; f < 9; f++) o += `<text x="${M + (this.flip ? 8 - f : f)}" y="${H - 0.18}" class="jg-coord">${'abcdefghi'[f]}</text>`;
    for (let r = 0; r < 10; r++) o += `<text x="0.3" y="${M + (this.flip ? r : 9 - r) + 0.08}" class="jg-coord">${r + 1}</text>`;
    return o;
  }

  private piece(s: State, kind: string, x: number, y: number): string {
    const c = colorOf(kind);
    const k = kind.toUpperCase();
    const R = SIZE[k];
    const oct = Array.from({ length: 8 }, (_, i) => {
      const a = (Math.PI / 4) * i + Math.PI / 8;
      return `${x + R * Math.cos(a)} ${y + R * Math.sin(a)}`;
    }).join('L');
    const ink = c === 0 ? '#1a4a8a' : '#c0281e';
    const ru = s.cfg.labels === 'ru';
    const t = ru ? RU[k] : HANJA[k][c];
    const fs = ru ? (t.length > 3 ? 0.22 : 0.27) : R * 1.05;
    return `<path d="M${oct}Z" fill="rgba(0,0,0,0.3)" transform="translate(0.04 0.06)"/><path d="M${oct}Z" fill="url(#jg-pc)" stroke="#8a6a3a" stroke-width="0.025"/><text x="${x}" y="${y + fs * 0.36}" class="jg-ch${ru ? ' lat' : ''}" fill="${ink}" font-size="${fs}">${t}</text>`;
  }

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h('<div class="jg-info"></div>');
    ctx.controls.appendChild(this.info);
    if (!ctx.demo) ctx.controls.appendChild(h('<div class="jg-hint">Коснитесь своей фигуры, потом — подсвеченной точки. Без шаха ход можно пропустить.</div>'));
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: () => N,
        size: () => [W, H],
        xy: (_s, p) => this.xy(p),
        board: () => this.board(),
        pieces: (s) => s.board.flatMap((x, p) => (x ? [{ p, kind: x }] : [])),
        piece: (s, kind, x, y) => this.piece(s, kind, x, y),
        legal: (s, seat) => {
          if (s.turn !== seat || s.over) return [];
          const out: Action[] = legal(s).map((m) => ({ type: 'move', from: m.from, to: m.to }));
          if (canPass(s)) out.push({ type: 'pass' });
          return out;
        },
        spot: (a) => (a.type === 'move' ? { from: a.from, to: a.to } : null),
        label: (a) => (a.type === 'pass' ? 'Пропустить ход' : ''),
        hit: 0.48,
        ring: 0.47,
      },
      'jg-wrap'
    );
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const pts = points(s.board);
    const took = (c: number) => s.captured[c].map((x) => NAME_RU[x.toUpperCase()]).join(', ') || '—';
    this.info.innerHTML = `<div>Очки: Чо <b>${pts[0]}</b> · Хан <b>${pts[1]}</b></div><small>Чо взяли: ${took(0)}<br>Хан взяли: ${took(1)}</small>${s.bik >= 0 ? '<div class="jg-bik">Бикджан! Разорвите его, иначе — подсчёт очков.</div>' : ''}`;
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last ? [v.last.from, v.last.to] : []);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    let cur = this.s ?? v;
    for (const ev of events) {
      if (ev.type === 'move') {
        const board = cur.board.slice();
        board[ev.to] = ev.piece;
        board[ev.from] = '';
        const gone = ev.captured ? [{ p: ev.to, kind: ev.captured }] : [];
        const after: State = { ...cur, board, last: { from: ev.from, to: ev.to } };
        this.pb.mark([ev.from, ev.to]);
        this.pb.show(after, { from: ev.from, to: ev.to, kind: ev.piece }, gone);
        if (ev.captured) Sound.capture();
        else Sound.place();
        if (ev.check || ev.bik) Sound.turn();
        await sleep(360 / this.ctx.speed());
        cur = after;
      } else if (ev.type === 'pass') {
        Sound.ui();
        await sleep(300 / this.ctx.speed());
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
  return new JanggiView();
}

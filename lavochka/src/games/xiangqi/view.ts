/* Сянци — отрисовка на общей доске PointBoard. Доска — клеёная фанера под лаком с тушевыми линиями, река с надписью «楚河 漢界»,
 * дворцы с диагоналями. Фигуры — точёные кругляши слоновой кости с вырезанным знаком: красные — киноварью, чёрные — тушью.
 * Ко-туонг — бумажная вьетнамская доска с красными линиями и подписями латиницей; ко-уп — закрытые фигуры рубашкой вверх. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { colorOf, fileOf, HIDDEN, legal, N, rankOf, type Action, type Event, type Labels, type State } from './engine';
import { NAME_RU } from './def';
import './xiangqi.css';

const M = 0.8;
const W = 8 + 2 * M;
const H = 9 + 2 * M;

const HANZI: Record<string, [string, string]> = { K: ['帥', '將'], A: ['仕', '士'], E: ['相', '象'], H: ['傌', '馬'], R: ['俥', '車'], C: ['炮', '砲'], P: ['兵', '卒'] };
const RU: Record<string, string> = { K: 'Ген', A: 'Сов', E: 'Слон', H: 'Конь', R: 'Кол', C: 'Пуш', P: 'Сол' };
const VI: Record<string, string> = { K: 'Tướng', A: 'Sĩ', E: 'Tượng', H: 'Mã', R: 'Xe', C: 'Pháo', P: 'Tốt' };

function label(k: string, c: number, l: Labels): string {
  return l === 'ru' ? RU[k] : l === 'vi' ? VI[k] : HANZI[k][c];
}

class XiangqiView implements GameView<State, Event> {
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

  private board(s: State): string {
    const viet = s.cfg.mode === 'kotuong';
    const line = viet ? '#b0281c' : '#2a1608';
    let o = `<defs>
      <linearGradient id="xq-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8c48a"/><stop offset=".5" stop-color="#dcb070"/><stop offset="1" stop-color="#c99a58"/></linearGradient>
      <linearGradient id="xq-paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6ecc8"/><stop offset="1" stop-color="#ead9a6"/></linearGradient>
      <radialGradient id="xq-ivory" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fffaf0"/><stop offset=".75" stop-color="#efe0bf"/><stop offset="1" stop-color="#d4bd8e"/></radialGradient>
      <radialGradient id="xq-back" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#9a6a3a"/><stop offset="1" stop-color="#4a2a12"/></radialGradient>
      <pattern id="xq-grain" width="0.6" height="0.12" patternUnits="userSpaceOnUse"><path d="M0 0.06q0.15 -0.03 0.3 0t0.3 0" fill="none" stroke="#8a5a28" stroke-width="0.01" opacity=".25"/></pattern>
    </defs>`;
    o += `<rect x="0.04" y="0.04" width="${W - 0.08}" height="${H - 0.08}" rx="0.25" fill="${viet ? 'url(#xq-paper)' : 'url(#xq-wood)'}" stroke="${viet ? '#8a6a2a' : '#6a3a14'}" stroke-width="0.08"/>`;
    if (!viet) o += `<rect x="0.04" y="0.04" width="${W - 0.08}" height="${H - 0.08}" rx="0.25" fill="url(#xq-grain)"/>`;
    o += `<rect x="${M - 0.12}" y="${M - 0.12}" width="${8.24}" height="${9.24}" fill="none" stroke="${line}" stroke-width="0.06"/>`;
    const L = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${M + x1}" y1="${M + y1}" x2="${M + x2}" y2="${M + y2}" stroke="${line}" stroke-width="0.03"/>`;
    for (let r = 0; r <= 9; r++) o += L(0, r, 8, r);
    for (let f = 0; f <= 8; f++) {
      if (f === 0 || f === 8) o += L(f, 0, f, 9);
      else o += L(f, 0, f, 4) + L(f, 5, f, 9);
    }
    // дворцы
    o += L(3, 0, 5, 2) + L(5, 0, 3, 2) + L(3, 7, 5, 9) + L(5, 7, 3, 9);
    // метки мест пушек и солдат
    const mark = (f: number, r: number) => {
      let m = '';
      for (const [dx, dy] of [
        [-1, -1], [1, -1], [-1, 1], [1, 1],
      ]) {
        if (f + dx < 0 || f + dx > 8) continue;
        const x = M + f + dx * 0.1;
        const y = M + r + dy * 0.1;
        m += `<path d="M${x + dx * 0.16} ${y}L${x} ${y}L${x} ${y + dy * 0.16}" fill="none" stroke="${line}" stroke-width="0.025"/>`;
      }
      return m;
    };
    for (const r of [2, 7]) for (const f of [1, 7]) o += mark(f, r);
    for (const r of [3, 6]) for (const f of [0, 2, 4, 6, 8]) o += mark(f, r);
    // река
    const river = s.cfg.labels === 'ru' ? ['РЕ', 'КА'] : viet ? ['Sở hà', 'Hán giới'] : ['楚 河', '漢 界'];
    o += `<text x="${M + 2}" y="${M + 4.62}" class="xq-river${viet ? ' vi' : ''}" fill="${line}">${river[0]}</text><text x="${M + 6}" y="${M + 4.62}" class="xq-river${viet ? ' vi' : ''}" fill="${line}">${river[1]}</text>`;
    // буквы и цифры по краям
    for (let f = 0; f < 9; f++) {
      const x = M + (this.flip ? 8 - f : f);
      o += `<text x="${x}" y="${H - 0.18}" class="xq-coord">${'abcdefghi'[f]}</text>`;
    }
    for (let r = 0; r < 10; r++) {
      const y = M + (this.flip ? r : 9 - r);
      o += `<text x="0.3" y="${y + 0.08}" class="xq-coord">${r + 1}</text>`;
    }
    return o;
  }

  private piece(s: State, kind: string, x: number, y: number): string {
    const R = 0.43;
    const shadow = `<ellipse cx="${x + 0.04}" cy="${y + 0.07}" rx="${R}" ry="${R * 0.92}" fill="rgba(0,0,0,0.35)"/>`;
    if (HIDDEN.includes(kind[0])) {
      const c = colorOf(kind[0]);
      return `${shadow}<circle cx="${x}" cy="${y}" r="${R}" fill="url(#xq-back)" stroke="${c === 0 ? '#c0302a' : '#111'}" stroke-width="0.05"/><circle cx="${x}" cy="${y}" r="${R - 0.1}" fill="none" stroke="#e8c48a" stroke-width="0.02" opacity=".6"/><path d="M${x - 0.14} ${y}L${x} ${y - 0.14}L${x + 0.14} ${y}L${x} ${y + 0.14}Z" fill="none" stroke="#e8c48a" stroke-width="0.02" opacity=".6"/>`;
    }
    const c = colorOf(kind);
    const k = kind.toUpperCase();
    const viet = s.cfg.mode === 'kotuong';
    const ink = c === 0 ? '#b8231a' : viet ? '#1c5a3a' : '#1a1410';
    const t = label(k, c, s.cfg.labels);
    const fs = s.cfg.labels === 'hanzi' ? 0.46 : t.length <= 2 ? 0.34 : 0.27;
    // длинные подписи сжимаем по ширине кругляша
    const fit = s.cfg.labels !== 'hanzi' && t.length > 3 ? ` textLength="${(R * 1.55).toFixed(2)}" lengthAdjust="spacingAndGlyphs"` : '';
    return `${shadow}<circle cx="${x}" cy="${y}" r="${R}" fill="url(#xq-ivory)" stroke="#8a6a3a" stroke-width="0.025"/><circle cx="${x}" cy="${y}" r="${R - 0.07}" fill="none" stroke="${ink}" stroke-width="0.025"/><text x="${x}" y="${y + fs * 0.36}" class="xq-ch${s.cfg.labels === 'hanzi' ? '' : ' lat'}" fill="${ink}" font-size="${fs}"${fit}>${t}</text>`;
  }

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h('<div class="xq-info"></div>');
    ctx.controls.appendChild(this.info);
    if (!ctx.demo) ctx.controls.appendChild(h('<div class="xq-hint">Коснитесь своей фигуры, потом — подсвеченной точки.</div>'));
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: () => N,
        size: () => [W, H],
        xy: (_s, p) => this.xy(p),
        board: (s) => this.board(s),
        pieces: (s) => s.board.flatMap((x, p) => (x ? [{ p, kind: x }] : [])),
        piece: (s, kind, x, y) => this.piece(s, kind, x, y),
        legal: (s, seat) => (s.turn === seat && !s.over ? legal(s).map((m) => ({ type: 'move', from: m.from, to: m.to }) as Action) : []),
        spot: (a) => (a.type === 'move' ? { from: a.from, to: a.to } : null),
        hit: 0.48,
        ring: 0.47,
      },
      'xq-wrap'
    );
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const took = (c: number) => s.captured[c].map((x) => (HIDDEN.includes(x) ? '?' : NAME_RU[x.toUpperCase()])).join(', ') || '—';
    this.info.innerHTML = `<div>Красные взяли: ${took(0)}</div><div>Чёрные взяли: ${took(1)}</div>${s.quiet > 40 ? `<small>без взятий ${Math.floor(s.quiet / 2)} ходов из 60</small>` : ''}`;
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
        const hidden = cur.hidden.slice();
        const shown = ev.revealed ?? cur.board[ev.from];
        board[ev.to] = shown;
        board[ev.from] = '';
        hidden[ev.to] = false;
        hidden[ev.from] = false;
        const gone = ev.captured ? [{ p: ev.to, kind: cur.board[ev.to] }] : [];
        const after: State = { ...cur, board, hidden, last: { from: ev.from, to: ev.to } };
        this.pb.mark([ev.from, ev.to]);
        this.pb.show(after, { from: ev.from, to: ev.to, kind: shown }, gone);
        if (ev.captured) Sound.capture();
        else Sound.place();
        if (ev.check) Sound.turn();
        await sleep(360 / this.ctx.speed());
        cur = after;
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
  return new XiangqiView();
}

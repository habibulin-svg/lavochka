/* Шатра — отрисовка на общей доске PointBoard. Доска — войлок цвета охры на деревянной раме с орнаментом «рога барана»
 * (кочкор мюйуз), посередине — ров (синяя полоса), с каждой стороны — крепость за зубчатой стеной и ворота.
 * Фигуры — деревянные кругляши: белые — берёза, чёрные — морёная лиственница, на каждой выжжен знак:
 * бий — корона, батыр — шлем, тура — башня, ялкын (по-алтайски «пламя») — пламя, шатра — шатёр. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { CELLS, forcedCapture, fortress, legal, N, num, type Action, type Event, type Kind, type State } from './engine';
import { KIND_RU } from './def';
import './shatra.css';

const M = 0.75;
const MOAT = 0.42;
const X = (i: number) => M + CELLS[i].x + 0.5;
const Y = (i: number) => M + CELLS[i].y + 0.5 + (CELLS[i].y >= 7 ? MOAT : 0);
const W = 7 + 2 * M;
const H = 14 + 2 * M + MOAT;

/** Завиток «рога барана» в точке (x, y), размер r. */
function horn(x: number, y: number, r: number, flip = 1): string {
  return `<path d="M${x - r} ${y}c0 ${-r * 0.9} ${r * 0.9 * flip} ${-r * 0.9} ${r * 0.9 * flip} ${-r * 0.2}s${-r * 0.5 * flip} ${r * 0.5} ${-r * 0.3 * flip} ${r * 0.1}M${x + r} ${y}c0 ${-r * 0.9} ${-r * 0.9 * flip} ${-r * 0.9} ${-r * 0.9 * flip} ${-r * 0.2}s${r * 0.5 * flip} ${r * 0.5} ${r * 0.3 * flip} ${r * 0.1}" class="sh-orn"/>`;
}

function board(): string {
  let o = `<defs>
    <linearGradient id="sh-frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a4a22"/><stop offset="1" stop-color="#4a2a10"/></linearGradient>
    <radialGradient id="sh-felt" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#d8b06a"/><stop offset="1" stop-color="#b88a44"/></radialGradient>
    <radialGradient id="sh-w" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#fbf3e2"/><stop offset="1" stop-color="#d9c49a"/></radialGradient>
    <radialGradient id="sh-b" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#7a4a2a"/><stop offset="1" stop-color="#2e180a"/></radialGradient>
  </defs>`;
  o += `<rect x="0.05" y="0.05" width="${W - 0.1}" height="${H - 0.1}" rx="0.35" fill="url(#sh-frame)"/>`;
  // орнамент по раме
  for (let k = 0; k < 7; k++) {
    o += horn(M + k + 0.5, 0.48, 0.24);
    o += horn(M + k + 0.5, H - 0.32, 0.24);
  }
  // поля: большое поле, крепости, ворота
  const cellR = (i: number) => {
    const x = X(i) - 0.5;
    const y = Y(i) - 0.5;
    return `<rect x="${x + 0.03}" y="${y + 0.03}" width="0.94" height="0.94" rx="0.05" class="sh-cell${fortress(0, i) || fortress(1, i) ? ' fort' : ''}${CELLS[i].y === 3 || CELLS[i].y === 10 ? ' gate' : ''}"/>`;
  };
  o += `<rect x="${M - 0.06}" y="${M + 3.94}" width="7.12" height="${6.12 + MOAT}" rx="0.08" fill="url(#sh-felt)"/>`;
  for (const top of [true, false]) {
    const y0 = top ? M - 0.06 : M + 11 + MOAT - 0.06;
    o += `<rect x="${M + 1.94}" y="${y0}" width="3.12" height="3.12" rx="0.08" fill="url(#sh-felt)" class="sh-fortress"/>`;
    // зубцы стены
    const yy = top ? y0 + 3.12 : y0;
    for (let k = 0; k < 6; k++) o += `<rect x="${M + 1.94 + k * 0.52 + 0.06}" y="${yy - 0.09}" width="0.32" height="0.18" class="sh-merlon"/>`;
  }
  for (let i = 0; i < N; i++) o += cellR(i);
  // ров
  o += `<rect x="${M - 0.06}" y="${M + 7 + 0.02}" width="7.12" height="${MOAT - 0.04}" class="sh-moat"/>`;
  o += `<path d="M${M} ${M + 7 + MOAT / 2}q0.25 -0.12 0.5 0t0.5 0t0.5 0t0.5 0t0.5 0t0.5 0t0.5 0t0.5 0t0.5 0t0.5 0t0.5 0t0.5 0t0.5 0t0.5 0" class="sh-wave"/>`;
  // номера полей мелко — по описаниям правил
  for (let i = 0; i < N; i++) o += `<text x="${X(i) - 0.42}" y="${Y(i) - 0.32}" class="sh-num">${num(i)}</text>`;
  return o;
}

function glyph(k: Kind, x: number, y: number, c: string): string {
  const st = `fill="none" stroke="${c}" stroke-width="0.055" stroke-linecap="round" stroke-linejoin="round"`;
  switch (k) {
    case 'K':
      return `<path d="M${x - 0.2} ${y + 0.12}L${x - 0.22} ${y - 0.1}L${x - 0.1} ${y}L${x} ${y - 0.16}L${x + 0.1} ${y}L${x + 0.22} ${y - 0.1}L${x + 0.2} ${y + 0.12}Z" ${st}/>`;
    case 'Q':
      return `<path d="M${x - 0.18} ${y + 0.12}Q${x - 0.2} ${y - 0.16} ${x} ${y - 0.17}Q${x + 0.2} ${y - 0.16} ${x + 0.18} ${y + 0.12}Z M${x} ${y - 0.17}L${x} ${y - 0.26}" ${st}/><circle cx="${x}" cy="${y - 0.01}" r="0.04" fill="${c}"/>`;
    case 'R': {
      // башня с тремя зубцами и воротами
      const pts = [
        [-0.15, 0.17], [-0.15, -0.08], [-0.19, -0.08], [-0.19, -0.21], [-0.11, -0.21], [-0.11, -0.14], [-0.04, -0.14], [-0.04, -0.21],
        [0.04, -0.21], [0.04, -0.14], [0.11, -0.14], [0.11, -0.21], [0.19, -0.21], [0.19, -0.08], [0.15, -0.08], [0.15, 0.17],
      ];
      return `<path d="M${pts.map(([dx, dy]) => `${x + dx} ${y + dy}`).join('L')}Z" ${st}/><path d="M${x - 0.05} ${y + 0.17}L${x - 0.05} ${y + 0.07}Q${x} ${y + 0.01} ${x + 0.05} ${y + 0.07}L${x + 0.05} ${y + 0.17}" ${st}/>`;
    }
    case 'B':
      return `<path d="M${x} ${y + 0.18}C${x - 0.2} ${y + 0.16} ${x - 0.16} ${y - 0.04} ${x - 0.04} ${y - 0.22}C${x - 0.02} ${y - 0.08} ${x + 0.08} ${y - 0.06} ${x + 0.08} ${y - 0.14}C${x + 0.2} ${y} ${x + 0.18} ${y + 0.16} ${x} ${y + 0.18}Z" ${st}/>`;
    default:
      return `<path d="M${x - 0.19} ${y + 0.14}L${x} ${y - 0.18}L${x + 0.19} ${y + 0.14}Z M${x} ${y + 0.14}L${x} ${y - 0.02}" ${st}/>`;
  }
}

function piece(kind: string, x: number, y: number): string {
  const o = Number(kind[0]);
  const k = kind[1] as Kind;
  const res = kind[2] === 'r';
  const fill = o === 0 ? 'url(#sh-w)' : 'url(#sh-b)';
  const ink = o === 0 ? '#5a3010' : '#f0d8a8';
  const big = k === 'P' ? 0.33 : 0.39;
  return `<ellipse cx="${x + 0.03}" cy="${y + 0.06}" rx="${big}" ry="${big * 0.9}" fill="rgba(0,0,0,0.35)"/><circle cx="${x}" cy="${y}" r="${big}" fill="${fill}" stroke="${o === 0 ? '#9a7a4a' : '#120802'}" stroke-width="0.03"${res ? ' opacity="0.85"' : ''}/><circle cx="${x}" cy="${y}" r="${big - 0.06}" fill="none" stroke="${ink}" stroke-width="0.015" opacity="0.5"/>${glyph(k, x, y, ink)}`;
}

class ShatraView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private s: State | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h('<div class="sh-info"></div>');
    ctx.controls.appendChild(this.info);
    if (!ctx.demo)
      ctx.controls.appendChild(
        h(`<div class="sh-hint">Фигуры в своей крепости и воротах — резерв: коснитесь такой фигуры и свободного поля своей половины, чтобы выставить. Бьют прыжком через чужую фигуру, как в шашках; бить обязательно (бию — по желанию).</div>`)
      );
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: () => N,
        size: () => [W, H],
        xy: (_s, p) => [X(p), Y(p)],
        board,
        pieces: (s) => s.board.flatMap((v, p) => (v ? [{ p, kind: `${v.o}${v.k}${s.reserve[v.o].includes(p) ? 'r' : ''}` }] : [])),
        piece: (_s, kind, x, y) => piece(kind, x, y),
        legal: (s, seat) => (s.turn === seat && !s.over ? legal(s) : []),
        spot: (a) => (a.type === 'move' ? { from: a.path[0], to: a.path[a.path.length - 1] } : a.type === 'drop' ? { from: a.from, to: a.to } : null),
        label: (a) => (a.type === 'promote' ? `Шатра становится: ${KIND_RU[a.kind]}` : ''),
        hit: 0.48,
        ring: 0.44,
      },
      'sh-wrap'
    );
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const lost = (o: number) => s.lost[o].length;
    this.info.innerHTML = `Срублено: у белых <b>${lost(0)}</b>, у чёрных <b>${lost(1)}</b><small>в резерве: белые ${s.reserve[0].length}, чёрные ${s.reserve[1].length}${s.quiet > 20 ? ` · без взятий ${Math.floor(s.quiet / 2)} ходов` : ''}</small>`;
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last ?? []);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    let cur: State = this.s ? { ...this.s, board: this.s.board.slice(), reserve: [this.s.reserve[0].slice(), this.s.reserve[1].slice()] } : v;
    const sp = () => this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'move' || ev.type === 'drop') {
        const path = ev.type === 'move' ? ev.path : [ev.from, ev.to];
        const p = cur.board[path[0]];
        for (let k = 1; k < path.length; k++) {
          const board = cur.board.slice();
          board[path[k]] = p;
          board[path[k - 1]] = null;
          const reserve: [number[], number[]] = [cur.reserve[0].filter((c) => c !== path[0]), cur.reserve[1].filter((c) => c !== path[0])];
          const after: State = { ...cur, board, reserve, last: path.slice(0, k + 1) };
          const kind = p ? `${p.o}${p.k}` : '0P';
          // взятые на этом прыжке
          const taken = ev.type === 'move' ? ev.taken.filter((c) => between(path[k - 1], path[k], c)) : [];
          const gone = taken.map((c) => ({ p: c, kind: `${cur.board[c]?.o}${cur.board[c]?.k}` }));
          for (const c of taken) board[c] = null;
          this.pb.show(after, { from: path[k - 1], to: path[k], kind }, gone);
          if (taken.length) Sound.capture();
          else Sound.step();
          await sleep(380 / sp());
          cur = after;
        }
      } else if (ev.type === 'promote') {
        Sound.win();
        await sleep(300 / sp());
      } else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.pb.mark(v.last ?? []);
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
    if (v.promote >= 0) return 'Выберите, кем станет шатра';
    return forcedCapture(v) ? 'Ваш ход — бить обязательно' : 'Ваш ход';
  }
}

/** Поле c лежит на отрезке a→b (строго между). */
function between(a: number, b: number, c: number): boolean {
  const A = CELLS[a];
  const B = CELLS[b];
  const C = CELLS[c];
  const dx = Math.sign(B.x - A.x);
  const dy = Math.sign(B.y - A.y);
  for (let x = A.x + dx, y = A.y + dy; x !== B.x || y !== B.y; x += dx, y += dy) if (x === C.x && y === C.y) return true;
  return false;
}

export function createView(): GameView<State, Event> {
  return new ShatraView();
}

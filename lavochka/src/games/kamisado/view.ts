/* Камисадо — отрисовка. Японский мотив, всё в коде: чёрная лаковая доска с золотой каймой (или светлое дерево
 * и рисовая бумага), клетки восьми насыщенных цветов, на каждой — свой значок (для тех, кто плохо различает цвета).
 * Башни — восьмигранники сверху: чёрный лак или золото, в середине — цветная вставка со значком своего цвета;
 * у сумо по краю золотые зубцы (сколько побед — столько зубцов). Обязательная башня выбирается сама. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { CELL, COLOR_GEN, COLOR_RU, legal as legalOf, N, RANK_RU, seatOf, towerId, where, type Action, type Event, type State } from './engine';
import './kamisado.css';

const M = 0.62;
const SIZE = N + 2 * M;
const CX = (p: number) => M + (p % N) + 0.5;
const CY = (p: number) => M + Math.floor(p / N) + 0.5;

/** Цвета клеток: основной, светлый, тёмный. */
const PAL: [string, string, string][] = [
  ['#e8731a', '#ffa860', '#9a4206'], // оранжевый
  ['#1d5cc4', '#5a94ec', '#0c2e6e'], // синий
  ['#6c2a96', '#a466cc', '#3a1058'], // фиолетовый
  ['#e2649e', '#f8a0c8', '#9a2c60'], // розовый
  ['#f0c419', '#ffe680', '#a07c00'], // жёлтый
  ['#cc1f28', '#f26068', '#700a10'], // красный
  ['#24883a', '#5cc06e', '#0e4a1c'], // зелёный
  ['#6e3c1c', '#a8704a', '#38180a'], // коричневый
];
/** Бумажный вид — краски чуть приглушённые. */
const PAPER: string[] = ['#e48a3e', '#3f6fb8', '#7a4c9c', '#de86ac', '#e8c64a', '#c2443c', '#4a8e52', '#86583a'];

/** Значок цвета: круг, волны, ромб, цветок, солнце, треугольник, лист, квадрат. r — размер. */
function glyph(c: number, x: number, y: number, r: number, fill: string, sw = r * 0.16): string {
  const st = `fill="none" stroke="${fill}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  switch (c) {
    case 0:
      return `<circle cx="${x}" cy="${y}" r="${r * 0.62}" ${st}/><circle cx="${x}" cy="${y}" r="${r * 0.18}" fill="${fill}"/>`;
    case 1: {
      let d = '';
      for (const k of [-0.38, 0.05, 0.48]) {
        const yy = y + k * r - 0.05 * r;
        d += `M${x - 0.7 * r} ${yy}q${0.35 * r} ${-0.32 * r} ${0.7 * r} 0t${0.7 * r} 0`;
      }
      return `<path d="${d}" ${st}/>`;
    }
    case 2:
      return `<path d="M${x} ${y - 0.72 * r}L${x + 0.6 * r} ${y}L${x} ${y + 0.72 * r}L${x - 0.6 * r} ${y}Z" ${st}/><path d="M${x} ${y - 0.3 * r}L${x + 0.25 * r} ${y}L${x} ${y + 0.3 * r}L${x - 0.25 * r} ${y}Z" fill="${fill}"/>`;
    case 3: {
      let o = '';
      for (let i = 0; i < 5; i++) {
        const a = (i * 72 - 90) * (Math.PI / 180);
        o += `<circle cx="${x + Math.cos(a) * 0.4 * r}" cy="${y + Math.sin(a) * 0.4 * r}" r="${0.26 * r}" ${st}/>`;
      }
      return o + `<circle cx="${x}" cy="${y}" r="${0.12 * r}" fill="${fill}"/>`;
    }
    case 4: {
      let d = '';
      for (let i = 0; i < 8; i++) {
        const a = i * (Math.PI / 4);
        d += `M${x + Math.cos(a) * 0.45 * r} ${y + Math.sin(a) * 0.45 * r}L${x + Math.cos(a) * 0.74 * r} ${y + Math.sin(a) * 0.74 * r}`;
      }
      return `<circle cx="${x}" cy="${y}" r="${0.26 * r}" fill="${fill}"/><path d="${d}" ${st}/>`;
    }
    case 5:
      return `<path d="M${x} ${y - 0.66 * r}L${x + 0.66 * r} ${y + 0.5 * r}L${x - 0.66 * r} ${y + 0.5 * r}Z" ${st}/>`;
    case 6:
      return `<path d="M${x - 0.55 * r} ${y + 0.55 * r}Q${x - 0.6 * r} ${y - 0.6 * r} ${x + 0.6 * r} ${y - 0.6 * r}Q${x + 0.6 * r} ${y + 0.55 * r} ${x - 0.55 * r} ${y + 0.55 * r}ZM${x - 0.55 * r} ${y + 0.55 * r}L${x + 0.2 * r} ${y - 0.2 * r}" ${st}/>`;
    default:
      return `<rect x="${x - 0.5 * r}" y="${y - 0.5 * r}" width="${r}" height="${r}" ${st}/><rect x="${x - 0.17 * r}" y="${y - 0.17 * r}" width="${0.34 * r}" height="${0.34 * r}" fill="${fill}"/>`;
  }
}

/** Восьмиугольник с центром (x, y) и «радиусом» r. */
function octagon(x: number, y: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = ((i * 45 + 22.5) * Math.PI) / 180;
    pts.push(`${(x + r * Math.cos(a)).toFixed(3)},${(y + r * Math.sin(a)).toFixed(3)}`);
  }
  return pts.join(' ');
}

function defs(): string {
  let g = '';
  PAL.forEach(([c, l, d], i) => {
    g += `<linearGradient id="km-c${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${l}"/><stop offset="0.35" stop-color="${c}"/><stop offset="1" stop-color="${d}"/></linearGradient>`;
  });
  return `<defs>${g}
    <linearGradient id="km-lac" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a1a14"/><stop offset="0.5" stop-color="#1a0a08"/><stop offset="1" stop-color="#060202"/></linearGradient>
    <linearGradient id="km-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset="0.45" stop-color="#d9a634"/><stop offset="1" stop-color="#7a5408"/></linearGradient>
    <linearGradient id="km-hinoki" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ead2a4"/><stop offset="1" stop-color="#c49a62"/></linearGradient>
    <radialGradient id="km-black" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#6a6470"/><stop offset="0.35" stop-color="#25222a"/><stop offset="1" stop-color="#050406"/></radialGradient>
    <radialGradient id="km-goldt" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#fff6c0"/><stop offset="0.4" stop-color="#e2b23e"/><stop offset="1" stop-color="#7a540c"/></radialGradient>
    <radialGradient id="km-sh" cx="50%" cy="50%" r="50%"><stop offset="0.55" stop-color="#000" stop-opacity="0.5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <filter id="km-paper" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="2.2" numOctaves="3" seed="3" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 0.97  0 0 0 0 0.9  0 0 0 0.28 -0.05" result="g"/>
      <feComposite in="g" in2="SourceGraphic" operator="in" result="t"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge>
    </filter>
    <filter id="km-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.3 4" numOctaves="2" seed="7" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.3  0 0 0 0 0.1  0 0 0 0.35 -0.08" result="g"/>
      <feComposite in="g" in2="SourceGraphic" operator="in" result="t"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge>
    </filter>
  </defs>`;
}

/** Волны сэйгайха по раме (лаковый вид). */
function seigaiha(x0: number, y0: number, w: number, hh: number): string {
  let o = '';
  const r = 0.16;
  for (let row = 0, y = y0 + r; y < y0 + hh + r; row++, y += r * 0.55)
    for (let x = x0 + (row % 2 ? r : 0); x < x0 + w + r; x += r * 2)
      o += `<path d="M${x - r} ${y}A${r} ${r} 0 0 1 ${x + r} ${y}" fill="none" stroke="#c9963a" stroke-width="0.012" opacity="0.35"/>`;
  return o;
}

function board(s: State): string {
  const W = SIZE;
  const paper = s.cfg.look === 'paper';
  let o = defs();
  if (paper) {
    o += `<rect x="0" y="0" width="${W}" height="${W}" rx="0.18" fill="url(#km-hinoki)" filter="url(#km-grain)"/>`;
    o += `<rect x="${M - 0.1}" y="${M - 0.1}" width="${N + 0.2}" height="${N + 0.2}" fill="#5a3a1c"/>`;
  } else {
    o += `<rect x="0" y="0" width="${W}" height="${W}" rx="0.22" fill="url(#km-lac)"/>`;
    o += `<clipPath id="km-fr"><path d="M0 0H${W}V${W}H0ZM${M - 0.14} ${M - 0.14}V${M + N + 0.14}H${M + N + 0.14}V${M - 0.14}Z" clip-rule="evenodd"/></clipPath>`;
    o += `<g clip-path="url(#km-fr)">${seigaiha(0, 0, W, W)}</g>`;
    o += `<rect x="0.12" y="0.12" width="${W - 0.24}" height="${W - 0.24}" rx="0.16" fill="none" stroke="url(#km-gold)" stroke-width="0.04"/>`;
    o += `<rect x="${M - 0.12}" y="${M - 0.12}" width="${N + 0.24}" height="${N + 0.24}" fill="#0a0404" stroke="url(#km-gold)" stroke-width="0.05"/>`;
  }
  for (let p = 0; p < N * N; p++) {
    const c = CELL[p];
    const x = M + (p % N);
    const y = M + Math.floor(p / N);
    if (paper) {
      o += `<rect x="${x + 0.03}" y="${y + 0.03}" width="0.94" height="0.94" fill="${PAPER[c]}" filter="url(#km-paper)"/>`;
      o += glyph(c, x + 0.5, y + 0.5, 0.34, '#fff8e8', 0.05);
    } else {
      o += `<rect x="${x + 0.035}" y="${y + 0.035}" width="0.93" height="0.93" rx="0.05" fill="url(#km-c${c})"/>`;
      o += `<rect x="${x + 0.035}" y="${y + 0.035}" width="0.93" height="0.4" rx="0.05" fill="#fff" opacity="0.08"/>`;
      o += glyph(c, x + 0.5, y + 0.5, 0.34, c === 4 ? '#7a5a00' : '#ffffff', 0.05).replace(/<(path|circle|rect)/g, '<$1 opacity="0.42"');
    }
  }
  return o;
}

/** Башня: kind = "id:ранг". */
function tower(kind: string, x: number, y: number): string {
  const [ids, rs] = kind.split(':');
  const id = Number(ids);
  const r = Number(rs);
  const seat = seatOf(id);
  const c = id % 8;
  const R = 0.4;
  const body = seat === 0 ? 'url(#km-black)' : 'url(#km-goldt)';
  const edge = seat === 0 ? '#000' : '#5a3c04';
  let o = `<ellipse cx="${x + 0.05}" cy="${y + 0.08}" rx="${R * 1.02}" ry="${R}" fill="url(#km-sh)"/>`;
  o += `<polygon points="${octagon(x, y, R)}" fill="${body}" stroke="${edge}" stroke-width="0.025"/>`;
  o += `<polygon points="${octagon(x, y, R * 0.84)}" fill="none" stroke="${seat === 0 ? '#8a7a50' : '#fff3c0'}" stroke-width="0.012" opacity="0.7"/>`;
  // зубцы сумо — треугольники по верхнему краю, наружу
  const n = Math.min(4, r);
  for (let i = 0; i < n; i++) {
    const a = ((-90 + (i - (n - 1) / 2) * 30) * Math.PI) / 180;
    const bx = x + Math.cos(a) * R * 0.8;
    const by = y + Math.sin(a) * R * 0.8;
    const tx = x + Math.cos(a) * R * 1.28;
    const ty = y + Math.sin(a) * R * 1.28;
    const px = -Math.sin(a) * 0.075;
    const py = Math.cos(a) * 0.075;
    o += `<path d="M${bx + px} ${by + py}L${tx} ${ty}L${bx - px} ${by - py}Z" fill="${seat === 0 ? '#f2c443' : '#d42a30'}" stroke="${seat === 0 ? '#5a3c04' : '#fff3c0'}" stroke-width="0.018" stroke-linejoin="round"/>`;
  }
  const [cc, cl, cd] = PAL[c];
  o += `<circle cx="${x}" cy="${y}" r="${R * 0.64}" fill="${cd}"/>`;
  o += `<circle cx="${x}" cy="${y}" r="${R * 0.58}" fill="${cc}" stroke="${cl}" stroke-width="0.015"/>`;
  o += glyph(c, x, y, R * 0.48, c === 4 ? '#5a4000' : '#fff', 0.035);
  o += `<ellipse cx="${x - R * 0.35}" cy="${y - R * 0.5}" rx="${R * 0.3}" ry="${R * 0.1}" fill="#fff" opacity="${seat === 0 ? 0.25 : 0.45}"/>`;
  return o;
}

const kindAt = (s: State, p: number) => `${s.board[p]}:${s.rank[s.board[p]]}`;

/** Кружок-образец цвета для подписей. */
const swatch = (c: number) => `<span class="km-sw" style="background:${PAL[c][0]}"></span>`;

class KamisadoView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private s: State | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="km-info"></div>`);
    ctx.controls.appendChild(this.info);
    if (!ctx.demo)
      ctx.controls.appendChild(
        h(`<div class="km-hint">Ходите башней, которая подсвечена (в начале раунда — любой), на клетку вперёд — прямо или по косой. Цвет клетки, куда вы встанете, решит, какой башней пойдёт соперник.</div>`)
      );
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: () => N * N,
        size: () => [SIZE, SIZE],
        xy: (_s, p) => [CX(p), CY(p)],
        board,
        pieces: (s) => s.board.flatMap((v, p) => (v >= 0 ? [{ p, kind: kindAt(s, p) }] : [])),
        piece: (_s, kind, x, y) => tower(kind, x, y),
        legal: (s, seat) => (s.turn === seat && !s.over ? legalOf(s) : []),
        spot: (a) => (a.type === 'move' ? { from: a.from, to: a.to } : null),
        label: (a) => (a.type === 'fill' ? (a.side === 'right' ? 'Расставить справа →' : '← Расставить слева') : ''),
        hit: 0.5,
        ring: 0.44,
      },
      'km-wrap'
    );
  }

  private text() {
    const s = this.s;
    if (!s) return;
    let t = '';
    if (s.cfg.target > 1) t += `<div>Серия до ${s.cfg.target} · счёт <b>${s.score[0]} : ${s.score[1]}</b> · раунд ${s.round + 1}</div>`;
    if (!s.over && s.phase === 'move') {
      if (s.forced < 0) t += `<div>${this.ctx.name(s.turn)} начинают раунд — любой башней</div>`;
      else {
        const p = where(s, towerId(s.turn, s.forced));
        const r = p >= 0 ? s.rank[s.board[p]] : 0;
        t += `<div>${swatch(s.forced)} Ходит ${COLOR_RU[s.forced]} башня (${this.ctx.name(s.turn).toLowerCase()})${r ? ` — ${RANK_RU[r]}` : ''}</div>`;
      }
    } else if (!s.over) t += `<div>${this.ctx.name(s.turn)} выбирают расстановку нового раунда</div>`;
    const sumo = s.rank.map((r, id) => (r ? `${id < 8 ? '⚫' : '🟡'}${swatch(id % 8)}${RANK_RU[Math.min(4, r)]}` : '')).filter(Boolean);
    if (sumo.length) t += `<small>${sumo.join(' · ')}</small>`;
    this.info.innerHTML = t;
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    let cur: State = this.s ? { ...this.s, board: this.s.board.slice() } : v;
    const sp = () => this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'move' || ev.type === 'push') {
        const board = cur.board.slice();
        if (ev.type === 'push') {
          for (const q of [...ev.pushed].reverse()) {
            board[q.to] = board[q.from];
            board[q.from] = -1;
          }
          Sound.capture();
        }
        const id = board[ev.from];
        board[ev.to] = id;
        board[ev.from] = -1;
        const after: State = { ...cur, board, last: [ev.from, ev.to] };
        if (ev.type === 'push') {
          const q = ev.pushed[0];
          this.pb.show({ ...after }, { from: q.from, to: q.to, kind: kindAt(after, q.to) });
          await sleep(260 / sp());
        }
        this.pb.show(after, { from: ev.from, to: ev.to, kind: kindAt(after, ev.to) });
        Sound.step();
        await sleep(360 / sp());
        cur = after;
      } else if (ev.type === 'pass') {
        this.pb.mark([ev.at]);
        this.pb.set(cur);
        Sound.ui();
        await sleep(700 / sp());
      } else if (ev.type === 'round') {
        Sound.win();
        await sleep(1000 / sp());
      } else if (ev.type === 'fill') {
        this.pb.mark([]);
        this.pb.set(v);
        Sound.step();
        await sleep(400 / sp());
      }
    }
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.pb.turn(s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null);
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Конец' : `Победа: ${this.ctx.name(v.winner)}`;
    if (!interactive.includes(toAct[0])) return `Ходят ${this.ctx.name(toAct[0])}…`;
    if (v.phase === 'fill') return 'Раунд ваш — выберите расстановку';
    if (v.forced < 0) return 'Ваш ход — любой башней';
    return `Ваш ход — башней ${COLOR_GEN[v.forced]} цвета`;
  }
}

export function createView(): GameView<State, Event> {
  return new KamisadoView();
}

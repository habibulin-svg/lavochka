/* Сальто — отрисовка на общей доске PointBoard. Доска — та же складная шашечная, что в «Шашках» (клён и орех в рамке
 * из морёного дерева, лак, шов посередине), только 10×10 или 8×8. Фишки — точёные, крашеные зелёным и красным лаком,
 * с выпуклыми знаками солнца, луны и звезды и номером, как в старинных наборах Сальто; в «Пирамиде» — без знаков.
 * Нажатая фишка показывает обводкой своё место. Доска повёрнута так, чтобы ваши фишки были внизу. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { woodTexture, WOODS } from '../../core/wood';
import { camp, isDark, moves, type Action, type Event, type Piece, type State } from './engine';
import { SEATS } from './def';
import './salta.css';

const F = 0.62; // рамка вокруг поля, в клетках
const R = 0.41; // радиус фишки

let boards = 0;
/** Текстуры — как у «Шашек»: те же породы и зёрна. */
let tex: { light: string; dark: string; frame: string; grain: string } | null = null;
function textures() {
  tex ??= {
    light: woodTexture(WOODS.maple, 256, 31),
    dark: woodTexture(WOODS.walnut, 256, 17),
    frame: woodTexture(WOODS.stained, 512, 5, false),
    grain: woodTexture(WOODS.maple, 128, 3),
  };
  return tex;
}

/** Пятиконечная звезда. */
function star(ro: number, ri: number, cy = 0): string {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? ri : ro;
    d += `${i ? 'L' : 'M'}${(r * Math.cos(a)).toFixed(3)} ${(cy + r * Math.sin(a)).toFixed(3)}`;
  }
  return d + 'Z';
}
/** Солнце: круг и двенадцать лучей. */
function sun(): string {
  let d = 'M0.165 0A0.165 0.165 0 1 1 -0.165 0A0.165 0.165 0 1 1 0.165 0Z';
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const b = 0.09;
    const p = (r: number, da: number) => `${(r * Math.cos(a + da)).toFixed(3)} ${(r * Math.sin(a + da)).toFixed(3)}`;
    d += `M${p(0.2, -b)}L${p(0.335, 0)}L${p(0.2, b)}Z`;
  }
  return d;
}
/** Месяц рожками вправо, номер — в его выемке. */
const MOON = 'M0.162 -0.216A0.27 0.27 0 1 0 0.162 0.216A0.22 0.22 0 1 1 0.162 -0.216Z';
const SYM_PATH = { star: star(0.34, 0.165, 0.01), sun: sun(), moon: MOON, plain: '' };
/** Где номер: в середине знака (у месяца — в выемке). */
const NUM_AT = { star: [0, 0.035], sun: [0, 0.01], moon: [0.13, 0.01], plain: [0, 0] };

class SaltaView implements GameView<State, Event> {
  private uid = `sa${++boards}`;
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private s: State | null = null;

  private get flip() {
    return this.ctx.mySeats.includes(1) && !this.ctx.mySeats.includes(0);
  }
  private xy(s: State, p: number): [number, number] {
    const f = p % s.n;
    const r = Math.floor(p / s.n);
    return [F + (this.flip ? s.n - 1 - f : f) + 0.5, F + (this.flip ? r : s.n - 1 - r) + 0.5];
  }

  private board(s: State): string {
    const n = s.n;
    const W = n + 2 * F;
    const t = textures();
    const u = this.uid;
    let o = `<defs>
      <pattern id="${u}L" patternUnits="userSpaceOnUse" width="2" height="2"><image href="${t.light}" width="2" height="2" preserveAspectRatio="none"/></pattern>
      <pattern id="${u}D" patternUnits="userSpaceOnUse" width="2" height="2"><image href="${t.dark}" width="2" height="2" preserveAspectRatio="none"/></pattern>
      <pattern id="${u}G" patternUnits="objectBoundingBox" width="1" height="1"><image href="${t.grain}" width="${2 * R}" height="${2 * R}" preserveAspectRatio="none"/></pattern>
      <linearGradient id="${u}Lac" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient>
      <radialGradient id="${u}Gloss" cx="34%" cy="28%" r="55%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".35" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <radialGradient id="${u}Bevel" cx="50%" cy="50%" r="50%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset=".86" stop-color="#000" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
      ${SEATS.map((st, i) => `<radialGradient id="${u}P${i}" cx="40%" cy="36%" r="68%"><stop offset="0" stop-color="${st.light}"/><stop offset=".55" stop-color="${st.color}"/><stop offset="1" stop-color="${st.dark}"/></radialGradient>`).join('')}
      <filter id="${u}Sh" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0.04" dy="0.06" stdDeviation="0.045" flood-color="#0d0502" flood-opacity=".65"/></filter>
      <clipPath id="${u}Round"><rect width="${W}" height="${W}" rx="0.22"/></clipPath>
    </defs>`;
    o += `<rect width="${W}" height="${W}" rx="0.22" fill="#2a1408"/><image href="${t.frame}" width="${W}" height="${W}" preserveAspectRatio="none" opacity=".95" clip-path="url(#${u}Round)"/>`;
    o += `<rect x="${F - 0.09}" y="${F - 0.09}" width="${n + 0.18}" height="${n + 0.18}" rx="0.05" fill="#1a0c04"/>`;
    for (let p = 0; p < n * n; p++) {
      const [x, y] = this.xy(s, p);
      o += `<rect x="${x - 0.5}" y="${y - 0.5}" width="1" height="1" fill="url(#${u}${isDark(n, p) ? 'D' : 'L'})"/>`;
    }
    o += `<rect x="${F}" y="${F}" width="${n}" height="${n}" fill="url(#${u}Lac)"/>`;
    // шов складной доски
    o += `<rect x="${W / 2 - 0.045}" y="${F - 0.09}" width="0.09" height="${n + 0.18}" fill="#0d0502" opacity=".35"/>`;
    // буквы и цифры на рамке
    for (let i = 0; i < n; i++) {
      const file = 'abcdefghij'[this.flip ? n - 1 - i : i];
      const rank = String(this.flip ? i + 1 : n - i);
      const c = F + i + 0.5;
      o += `<text class="sa-coord" x="${c}" y="${W - F / 2}">${file}</text><text class="sa-coord" x="${c}" y="${F / 2}">${file}</text>`;
      o += `<text class="sa-coord" x="${F / 2}" y="${c}">${rank}</text><text class="sa-coord" x="${W - F / 2}" y="${c}">${rank}</text>`;
    }
    return o;
  }

  /** Знак с номером — выпуклый: тень снизу-справа, блик сверху-слева. */
  private emblem(pc: Piece, ink: string, hi: string): string {
    const path = SYM_PATH[pc.sym];
    const [nx, ny] = NUM_AT[pc.sym];
    const num = pc.sym === 'plain' ? '' : String(pc.num);
    const layer = (dx: number, dy: number, fill: string, op: number) => `<text class="sa-num" x="${nx + dx}" y="${ny + dy}" fill="${fill}" opacity="${op}">${num}</text>`;
    if (pc.sym === 'plain')
      return `<circle r="0.12" fill="#000" opacity=".35" transform="translate(0.015 0.02)"/><circle r="0.12" fill="${hi}" opacity=".5" transform="translate(-0.012 -0.012)"/><circle r="0.12" fill="${ink}"/>`;
    // номер на знаке — тёмный, вдавленный в выпуклость
    const sym = (dx: number, dy: number, fill: string, op: number) => `<path d="${path}" fill="${fill}" opacity="${op}" transform="translate(${dx} ${dy})"/>`;
    return (
      sym(0.018, 0.024, '#000', 0.5) +
      sym(-0.012, -0.014, hi, 0.75) +
      sym(0, 0, ink, 1) +
      (num ? layer(-0.008, -0.01, '#000', 0.45) + layer(0.008, 0.012, hi, 0.35) + `<text class="sa-num" x="${nx}" y="${ny}" fill="${SEATS[pc.seat].dark}">${num}</text>` : '')
    );
  }

  private piece(s: State, kind: string, x: number, y: number): string {
    const pc = s.pieces[Number(kind)];
    const u = this.uid;
    const st = SEATS[pc.seat];
    const rot = (Number(kind) * 47) % 360;
    // знак — золотистый по зелёному, кремовый по красному
    const ink = pc.seat === 0 ? '#e8d48a' : '#f3e0b8';
    return `<g transform="translate(${x} ${y})"><g filter="url(#${u}Sh)">
      <circle r="${R}" fill="${st.dark}"/>
      <circle r="${R - 0.025}" fill="url(#${u}P${pc.seat})"/>
      <circle r="${R - 0.025}" fill="url(#${u}G)" opacity=".22" transform="rotate(${rot})" style="mix-blend-mode:multiply"/>
      <circle r="${R - 0.025}" fill="url(#${u}Bevel)"/>
      <circle r="${R * 0.86}" fill="none" stroke="#000" stroke-width="0.022" opacity=".35"/>
      <circle r="${R * 0.86 + 0.02}" fill="none" stroke="#fff" stroke-width="0.014" opacity=".3"/>
      ${this.emblem(pc, ink, '#fffbe8')}
      <circle r="${R - 0.025}" fill="url(#${u}Gloss)"/>
    </g></g>`;
  }

  /** Обводка места выбранной (или под мышью) своей фишки. */
  private extra(s: State): string {
    if (s.cfg.mode !== 'salta') return '';
    let p = this.pb.selected;
    if (p < 0) p = this.pb.hovered;
    const id = p >= 0 ? s.board[p] : -1;
    if (id < 0) return '';
    const pc = s.pieces[id];
    if (pc.tgt === p) return '';
    const [x, y] = this.xy(s, pc.tgt);
    const col = SEATS[pc.seat].light;
    return `<g class="sa-tgt" transform="translate(${x} ${y})"><circle r="${R}" fill="none" stroke="${col}" stroke-width="0.05" stroke-dasharray="0.12 0.08"/>
      <path d="${SYM_PATH[pc.sym]}" fill="${col}" opacity=".5"/><text class="sa-num" x="${NUM_AT[pc.sym][0]}" y="${NUM_AT[pc.sym][1]}" fill="${SEATS[pc.seat].dark}" opacity=".8">${pc.num}</text></g>`;
  }

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h('<div class="sa-info"></div>');
    // в показе правил панель тёмная и тесная — счёт там не нужен
    if (!ctx.demo) ctx.controls.appendChild(this.info);
    if (!ctx.demo) ctx.controls.appendChild(h('<div class="hint small-hint">Нажмите на свою фишку — обводкой покажется её место; потом — на подсвеченное поле. Если есть прыжок, прыгать обязательно.</div>'));
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: (s) => s.n * s.n,
        size: (s) => [s.n + 2 * F, s.n + 2 * F],
        xy: (s, p) => this.xy(s, p),
        board: (s) => this.board(s),
        pieces: (s) => s.board.flatMap((id, p) => (id >= 0 ? [{ p, kind: String(id) }] : [])),
        piece: (s, kind, x, y) => this.piece(s, kind, x, y),
        legal: (s, seat) => (s.turn !== seat || s.over ? [] : moves(s, seat).length ? moves(s, seat).map((m) => ({ type: 'move', from: m.from, to: m.to }) as Action) : [{ type: 'pass' }]),
        spot: (a) => (a.type === 'move' ? { from: a.from, to: a.to } : null),
        zoom: true,
        label: () => 'Ходить некуда — пропустить ход',
        hit: 0.5,
        ring: 0.45,
      },
      'sa-wrap'
    );
    this.pb.extra = (s) => this.extra(s);
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const total = s.pieces.length / 2;
    const done = (seat: number) =>
      s.cfg.mode === 'salta' ? s.pieces.filter((pc, id) => pc.seat === seat && s.board[pc.tgt] === id).length : camp(s.n, 'pyramid', 1 - seat).filter((p) => s.board[p] >= 0 && s.pieces[s.board[p]].seat === seat).length;
    let o = [0, 1].map((x) => `<div><i class="sa-dot" style="background:${SEATS[x].color}"></i>${this.ctx.name(x)}: на местах ${done(x)} из ${total}</div>`).join('');
    if (s.cfg.limit) o += `<div class="sa-moves">Ход ${Math.min(s.cfg.limit, Math.max(s.made[0], s.made[1]) + (s.turn === 0 ? 1 : 0))} из ${s.cfg.limit}</div>`;
    if (s.left) o += `<div class="sa-moves">Осталось шагов: ${this.ctx.name(0)} — ${s.left[0]}, ${this.ctx.name(1)} — ${s.left[1]}</div>`;
    this.info.innerHTML = o;
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last ? [v.last[0], v.last[v.last.length - 1]] : []);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    let cur = this.s ?? v;
    for (const ev of events) {
      if (ev.type === 'move') {
        for (let k = 1; k < ev.path.length; k++) {
          const board = cur.board.slice();
          const id = board[ev.path[k - 1]];
          board[ev.path[k - 1]] = -1;
          board[ev.path[k]] = id;
          const after: State = { ...cur, board, last: ev.path.slice(0, k + 1) };
          this.pb.mark([ev.path[k - 1], ev.path[k]]);
          this.pb.show(after, { from: ev.path[k - 1], to: ev.path[k], kind: String(id) });
          Sound.place();
          await sleep((ev.jump ? 340 : 300) / this.ctx.speed());
          cur = after;
        }
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
    if (!interactive.includes(who)) return `Ходят ${this.ctx.name(who)}…`;
    return v.cfg.mode === 'salta' && moves(v, who).some((m) => m.jump) ? 'Ваш ход — сальто! Прыгать обязательно' : 'Ваш ход';
  }
}

export function createView(): GameView<State, Event> {
  return new SaltaView();
}

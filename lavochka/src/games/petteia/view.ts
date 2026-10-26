/* Петтейя и латрункули — отрисовка. Доска — плита с процарапанной сеткой: мрамор (греческая) или обожжённая глина,
 * как римская черепица с игровым полем (картинки tools/petteia — фактуры, сетку и сколы рисует код). Фишки — речные
 * камешки (белый кварцит и чёрный базальт) или римские стеклянные «пешки» (молочное и тёмно-синее стекло);
 * дукс — та же фишка с золочёным венком. Стол — каменные плиты форума. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { count, isDux, legal, rulesOf, sideOf, type Action, type Event, type State } from './engine';
import './petteia.css';

const TEX = `${import.meta.env.BASE_URL}tex/petteia/`;
const F = 0.55; // поле плиты вокруг сетки

const cx = (s: State, p: number) => F + (p % s.w) + 0.5;
const cy = (s: State, p: number) => F + Math.floor(p / s.w) + 0.5;

/** Псевдослучайное по номеру — чтобы царапины и сколы не прыгали от хода к ходу. */
function hash(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Процарапанная линия: слегка дрожит и прерывается. */
function scratch(x1: number, y1: number, x2: number, y2: number, seed: number): string {
  const n = Math.max(3, Math.round(Math.hypot(x2 - x1, y2 - y1) * 2));
  let d = '';
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const j = (hash(seed * 31 + i) - 0.5) * 0.02;
    const x = x1 + (x2 - x1) * t + (y1 === y2 ? 0 : j);
    const y = y1 + (y2 - y1) * t + (x1 === x2 ? 0 : j);
    d += `${i ? 'L' : 'M'}${x.toFixed(3)} ${y.toFixed(3)}`;
  }
  return d;
}

function board(s: State): string {
  const W = s.w + 2 * F;
  const H = s.h + 2 * F;
  const clay = s.cfg.look === 'clay';
  const tex = clay ? 'clay' : 'marble';
  // неровный край плиты: точки по периметру со сколами
  const pts: string[] = [];
  const side = (x1: number, y1: number, x2: number, y2: number, k: number) => {
    const n = Math.round(Math.hypot(x2 - x1, y2 - y1) * 1.5);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const chip = hash(k * 101 + i) > 0.86 ? 0.07 + hash(k * 7 + i) * 0.06 : hash(k * 13 + i) * 0.025;
      const nx = y1 === y2 ? 0 : x1 < 0.1 ? 1 : -1;
      const ny = x1 === x2 ? 0 : y1 < 0.1 ? 1 : -1;
      pts.push(`${(x1 + (x2 - x1) * t + nx * chip).toFixed(3)},${(y1 + (y2 - y1) * t + ny * chip).toFixed(3)}`);
    }
  };
  side(0.04, 0.04, W - 0.04, 0.04, 1);
  side(W - 0.04, 0.04, W - 0.04, H - 0.04, 2);
  side(W - 0.04, H - 0.04, 0.04, H - 0.04, 3);
  side(0.04, H - 0.04, 0.04, 0.04, 4);
  const poly = pts.join(' ');
  let o = `<defs>
    <pattern id="pt-tex" patternUnits="userSpaceOnUse" width="${W}" height="${H}"><image href="${TEX}${tex}.webp" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/></pattern>
    <linearGradient id="pt-light" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.18"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.22"/></linearGradient>
    <radialGradient id="pt-gold" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff2b0"/><stop offset="0.5" stop-color="#d4a83a"/><stop offset="1" stop-color="#7a5410"/></radialGradient>
  </defs>`;
  // толщина плиты — тёмная подложка со сдвигом
  o += `<polygon points="${poly}" fill="${clay ? '#5a2410' : '#7a7266'}" transform="translate(0.03 0.09)"/>`;
  o += `<polygon points="${poly}" fill="url(#pt-tex)" stroke="${clay ? '#6a2c12' : '#a49a8a'}" stroke-width="0.03"/>`;
  // глина — потеплее; мрамор — чуть притемнить и согреть, чтобы белые камешки на нём читались
  o += `<polygon points="${poly}" fill="${clay ? '#b0501c' : '#8a7458'}" opacity="${clay ? 0.12 : 0.22}"/>`;
  o += `<polygon points="${poly}" fill="url(#pt-light)"/>`;
  // сетка: тёмная бороздка и светлая кромка ниже-правее
  let grid = '';
  let k = 0;
  for (let i = 0; i <= s.w; i++) grid += scratch(F + i, F - 0.06, F + i, F + s.h + 0.06, k++);
  for (let j = 0; j <= s.h; j++) grid += scratch(F - 0.06, F + j, F + s.w + 0.06, F + j, k++);
  const ink = clay ? '#3a1404' : '#4a4238';
  const edge = clay ? '#f0a070' : '#ffffff';
  o += `<path d="${grid}" fill="none" stroke="${edge}" stroke-opacity="0.45" stroke-width="0.045" transform="translate(0.018 0.022)" stroke-linecap="round"/>`;
  o += `<path d="${grid}" fill="none" stroke="${ink}" stroke-opacity="0.85" stroke-width="0.04" stroke-linecap="round"/>`;
  // у римской плитки — оттиск пальца в углу поля и клеймо-полоска, как на настоящих черепицах
  if (clay) {
    o += `<ellipse cx="${W - F / 2}" cy="${H - F / 2}" rx="0.17" ry="0.12" fill="#3a1404" opacity="0.18"/>`;
    o += `<ellipse cx="${F / 2}" cy="${F / 2}" rx="0.15" ry="0.11" fill="#3a1404" opacity="0.15" transform="rotate(30 ${F / 2} ${F / 2})"/>`;
  }
  return o;
}

function piece(s: State, kind: string, x: number, y: number): string {
  const glass = s.cfg.look === 'clay';
  const light = kind === 'w' || kind === 'W';
  const img = glass ? (light ? 'gw' : 'gb') : light ? 'pw' : 'pb';
  const r = 0.43;
  let o = `<ellipse cx="${x + 0.04}" cy="${y + 0.07}" rx="${r * 0.9}" ry="${r * 0.82}" fill="#000" opacity="0.28"/><image href="${TEX}${img}.webp" x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}"/>`;
  if (kind === 'W' || kind === 'B') {
    // дукс: золочёный лавровый венок
    let leaves = '';
    for (let i = 0; i < 14; i++) {
      if (i === 0 || i === 13) continue;
      const a = (i / 14) * Math.PI * 2 + Math.PI / 2;
      const lx = x + Math.cos(a) * 0.24;
      const ly = y + Math.sin(a) * 0.24;
      const deg = (a * 180) / Math.PI + (i < 7 ? 60 : -60);
      leaves += `<ellipse cx="${lx.toFixed(3)}" cy="${ly.toFixed(3)}" rx="0.065" ry="0.028" transform="rotate(${deg.toFixed(1)} ${lx.toFixed(3)} ${ly.toFixed(3)})"/>`;
    }
    o += `<g fill="url(#pt-gold)" stroke="#5a3a08" stroke-width="0.01">${leaves}</g><circle cx="${x}" cy="${y}" r="0.07" fill="url(#pt-gold)" stroke="#5a3a08" stroke-width="0.012"/>`;
  }
  return o;
}

const kindOf = (v: number) => (sideOf(v) === 0 ? (isDux(v) ? 'W' : 'w') : isDux(v) ? 'B' : 'b');

class PetteiaView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private hint!: HTMLElement;
  private s: State | null = null;
  private scatterBtn!: HTMLButtonElement;
  private mySeat: number | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="pt-info"></div>`);
    ctx.controls.appendChild(this.info);
    this.hint = h(`<div class="pt-hint"></div>`);
    if (!ctx.demo) ctx.controls.appendChild(this.hint);
    // расставлять 16–17 фишек щелчками долго — можно разом, случайно на своей половине
    this.scatterBtn = h<HTMLButtonElement>(`<button class="btn pt-scatter" hidden>Расставить случайно</button>`);
    this.scatterBtn.onclick = () => {
      if (this.mySeat == null) return;
      this.scatterBtn.hidden = true;
      this.ctx.act(this.mySeat, { type: 'scatter' });
    };
    if (!ctx.demo) ctx.controls.appendChild(this.scatterBtn);
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: (s) => s.w * s.h,
        size: (s) => [s.w + 2 * F, s.h + 2 * F],
        xy: (s, p) => [cx(s, p), cy(s, p)],
        board,
        pieces: (s) => s.board.flatMap((v, p) => (v ? [{ p, kind: kindOf(v) }] : [])),
        piece: (s, kind, x, y) => piece(s, kind, x, y),
        legal: (s, seat) => (s.turn === seat ? legal(s) : []),
        spot: (a) => (a.type === 'move' ? { from: a.from, to: a.to } : a.type === 'place' ? { to: a.to } : null),
        label: () => 'Хватит прыгать',
        hit: 0.5,
        ring: 0.44,
      },
      'pt-wrap'
    );
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const R = rulesOf(s);
    if (s.phase === 'place') {
      const left = (q: number) => s.hand[q] + (s.duxHand[q] ? 1 : 0);
      this.info.innerHTML = `<div>Расстановка: осталось выставить — ${this.ctx.name(0)} <b>${left(0)}</b>, ${this.ctx.name(1)} <b>${left(1)}</b></div>`;
      const dux = s.hand[s.turn] === 0 && s.duxHand[s.turn];
      this.hint.textContent = dux ? 'Поставьте дукса (фишку с венком) на любую свободную клетку.' : `Ставьте фишки на любые свободные клетки${R.perTurn > 1 ? ' — по две за ход' : ''}. Брать в расстановке нельзя.`;
      return;
    }
    this.info.innerHTML = `<div>На доске: ${this.ctx.name(0)} <b>${count(s, 0)}</b>, ${this.ctx.name(1)} <b>${count(s, 1)}</b></div><small>Без взятий ${s.quiet} из ${R.quiet} полуходов</small>`;
    const how = R.move === 'rook' ? 'по прямой на сколько угодно клеток' : R.jump === 'all' ? 'на соседнюю клетку или прыжком через фишку' : 'на соседнюю клетку';
    this.hint.textContent = s.chain >= 0 ? 'Можно прыгать дальше той же фишкой — или «Хватит прыгать».' : `Нажмите на свою фишку, потом на клетку: ход ${how}. Чужую берут, зажав с двух сторон.`;
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'place') {
        this.pb.show(v, null, [], ev.to);
        Sound.step();
        await sleep((events.length > 3 ? 70 : 220) / this.ctx.speed());
      } else if (ev.type === 'move' || ev.type === 'stop') {
        const taken = ev.taken.map((p) => ({ p, kind: ev.seat === 0 ? 'b' : 'w' }));
        if (ev.type === 'move') this.pb.show(v, { from: ev.from, to: ev.to, kind: kindOf(ev.piece) }, taken);
        else this.pb.show(v, null, taken);
        Sound.step();
        if (taken.length) setTimeout(() => Sound.capture(), 280);
        await sleep((taken.length ? 560 : 360) / this.ctx.speed());
      } else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.mySeat = s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    this.pb.turn(this.mySeat);
    this.scatterBtn.hidden = !(s && s.phase === 'place' && this.mySeat != null);
    this.text();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : `Победа: ${this.ctx.name(v.winner)}`;
    const mine = interactive.includes(toAct[0]);
    if (v.phase === 'place') return mine ? 'Расставляйте фишки' : `Расставляют ${this.ctx.name(toAct[0])}…`;
    return mine ? 'Ваш ход' : `Ходят ${this.ctx.name(toAct[0])}…`;
  }
}

export function createView(): GameView<State, Event> {
  return new PetteiaView();
}

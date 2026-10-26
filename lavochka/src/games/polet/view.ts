/* «Полёт» — отрисовка. Поле — плакат из коробки, склеенный из четырёх снимков и выпрямленный (public/polet/board.webp,
 * 2400×1920), пульт — фото пульта (dial.webp) с нарисованной поверх стрелкой, фишки — красный самолётик с фото, другим
 * игрокам — перекрашенный. Ход: «Крутить стрелку», затем касание подсвеченной точки — самолёт перелетает туда.
 * Вопрос — карточка с пиктограммой, вырезанной из того же поля, и вариантами ответа кнопками. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { ALT, COURSE, legal, numOf, pointOf, SPEED, TASKS, walk, type Action, type Event, type State } from './engine';
import { LEGS, PTS } from './map';
import './polet.css';

const BASE = `${import.meta.env.BASE_URL}polet/`;
const W = 2400;
const H = 1920;
/** Оттенки самолётиков: родной красный, синий, зелёный. */
const HUE = [0, 210, 120];
/** Пиктограммы на поле: [x, y, w, h]. */
const PIC_LAND: [number, number, number, number][] = [
  [1477, 1560, 113, 113],
  [1648, 1570, 112, 110],
  [1820, 1570, 113, 110],
  [1992, 1570, 110, 110],
  [2160, 1570, 112, 110],
];
const PIC_WATER: [number, number, number, number][] = [
  [133, 1117, 114, 105],
  [303, 1117, 115, 105],
  [477, 1117, 114, 105],
  [650, 1117, 113, 105],
];

class PoletView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private dial!: HTMLElement;
  private needle!: SVGGElement;
  private card!: HTMLElement;
  private info!: HTMLElement;
  private s: State | null = null;
  private angle = 0;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.dial = h(`<div class="pl-dial"><svg viewBox="0 0 570 570"><image href="${BASE}dial.webp" x="0" y="0" width="570" height="570"/>
      <g class="pl-needle" transform="rotate(0 285 285)"><path d="M285,72 L297,285 L285,320 L273,285 Z" fill="#d42a1a" stroke="#5a0a04" stroke-width="3"/>
      <circle cx="285" cy="285" r="24" fill="#d8d8d0" stroke="#555" stroke-width="3"/><circle cx="285" cy="285" r="8" fill="#888"/></g></svg></div>`);
    this.needle = this.dial.querySelector('.pl-needle') as SVGGElement;
    this.card = h(`<div class="pl-card"></div>`);
    this.info = h(`<div class="pl-info"></div>`);
    ctx.controls.appendChild(this.dial);
    ctx.controls.appendChild(this.card);
    ctx.controls.appendChild(this.info);
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: () => PTS.length,
        size: () => [W, H],
        xy: (_s, p) => [PTS[p].x, PTS[p].y],
        board: () => `<image href="${BASE}board.webp" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>
          <defs><filter id="pl-sh" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="8" dy="12" stdDeviation="6" flood-opacity="0.45"/></filter>
          ${HUE.map((hue, i) => `<filter id="pl-h${i}"><feColorMatrix type="hueRotate" values="${hue}"/></filter>`).join('')}</defs>`,
        pieces: (s) => s.planes.map((pl) => ({ p: pointOf(pl), kind: `${pl.seat}` })),
        piece: (s, kind, x, y, p) => this.plane(s, Number(kind), x, y, p),
        legal: (s, seat) => legal(s, seat),
        spot: (a) => {
          const s = this.s;
          if (!s || a.type !== 'move') return null;
          return { from: pointOf(s.planes[s.turn]), to: s.path[s.path.length - 1] };
        },
        label: (a) => (a.type === 'spin' ? '🎯 Крутить стрелку' : a.type === 'answer' ? (this.s?.question?.options[a.i] ?? '…') : '…'),
        hit: 34,
        ring: 30,
      },
      'pl'
    );
  }

  /** Самолётик носом по маршруту (к следующей точке). */
  private plane(s: State, seat: number, x: number, y: number, p: number): string {
    const same = s.planes.filter((q) => pointOf(q) === p);
    const k = same.findIndex((q) => q.seat === seat);
    const dx = same.length > 1 ? (k - (same.length - 1) / 2) * 46 : 0;
    const pl = s.planes[seat];
    // нос — к следующей точке маршрута; на конечной — по прилёту
    const next = walk(pl, 1).path[0];
    const prev = LEGS[pl.leg].pts[pl.i - 1];
    const ang = next != null ? (Math.atan2(PTS[next].y - y, PTS[next].x - x) * 180) / Math.PI : prev != null ? (Math.atan2(y - PTS[prev].y, x - PTS[prev].x) * 180) / Math.PI : 0;
    return `<g transform="translate(${x + dx} ${y - 34}) rotate(${ang.toFixed(0)})" filter="url(#pl-sh)">
      <image href="${BASE}plane.webp" x="-60" y="-56" width="120" height="112" filter="url(#pl-h${seat})"/></g>${pl.skip ? `<text x="${x + dx}" y="${y - 84}" class="pl-skip">⏸</text>` : ''}`;
  }

  private spinTo(angle: number, slow: boolean) {
    const turns = 2 + Math.floor(Math.random() * 2);
    const base = this.angle - (this.angle % 360);
    this.angle = base + turns * 360 + angle;
    this.needle.style.transition = slow ? `transform ${1.2 / this.ctx.speed()}s cubic-bezier(.15,.7,.25,1)` : 'none';
    this.needle.style.transform = `rotate(${this.angle}deg)`;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const pl = s.planes[s.turn];
    const n = numOf(pl);
    let task = '';
    if (s.phase === 'question' && s.question) {
      const q = s.question;
      const rect = q.set === 'land' ? PIC_LAND[q.pic] : q.set === 'water' ? PIC_WATER[q.pic] : null;
      const pic = rect ? `<svg viewBox="${rect.join(' ')}" class="pl-pic"><image href="${BASE}board.webp" x="0" y="0" width="${W}" height="${H}"/></svg>` : '<div class="pl-sign">ЗАСТЕГНИ РЕМНИ?</div>';
      task = `${pic}<div>${q.set === 'signal' ? 'Самолёт начинает снижение. Какой сигнал передать пассажирам?' : 'Что обозначает эта пиктограмма?'}</div>`;
    } else if (pl.need === 'takeoff') task = 'Нужно разрешение на взлёт: стрелка — в секторе «Взлёт разрешён».';
    else if (pl.need === 'landing') task = 'Запросите посадку: стрелка — в секторе «Посадка разрешена».';
    else if (pl.need === 'task' && TASKS[n]) {
      const [kind, q] = TASKS[n];
      task = kind === 'course' ? `Возьмите курс <b>${COURSE[q]}</b> (зелёное кольцо).` : kind === 'alt' ? `Высота <b>${ALT[q]}</b> (голубое кольцо).` : `Скорость <b>${SPEED[q]}</b> (красное кольцо).`;
    } else if (s.phase === 'move') task = `Переставьте самолёт на ${s.path.length} ${s.path.length === 1 ? 'точку' : s.path.length < 5 ? 'точки' : 'точек'} вперёд — нажмите на подсвеченную точку.`;
    else task = 'Крутите стрелку: жёлтое кольцо «Ход» — на сколько точек лететь.';
    this.card.innerHTML = task;
    this.info.innerHTML = s.planes.map((p) => `<div>${this.ctx.name(p.seat)}: точка ${numOf(p) || '·'}${p.skip ? ' · пропускает ход' : ''}</div>`).join('');
  }

  setView(v: State) {
    this.s = v;
    this.spinTo(v.angle, false);
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    const sp = () => this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'spin') {
        this.spinTo(ev.angle, true);
        Sound.diceRoll(0.8);
        await sleep(1300 / sp());
        if (ev.why !== 'move') {
          if (ev.ok) Sound.home();
          else Sound.nomove();
        }
      } else if (ev.type === 'move') {
        const prev = this.s ?? v;
        let from = pointOf(prev.planes[ev.seat]);
        for (const q of ev.path) {
          this.pb.show({ ...prev, planes: prev.planes.map((p) => (p.seat === ev.seat ? { ...p } : p)) }, { from, to: q, kind: `${ev.seat}` });
          from = q;
          Sound.step();
          await sleep(160 / sp());
        }
        if (ev.effect === 'delay' || ev.effect === 'belts') Sound.nomove();
        if (ev.effect === 'landed') Sound.win();
      } else if (ev.type === 'answer') {
        if (ev.ok) Sound.home();
        else Sound.nomove();
        await sleep(300 / sp());
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
    if (v.phase === 'over') return v.winner == null ? 'Полёт окончен' : 'Посадка в аэропорту назначения!';
    if (!interactive.some((x) => toAct.includes(x))) return 'Летит соперник…';
    return v.phase === 'spin' ? 'Крутите стрелку' : v.phase === 'move' ? 'Переставьте самолёт' : 'Ответьте на вопрос';
  }

  playerStats(v: State, seat: number) {
    return `точка ${numOf(v.planes[seat]) || '·'}`;
  }
}

export function createView(): GameView<State, Event> {
  return new PoletView();
}

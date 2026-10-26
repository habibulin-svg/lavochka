/* «Идут танки» — отрисовка. Поле — скан (public/tanki/board.webp, 1194×1522), клетки — map.ts. Фигурки вырезаны с фото
 * комплекта (танки, самолёты, ракеты на подставках, красные и зелёные); мины — пластинки кодом (на фото их не разглядеть),
 * кубик «1:3» — в лотке на панели. Ход: «Бросить кубик», затем касание танка и клетки; развороты, полёты, ракеты — кнопками. */
import { Sound } from '../../core/audio';
import { DiceTray } from '../../core/dice';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { arcsOf, legal, type Action, type Event, type State } from './engine';
import { FIELDS, N, ROADS, XY } from './map';
import './tanki.css';

const BASE = `${import.meta.env.BASE_URL}tanki/`;
const W = 1194;
const H = 1522;
const COLOR = ['g', 'r'];
const NAME = ['зелёные', 'красные'];
const MINE: Record<string, string> = { tr: 'Т-Р', lp: 'Л-П', ns: 'Н-С' };

/** Куда смотрит танк на экране: вправо (+1) или влево (−1) — по следующей клетке его дороги. */
function face(road: number, dir: number, p: number): number {
  const r = ROADS[road];
  const i = r.indexOf(p);
  const q = r[i + dir] ?? r[i - dir];
  if (q == null) return 1;
  const dx = (XY[q][0] - XY[p][0]) * (r[i + dir] != null ? 1 : -1);
  return dx >= 0 ? 1 : -1;
}

function sprite(name: string, x: number, y: number, w: number, hgt: number, flip = 1): string {
  return `<image href="${BASE}${name}.webp" x="${-w / 2}" y="${-hgt / 2}" width="${w}" height="${hgt}" transform="translate(${x} ${y}) scale(${flip} 1)" class="tk-shadow"/>`;
}

class TankiView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private hint!: HTMLElement;
  private s: State | null = null;
  private seat = -1;
  private tray!: DiceTray;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="tk-info"></div>`);
    ctx.controls.appendChild(this.info);
    this.hint = h(`<div class="tk-hint"></div>`);
    if (!ctx.demo) ctx.controls.appendChild(this.hint);
    const trayEl = h(`<div class="tk-tray"></div>`);
    ctx.controls.appendChild(trayEl);
    this.tray = new DiceTray(trayEl, 1);
    this.tray.show(null, [true]);
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: () => N,
        size: () => [W, H],
        xy: (_s, p) => XY[p],
        board: () => this.board(),
        pieces: (s) => {
          const out: { p: number; kind: string }[] = [];
          for (const m of s.mines) out.push({ p: m.p, kind: `m${m.side}${m.label ?? ''}` });
          for (const t of s.tanks) if (t.state !== 'dead') out.push({ p: t.p, kind: `t${t.side}${t.state === 'done' ? 'd' : face(t.road, t.dir, t.p) > 0 ? 'r' : 'l'}${t.repair ? 'x' : ''}` });
          return out;
        },
        piece: (_s, kind, x, y) => this.piece(kind, x, y),
        legal: (s, seat) => this.legal(s, seat),
        spot: (a) => {
          if (a.type === 'move') {
            const t = this.s?.tanks.find((x) => x.id === a.id);
            return t ? { from: t.p, to: a.path[a.path.length - 1] } : null;
          }
          if (a.type === 'return') return { to: a.at };
          return null;
        },
        label: (a) => this.label(a),
        zoom: true,
        hit: 26,
        ring: 24,
      },
      'tk'
    );
    this.pb.extra = (s) => this.overlay(s);
  }

  /** Ходы для экрана: путь к клетке — один (первый), развороты и полёты — кнопками. */
  private legal(s: State, seat: number): Action[] {
    const acts = legal(s, seat);
    const seen = new Set<string>();
    return acts.filter((a) => {
      if (a.type !== 'move') return true;
      const k = `${a.id}:${a.path[a.path.length - 1]}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  private label(a: Action): string {
    const s = this.s!;
    if (a.type === 'roll') return `🎲 Бросить кубик (${s.rolls} ${s.rolls === 1 ? 'бросок' : 'броска'})`;
    if (a.type === 'pass') return 'Ходить нечем — пропустить';
    if (a.type === 'reverse') {
      const t = s.tanks.find((x) => x.id === a.id)!;
      const n = s.tanks.filter((x) => x.side === t.side).indexOf(t) + 1;
      return `↻ Развернуть танк №${n}${a.value ? ` (за «${a.value}»)` : ''}`;
    }
    if (a.type === 'fly') {
      const k = arcsOf(1 - s.side).findIndex((x) => x.i === a.arc) + 1;
      return `✈ Лететь: дуга ${k}, с ${s.planes[s.side][a.plane] === 0 ? 'левого' : 'правого'} аэродрома`;
    }
    if (a.type === 'keep') return 'Ракеты оставить';
    if (a.type === 'swap') return `Поменять ракеты ${a.a + 1} и ${a.b + 1}`;
    if (a.type === 'noreturn') return 'Не возвращать танк';
    return '…';
  }

  private board(): string {
    return `<defs><filter id="tk-sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="3" dy="4" stdDeviation="3" flood-opacity="0.45"/></filter></defs>
      <image href="${BASE}board.webp" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`;
  }

  private piece(kind: string, x: number, y: number): string {
    if (kind[0] === 'm') {
      const label = kind.slice(2);
      return `<g transform="translate(${x + 14} ${y + 12})" class="tk-mine">
        <rect x="-15" y="-10" width="30" height="20" rx="3" fill="${kind[1] === '0' ? '#3c6a34' : '#8a2a22'}" stroke="#1a1a10" stroke-width="2"/>
        <rect x="-10" y="-6" width="20" height="12" rx="1.5" fill="none" stroke="#e8e0c0" stroke-width="1.5" stroke-dasharray="3 2"/>
        ${label ? `<text y="4" class="tk-mtext">${MINE[label]}</text>` : ''}
      </g>`;
    }
    const side = Number(kind[1]);
    const done = kind[2] === 'd';
    const flip = kind[2] === 'l' ? -1 : 1;
    const name = `tank-${COLOR[side]}`;
    const w = done ? 74 : 64;
    const hgt = side === 0 ? w * 0.47 : w * 0.61;
    return `<g>${sprite(name, x, y - 6, w, hgt, flip)}${kind.includes('x') ? `<text x="${x}" y="${y - 24}" class="tk-repair">🔧</text>` : ''}</g>`;
  }

  /** Самолёты на аэродромах, ракеты на дугах (хозяину — с меткой), кубик. */
  private overlay(s: State): string {
    let o = '';
    for (const side of [0, 1]) {
      s.planes[side].forEach((f, k) => {
        if (f < 0) return;
        const [x, y] = FIELDS[side][f];
        const same = s.planes[side].filter((g) => g === f).length > 1 && k === 1;
        o += sprite(`plane-${COLOR[side]}`, x + 10, y + (same ? 60 : 0), 96, side === 0 ? 50 : 78, f === 0 ? 1 : -1);
      });
      arcsOf(side).forEach((a, k) => {
        const [x, y] = a.at;
        o += sprite(`rocket-${COLOR[side]}`, x, y - 16, 28, 46);
        const lab = s.rockets[side][k];
        o += `<text x="${x}" y="${y + 24}" class="tk-rlab">${k + 1}${lab ? (lab === 'hit' ? ' Ц-П' : ' П') : ''}</text>`;
      });
    }
    return o;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const row = (side: number) => {
      const t = s.tanks.filter((x) => x.side === side);
      const on = t.filter((x) => x.state === 'board').length;
      const done = t.filter((x) => x.state === 'done').length;
      const planes = s.planes[side].filter((f) => f >= 0).length;
      return `<div>${this.ctx.name(side)}: танков <b>${on}</b>, дошли <b>${done}</b>, самолётов ${planes}</div>`;
    };
    const mine = this.seat >= 0 ? s.rockets[this.seat].map((r, k) => (r ? `${k + 1}: ${r === 'hit' ? 'Ц-П' : 'П'}` : '')).filter(Boolean).join(', ') : '';
    this.info.innerHTML = `${row(0)}${row(1)}${mine ? `<small>Ваши ракеты: ${mine}</small>` : ''}`;
    this.hint.textContent =
      s.phase === 'rockets'
        ? 'Соперник пролетел над вашей половиной — можно переставить ракеты.'
        : s.phase === 'return'
          ? 'Танк дошёл! Можно вернуть в игру разбитый танк на свободный большой кружок своей стороны.'
          : s.cfg.dice
            ? 'Бросьте кубик и двиньте танк на выпавшее число кружков (свернул на перекрёстке — на кружок меньше). Или вместо танков — полёт, если на дуге танк соперника.'
            : 'За ход все танки едут на 1, 2, 3 и 4 кружка — нажмите на танк и на клетку. Или вместо танков — полёт.';
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    const sp = () => this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'roll') {
        // кубик «1:3» — в лотке на панели, не на карте (на телефоне карта и так тесная)
        this.s = v;
        this.pb.set(v);
        await this.tray.roll([ev.value], sp());
      } else if (ev.type === 'move') {
        const prev = this.s ?? v;
        const t = prev.tanks.find((x) => x.id === ev.id);
        let from = t ? t.p : ev.path[0];
        for (const q of ev.path) {
          const tmp: State = { ...prev, tanks: prev.tanks.map((x) => (x.id === ev.id ? { ...x, p: q } : x)) };
          this.pb.show(tmp, { from, to: q, kind: `t${t?.side ?? 0}${XY[q][0] >= XY[from][0] ? 'r' : 'l'}` });
          from = q;
          Sound.step();
          await sleep(150 / sp());
        }
        if (ev.mine) {
          Sound.nomove();
          await sleep(300 / sp());
        }
        if (ev.took != null) Sound.capture();
        if (ev.fell) Sound.nomove();
        if (ev.done) Sound.home();
        this.s = v;
        this.pb.set(v);
        await sleep(200 / sp());
      } else if (ev.type === 'fly') {
        Sound.jump();
        this.s = v;
        this.pb.set(v);
        await sleep(700 / sp());
        if (ev.tank != null) Sound.capture();
        if (ev.shot) Sound.nomove();
      } else if (ev.type === 'end') {
        if (ev.winner == null) Sound.nomove();
        else Sound.win();
      }
    }
    this.tray.show(v.phase === 'move' && v.roll ? [v.roll] : null, [!(v.phase === 'move' && v.roll)]);
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    const seat = s && s.phase !== 'over' && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    if (seat != null) this.seat = seat;
    else if (this.ctx.mySeats.length === 1) this.seat = this.ctx.mySeats[0];
    this.pb.turn(seat);
    this.text();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.phase === 'over') {
      if (v.winner == null) return 'Ничья';
      return `Победили ${NAME[v.winner]}${v.why === 'tanks' ? ': все танки соперника разбиты' : ''}`;
    }
    const mine = interactive.some((x) => toAct.includes(x));
    if (!mine) return v.phase === 'rockets' ? 'Соперник думает над ракетами…' : `Ходят ${NAME[v.side]}…`;
    if (v.phase === 'move') return `Выпало ${v.roll}: выберите танк`;
    if (v.phase === 'rockets') return 'Переставить ракеты?';
    if (v.phase === 'return') return 'Вернуть разбитый танк?';
    return 'Ваш ход';
  }

  playerStats(v: State, seat: number) {
    return `${v.tanks.filter((t) => t.side === seat && t.state === 'done').length} дошли`;
  }
}

export function createView(): GameView<State, Event> {
  return new TankiView();
}

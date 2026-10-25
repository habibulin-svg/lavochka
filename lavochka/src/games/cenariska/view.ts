/* «Цена риска» — отрисовка. Доска — выпрямленное фото бирюзовой подложки (public/cenariska/board.webp, 1400×1400) с окнами
 * неподвижных тайлов, стрелками и цветными стоянками. Подвижные тайлы — вырезанные с фото коробки (I, L, T, звери, охотник,
 * камни); мамонта на снимках нет — он нарисован поверх пустого прямого (разрешение пользователя). Фишки — конусы цветов
 * стоянок, туши на стоянках — кружки с буквой зверя. Ход: повернуть плитку и нажать на стрелку, затем — клетку манёвра. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { ACC, campOf, CAMPS, colOf, COLORS, isFixed, legal, N, NAMES, rowOf, SLOTS, type Action, type Event, type Kind, type Prey, type State } from './engine';
import './cenariska.css';

const BASE = `${import.meta.env.BASE_URL}cenariska/`;
const B = 1400;
const X0 = 167;
const Y0 = 175;
const STEP = 176;
const TS = 168;
const LETTER: Record<Prey, string> = { mammoth: 'М', rhino: 'Н', deer: 'О', bison: 'Б' };

const cx = (p: number) => X0 + colOf(p) * STEP;
const cy = (p: number) => Y0 + rowOf(p) * STEP;

/** Мамонт в духе гравюр на тайлах: бурый, лохматый, с бивнями. Рисуется в окне 200×120 (центр 100, 60), мордой влево. */
const MAMMOTH = `<g>
  <path d="M60,48 C62,22 92,8 128,12 C160,15 182,32 184,58 C186,78 178,92 170,98 L168,118 L156,118 L154,98 L132,100 L130,118 L118,118 L116,98 C104,96 92,90 86,82 L80,118 L68,118 L68,88 C62,80 58,64 60,48 Z" fill="#7a4a22" stroke="#3a2010" stroke-width="2"/>
  <path d="M62,46 C54,52 50,64 52,78 C54,92 50,104 44,112 C40,116 34,114 36,108 C42,98 42,86 40,74 C38,58 44,44 56,38 Z" fill="#6a3e1c" stroke="#3a2010" stroke-width="2"/>
  <path d="M66,62 C52,66 40,70 30,64 C24,60 26,54 32,56 C42,60 54,58 64,54" fill="none" stroke="#f4ecd8" stroke-width="6" stroke-linecap="round"/>
  <path d="M66,62 C52,66 40,70 30,64 C24,60 26,54 32,56 C42,60 54,58 64,54" fill="none" stroke="#5a4a30" stroke-width="1.2"/>
  <circle cx="72" cy="40" r="3" fill="#1a0e06"/>
  ${Array.from({ length: 14 }, (_, i) => `<path d="M${90 + i * 6},${22 + (i % 3) * 6} q2,10 -2,18" stroke="#4a2a12" stroke-width="1.6" fill="none"/>`).join('')}
  ${Array.from({ length: 8 }, (_, i) => `<path d="M${92 + i * 10},84 q-2,8 1,14" stroke="#4a2a12" stroke-width="1.4" fill="none"/>`).join('')}
  <path d="M20,118 H190" stroke="#3a2010" stroke-width="1.5" opacity="0.6"/>
</g>`;

/** Тайл: картинка с фото, повёрнутая; мамонт — пустой прямой с рисунком. */
export function tileSvg(k: Kind, rot: number, x: number, y: number, size: number): string {
  const img = k === 'mammoth' ? 'I' : k;
  const pic = k === 'mammoth' ? `<g transform="translate(${-size * 0.4} ${-size * 0.24}) scale(${(size * 0.8) / 200})">${MAMMOTH}</g>` : '';
  return `<g transform="translate(${x} ${y}) rotate(${rot * 90})"><image href="${BASE}${img}.webp" x="${-size / 2}" y="${-size / 2}" width="${size}" height="${size}"/>${pic}</g>`;
}

/** Точка стрелки сдвига. */
function slotXY(i: number): [number, number] {
  const sl = SLOTS[i];
  const far = STEP * 0.8;
  if (sl.line === 'row') return [sl.from === 1 ? X0 - far : X0 + 6 * STEP + far, Y0 + sl.i * STEP];
  return [X0 + sl.i * STEP, sl.from === 1 ? Y0 - far : Y0 + 6 * STEP + far];
}

type Ui = Action | { type: 'rot' } | { type: 'stay' };

class CenariskaView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Ui>;
  private info!: HTMLElement;
  private hand!: HTMLElement;
  private hint!: HTMLElement;
  private s: State | null = null;
  private rot = 0;
  private seat: number | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.hand = h(`<div class="cr-hand"></div>`);
    this.info = h(`<div class="cr-info"></div>`);
    ctx.controls.appendChild(this.hand);
    ctx.controls.appendChild(this.info);
    this.hint = h(`<div class="cr-hint"></div>`);
    if (!ctx.demo) ctx.controls.appendChild(this.hint);
    const inner: ViewCtx = {
      ...ctx,
      act: (seat, a) => {
        const u = a as Ui;
        if (u.type === 'rot') {
          this.rot = (this.rot + 1) % 4;
          Sound.ui();
          this.pb.turn(seat);
          this.text();
          return;
        }
        if (u.type === 'stay') {
          ctx.act(seat, { type: 'move', to: this.s!.players[seat].p });
          return;
        }
        ctx.act(seat, u);
      },
    };
    this.pb = new PointBoard<State, Ui>(
      root,
      inner,
      {
        count: () => N + SLOTS.length,
        size: () => [B, B],
        xy: (_s, q) => (q < N ? [cx(q), cy(q)] : slotXY(q - N)),
        board: (s) => this.board(s),
        pieces: (s) => s.players.map((pl) => ({ p: pl.p, kind: `p${pl.seat}` })),
        piece: (s, kind, x, y) => this.pawn(s, Number(kind.slice(1)), x, y),
        legal: (s, seat) => this.legal(s, seat),
        spot: (a) => {
          const s = this.s;
          if (!s) return null;
          if (a.type === 'shift') return { to: N + a.slot };
          if (a.type === 'move') {
            const from = s.players[s.turn].p;
            return a.to === from ? null : { from, to: a.to };
          }
          return null;
        },
        label: (a) => (a.type === 'rot' ? '↻ Повернуть плитку' : a.type === 'stay' ? 'Остаться на месте' : a.type === 'kill' ? `🗡 Убить ${this.s?.prey ? ACC[this.s.prey] : ''}` : a.type === 'spare' ? 'Не трогать' : '…'),
        hit: 70,
        ring: 60,
      },
      'cr'
    );
  }

  private legal(s: State, seat: number): Ui[] {
    const acts = legal(s, seat);
    if (s.phase === 'shift') return [...acts.filter((a) => a.type === 'shift' && a.rot === this.rot), { type: 'rot' }];
    if (s.phase === 'move') {
      const p = s.players[seat].p;
      return acts.map((a) => (a.type === 'move' && a.to === p ? ({ type: 'stay' } as Ui) : a));
    }
    return acts;
  }

  private board(s: State): string {
    let o = `<defs><filter id="cr-sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="3" dy="4" stdDeviation="3" flood-opacity="0.5"/></filter></defs>
      <image href="${BASE}board.webp" x="0" y="0" width="${B}" height="${B}" preserveAspectRatio="none"/>`;
    for (let p = 0; p < N; p++) {
      if (isFixed(p)) continue;
      const t = s.board[p];
      o += `<g filter="url(#cr-sh)">${tileSvg(t.k, t.rot, cx(p), cy(p), TS)}</g>`;
    }
    // туши на стоянках
    for (const c of CAMPS) {
      let k = 0;
      for (const pl of s.players) {
        const prey = pl.laid[c];
        if (!prey) continue;
        const x = cx(c) - 50 + (k % 2) * 34;
        const y = cy(c) + 34 + Math.floor(k / 2) * 34 - 70 * (rowOf(c) === 6 ? 1 : 0);
        o += `<g class="cr-laid"><circle cx="${x}" cy="${y}" r="15" fill="${COLORS[this.campColor(s, pl.seat)]}" stroke="#2a1a0a" stroke-width="2"/><text x="${x}" y="${y + 5}">${LETTER[prey]}</text></g>`;
        k++;
      }
    }
    return o;
  }

  /** Цвет игрока — цвет его родной стоянки. */
  private campColor(s: State, seat: number): number {
    return CAMPS.indexOf(campOf(s.players.length, seat));
  }

  private pawn(s: State, seat: number, x: number, y: number): string {
    const same = s.players.filter((p) => p.p === s.players[seat].p);
    const k = same.findIndex((p) => p.seat === seat);
    const dx = same.length > 1 ? (k - (same.length - 1) / 2) * 34 : 0;
    const col = COLORS[this.campColor(s, seat)];
    return `<g transform="translate(${x + dx} ${y})">
      <ellipse cx="6" cy="34" rx="26" ry="10" fill="#000" opacity="0.35"/>
      <path d="M-20,30 L0,-34 L20,30 Z" fill="${col}" stroke="#1a1208" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="0" cy="-36" r="11" fill="${col}" stroke="#1a1208" stroke-width="2.5"/>
      <path d="M-8,-40 a8,8 0 0 1 8,-6" stroke="#fff" stroke-width="3" opacity="0.6" fill="none"/>
    </g>`;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const mine = this.seat != null && s.turn === this.seat;
    if (s.phase === 'shift' && s.hand) {
      this.hand.innerHTML = `<div class="cr-hand-row"><svg viewBox="-90 -90 180 180" width="96" height="96">${tileSvg(s.hand, mine ? this.rot : 0, 0, 0, TS)}</svg>
        <div>Из запаса: <b>${this.tileName(s.hand)}</b>${mine ? '<br><small>поверните и нажмите на стрелку у края</small>' : ''}</div></div>`;
    } else this.hand.innerHTML = '';
    this.info.innerHTML = s.players
      .map((pl) => {
        const tok = [pl.spear ? '🗡 копьё' : '', pl.torch ? '🔥 факел' : '', ...pl.carry.map((p) => `🥩 ${NAMES[p]}`)].filter(Boolean).join(', ') || '—';
        const laid = s.cfg.quick ? s.visited[pl.seat].length : Object.keys(pl.laid).length;
        return `<div><span class="cr-dot" style="background:${COLORS[this.campColor(s, pl.seat)]}"></span>${this.ctx.name(pl.seat)}: ${tok} · ${s.cfg.quick ? 'стоянок' : 'туш выложено'} <b>${laid}</b>/4</div>`;
      })
      .join('');
    this.hint.textContent =
      s.phase === 'shift'
        ? 'Сдвиг: поверните плитку и вдвиньте её стрелкой у края — выпавшая уйдёт в запас.'
        : s.phase === 'move'
          ? 'Манёвр: нажмите на клетку, куда идти по открытым проходам. Зверь — только с копьём, хищник — только с факелом (он погаснет), охотник — по стрелке, камень — никак.'
          : 'Убить зверя? Копьё сломается, туша — ваша.';
  }

  private tileName(k: Kind): string {
    const n: Record<Kind, string> = { I: 'прямой проход', L: 'поворот', T: 'развилка', bison: 'бизон', deer: 'олень', rhino: 'носорог', mammoth: 'мамонт', hunter: 'охотник', tiger: 'тигр', lion: 'лев', rock: 'камень', rock2: 'обвал' };
    return n[k];
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'shift') {
        this.s = v;
        this.rot = 0;
        this.pb.set(v);
        Sound.card();
        await sleep(350 / this.ctx.speed());
      } else if (ev.type === 'move') {
        const prev = this.s ?? v;
        let from = prev.players[ev.seat].p;
        for (const q of ev.path) {
          const tmp: State = { ...prev, players: prev.players.map((p) => (p.seat === ev.seat ? { ...p, p: q } : p)) };
          this.pb.show(tmp, { from, to: q, kind: `p${ev.seat}` });
          from = q;
          Sound.step();
          await sleep(140 / this.ctx.speed());
        }
        if (ev.torchLost) Sound.nomove();
        if (ev.laid) Sound.home();
      } else if (ev.type === 'kill') {
        Sound.capture();
        await sleep(250 / this.ctx.speed());
      } else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    const seat = s && s.phase !== 'over' && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    this.seat = seat ?? (this.ctx.mySeats.length === 1 ? this.ctx.mySeats[0] : null);
    this.pb.turn(seat);
    this.text();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.phase === 'over') return v.winner == null ? 'Ничья' : `Вождь племени — ${this.ctx.name(v.winner).replace(/<[^>]+>/g, '')}!`;
    if (!interactive.some((x) => toAct.includes(x))) return 'Ходит соперник…';
    return v.phase === 'shift' ? 'Сдвиньте ряд' : v.phase === 'move' ? 'Куда идти?' : 'Убить зверя?';
  }

  playerStats(v: State, seat: number) {
    const pl = v.players[seat];
    return pl ? `${v.cfg.quick ? v.visited[seat].length : Object.keys(pl.laid).length}/4` : '';
  }
}

export function createView(): GameView<State, Event> {
  return new CenariskaView();
}

/* Чаупар и пачиси — отрисовка: полотно-крест на столе (ткань и вышивка — картинки tools/chaupar, клетки — SVG-«строчка»),
 * фишки-готи слоем поверх, ждущие фишки — на столе у своего рукава, дошедшие — в центре. Лоток: три длинные кости-пасы
 * или шесть каури. Ход — касание подсвеченной фишки, затем клетки, куда её поставить. */
import { Sound } from '../../core/audio';
import { h, sleep, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { cellOf, GOAL, GRACE, legalMoves, type CEvent, type CMove, type CState } from './engine';
import './chaupar.css';

const TEX = `${import.meta.env.BASE_URL}tex/chaupar/`;
const NS = 'http://www.w3.org/2000/svg';
/** Центр доски в клетках: крест 19 × 19, рукав — 3 столбца × 8 рядов, центр — 3 × 3. */
const C = 9.5;
const THREAD = '#e9c46a';
/** Цвета мест — как в шиш-беше (shishbesh/def.ts, SEATS). */
const INK = ['#b3322a', '#2f7a3e', '#d9a521', '#2b5c9e'];

type Pt = [number, number];

/** Точка рукава a в его собственных координатах (u — поперёк, +1 по ходу; w — от центра) → доска, повёрнутая на rot четвертей. */
function armPt(a: number, u: number, w: number, rot: number): Pt {
  let [x, y] = [u, w];
  for (let i = 0; i < (a + rot) % 4; i++) [x, y] = [y, -x];
  return [C + x, C + y];
}

export class ChauparView implements GameView<CState, CEvent> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private gBoard!: SVGGElement;
  private gTargets!: SVGGElement;
  private gPieces!: SVGGElement;
  private tray!: HTMLElement;
  private trayKind = '';
  private trayVal!: HTMLElement;
  private rollBtn!: HTMLButtonElement;
  private s: CState | null = null;
  private key = '';
  private rot = 0;
  private els = new Map<string, SVGGElement>();
  private moves: CMove[] = [];
  private rollSeat: number | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | undefined;
  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || this.rollBtn.disabled || !this.rollBtn.isConnected) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    this.roll();
  };

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="cp-wrap"><svg class="cp-board" xmlns="${NS}"><g class="cp-g"></g><g class="cp-t"></g><g class="cp-p"></g></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.svg.setAttribute('viewBox', '-0.2 -0.2 19.4 19.4');
    this.gBoard = this.svg.querySelector('.cp-g') as SVGGElement;
    this.gTargets = this.svg.querySelector('.cp-t') as SVGGElement;
    this.gPieces = this.svg.querySelector('.cp-p') as SVGGElement;
    const ctl = h(`<div class="sb-controls">
        <div class="cp-tray"></div><div class="cp-val"></div>
        ${ctx.demo ? '' : `<button class="btn primary sb-roll" data-tap disabled>Бросить</button><div class="hint small-hint">${touchScreen() ? 'Бросок — кнопкой или тапом по доске.' : 'Пробел — бросок.'} Нажмите на подсвеченную фишку, затем на клетку.</div>`}
      </div>`);
    ctx.controls.appendChild(ctl);
    this.tray = ctl.querySelector('.cp-tray') as HTMLElement;
    this.trayVal = ctl.querySelector('.cp-val') as HTMLElement;
    this.rollBtn = (ctl.querySelector('.sb-roll') as HTMLButtonElement) || document.createElement('button');
    this.rollBtn.onclick = () => this.roll();
    this.gPieces.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-k]') as SVGGElement | null;
      if (!el || !this.s || !this.moves.length) return;
      e.stopPropagation();
      this.pick(Number(el.dataset.k));
    });
    this.gTargets.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-i]') as SVGGElement | null;
      if (!el || !this.s) return;
      e.stopPropagation();
      const m = this.moves[Number(el.dataset.i)];
      const seat = this.s.players[this.s.cur].seat;
      this.clearTurn();
      Sound.unlock();
      this.ctx.act(seat, { type: 'move', piece: m.piece, die: m.die, to: m.to });
    });
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);
    for (let i = 0; i < 4; i++) new Image().src = `${TEX}g${i}.webp`;
  }

  // ---------------------------------------------------------------- доска

  private bottomSeat(s: CState) {
    const mine = this.ctx.mySeats.filter((x) => s.players.some((p) => p.seat === x));
    if (mine.length) return mine[0];
    return s.players.some((p) => p.seat === 3) ? 3 : s.players[0].seat;
  }

  /** Прямоугольник клетки [рукав, столбец, ряд] на экране. */
  private cellRect(a: number, col: number, row: number) {
    const [x1, y1] = armPt(a, col - 0.5, 1.5 + row, this.rot);
    const [x2, y2] = armPt(a, col + 0.5, 2.5 + row, this.rot);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: 1, h: 1, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
  }

  private build(s: CState) {
    const me = this.bottomSeat(s);
    this.rot = (4 - me) % 4;
    const parts: string[] = [];
    // полотно-крест с подрубом
    const m = 0.32;
    const cross: Pt[] = [];
    for (let a = 0; a < 4; a++) {
      cross.push(armPt(a, -1.5 - m, 1.5 + m, this.rot), armPt(a, -1.5 - m, 9.5 + m, this.rot), armPt(a, 1.5 + m, 9.5 + m, this.rot), armPt(a, 1.5 + m, 1.5 + m, this.rot));
    }
    const pts = cross.map((p) => p.map((v) => v.toFixed(2)).join(',')).join(' ');
    parts.push(`<defs>
      <pattern id="cp-cloth" patternUnits="userSpaceOnUse" width="19" height="19"><image href="${TEX}cloth.webp" width="19" height="19" preserveAspectRatio="xMidYMid slice"/></pattern>
      <clipPath id="cp-mid"><rect x="8" y="8" width="3" height="3"/></clipPath>
      <filter id="cp-sh" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="0.12" stdDeviation="0.12" flood-opacity="0.55"/></filter>
    </defs>`);
    parts.push(`<polygon points="${pts}" fill="#5a1414" filter="url(#cp-sh)"/>`);
    parts.push(`<polygon points="${pts}" fill="url(#cp-cloth)"/>`);
    // кайма — строчка по краю полотна
    const hem: Pt[] = [];
    const hm = 0.14;
    for (let a = 0; a < 4; a++) hem.push(armPt(a, -1.5 - hm, 1.5 + hm, this.rot), armPt(a, -1.5 - hm, 9.5 + hm, this.rot), armPt(a, 1.5 + hm, 9.5 + hm, this.rot), armPt(a, 1.5 + hm, 1.5 + hm, this.rot));
    parts.push(`<polygon points="${hem.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${THREAD}" stroke-width="0.07" stroke-dasharray="0.16 0.09" opacity="0.9"/>`);
    // клетки
    for (let a = 0; a < 4; a++) {
      for (const col of [-1, 0, 1])
        for (let row = 0; row < 8; row++) {
          const r = this.cellRect(a, col, row);
          const home = col === 0 && row < 7;
          const fill = home ? INK[a] : (row + col) % 2 ? 'rgba(0,0,0,0.16)' : 'rgba(255,220,170,0.05)';
          parts.push(`<rect x="${r.x + 0.06}" y="${r.y + 0.06}" width="0.88" height="0.88" rx="0.08" fill="${fill}" opacity="${home ? 0.62 : 1}" stroke="${THREAD}" stroke-width="0.045" stroke-dasharray="0.11 0.06"/>`);
          // замки: торец среднего столбца и 4-я клетка от края на внешних (engine.ts, isCastle)
          if ((col === 0 && row === 7) || (col !== 0 && row === 4)) parts.push(this.castle(r.cx, r.cy));
        }
    }
    // центр — вышитый медальон и четыре треугольника цветов
    parts.push(`<rect x="8.04" y="8.04" width="2.92" height="2.92" fill="#120b08"/><image href="${TEX}center.webp" x="8.04" y="8.04" width="2.92" height="2.92" preserveAspectRatio="xMidYMid slice"/>`);
    for (let a = 0; a < 4; a++) {
      const p1 = armPt(a, -1.5, 1.5, this.rot);
      const p2 = armPt(a, 1.5, 1.5, this.rot);
      parts.push(`<polygon points="${p1.join(',')} ${p2.join(',')} ${C},${C}" fill="${INK[a]}" opacity="0.28" stroke="${THREAD}" stroke-width="0.04" stroke-dasharray="0.11 0.06"/>`);
    }
    this.gBoard.innerHTML = parts.join('');

    this.gPieces.innerHTML = '';
    this.els.clear();
    for (const pl of s.players)
      for (let k = 0; k < 4; k++) {
        const el = document.createElementNS(NS, 'g') as SVGGElement;
        el.setAttribute('class', 'cp-pc');
        el.dataset.k = String(k);
        el.dataset.seat = String(pl.seat);
        el.innerHTML = `<g class="cp-in"><ellipse class="cp-ring" cx="0" cy="0" rx="0.42" ry="0.26"/><image href="${TEX}g${pl.seat}.webp" x="-0.42" y="-1.2" width="0.84" height="1.32"/></g>`;
        this.gPieces.appendChild(el);
        this.els.set(`${pl.seat}:${k}`, el);
      }
  }

  /** Замок: вышитый крест-накрест с зеркальцем-шиша. */
  private castle(cx: number, cy: number) {
    const d = 0.33;
    return `<g stroke="${THREAD}" stroke-width="0.07" stroke-linecap="round" stroke-dasharray="0.1 0.05">
      <line x1="${cx - d}" y1="${cy - d}" x2="${cx + d}" y2="${cy + d}"/><line x1="${cx + d}" y1="${cy - d}" x2="${cx - d}" y2="${cy + d}"/></g>
      <circle cx="${cx}" cy="${cy}" r="0.13" fill="#d8dde3" stroke="${THREAD}" stroke-width="0.05"/><circle cx="${cx - 0.04}" cy="${cy - 0.04}" r="0.04" fill="#fff"/>`;
  }

  /** Место фишки k (из n на той же клетке, idx — её номер среди них) на экране и её масштаб. */
  private spot(seat: number, p: number, k: number, idx: number, n: number): { x: number; y: number; sc: number } {
    if (p < 0) {
      const [x, y] = armPt(seat, 2.75 + (k % 2) * 0.95, 2.9 + Math.floor(k / 2) * 1.05, this.rot);
      return { x, y: y + 0.25, sc: 0.95 };
    }
    if (p >= GOAL) {
      const [x, y] = armPt(seat, -0.66 + k * 0.44, 0.92, this.rot);
      return { x, y: y + 0.15, sc: 0.62 };
    }
    const [a, col, row] = cellOf(seat, p)!;
    const r = this.cellRect(a, col, row);
    if (n <= 1) return { x: r.cx, y: r.cy + 0.18, sc: 0.95 };
    const off: Pt[] = n === 2 ? [[-0.2, -0.05], [0.2, 0.12]] : [[-0.22, -0.12], [0.22, -0.12], [-0.22, 0.22], [0.22, 0.22], [0, 0.05]];
    const [dx, dy] = off[idx % off.length];
    return { x: r.cx + dx, y: r.cy + dy + 0.12, sc: 0.72 };
  }

  private place(s: CState, anim = false) {
    const groups = new Map<string, string[]>();
    const keyOf = (seat: number, p: number) => {
      const c = cellOf(seat, p);
      return c ? c.join(',') : `${seat}:${p}`;
    };
    for (const pl of s.players)
      pl.pieces.forEach((p, k) => {
        if (p < 0 || p >= GOAL) return;
        const kk = keyOf(pl.seat, p);
        groups.set(kk, [...(groups.get(kk) ?? []), `${pl.seat}:${k}`]);
      });
    const order: [number, SVGGElement][] = [];
    for (const pl of s.players)
      pl.pieces.forEach((p, k) => {
        const id = `${pl.seat}:${k}`;
        const grp = groups.get(keyOf(pl.seat, p));
        const sp = this.spot(pl.seat, p, k, grp ? grp.indexOf(id) : 0, grp ? grp.length : 1);
        const el = this.els.get(id)!;
        el.classList.toggle('anim', anim);
        el.style.transform = `translate(${sp.x}px, ${sp.y}px) scale(${sp.sc})`;
        order.push([sp.y, el]);
      });
    // ближние фишки — поверх дальних
    order.sort((a, b) => a[0] - b[0]).forEach(([, el]) => this.gPieces.appendChild(el));
  }

  setView(s: CState) {
    const key = `${s.cfg.throws}:${s.players.map((p) => p.seat).join(',')}:${this.ctx.mySeats.join(',')}`;
    if (key !== this.key) {
      this.key = key;
      this.build(s);
    }
    this.s = s;
    this.place(s);
    this.showTray(s, s.phase === 'move' ? s.dice : null, s.shells);
  }

  // ---------------------------------------------------------------- лоток

  private ensureTray(kind: string) {
    if (this.trayKind === kind) return;
    this.trayKind = kind;
    this.tray.className = `cp-tray cp-tray--${kind}`;
    if (kind === 'pasa') this.tray.innerHTML = [0, 1, 2].map(() => `<div class="cp-pasa"><span class="cp-pips"></span></div>`).join('');
    else this.tray.innerHTML = Array.from({ length: 6 }, (_, i) => `<img class="cp-shell" style="--r:${(i * 47) % 70 - 35}deg" alt="" src="${TEX}cowrie_down.webp">`).join('');
  }

  private static pips(n: number) {
    // круг с точкой — как насечки на настоящих пасах; 5 и 6 — в два ряда
    const dot = '<i></i>';
    if (n <= 2) return `<b>${dot.repeat(n)}</b>`;
    if (n === 5) return `<b>${dot.repeat(3)}</b><b>${dot.repeat(2)}</b>`;
    return `<b>${dot.repeat(3)}</b><b>${dot.repeat(3)}</b>`;
  }

  private showTray(s: CState, dice: number[] | null, shells?: boolean[]) {
    this.ensureTray(s.cfg.throws);
    if (s.cfg.throws === 'pasa') {
      this.tray.querySelectorAll<HTMLElement>('.cp-pasa').forEach((el, i) => {
        const v = dice?.[i] ?? 0;
        (el.firstElementChild as HTMLElement).innerHTML = v ? ChauparView.pips(v) : '';
        el.classList.toggle('blank', !v);
        el.classList.toggle('used', !!dice && s.used[i]);
      });
      this.trayVal.textContent = dice ? dice.join(' · ') : '';
    } else {
      this.tray.querySelectorAll<HTMLImageElement>('.cp-shell').forEach((el, i) => {
        const up = !!(dice && shells?.[i]);
        el.src = `${TEX}cowrie_${up ? 'up' : 'down'}.webp`;
        el.classList.toggle('used', !!dice && s.used[0]);
        el.classList.toggle('idle', !dice);
      });
      const v = dice?.[0];
      this.trayVal.textContent = v ? `${v}${GRACE.includes(v) ? ' — милость!' : ''}` : '';
    }
  }

  private async rollAnim(s: CState, dice: number[], shells: boolean[] | undefined, sp: number) {
    this.ensureTray(s.cfg.throws);
    const dur = Math.round(900 / Math.max(0.5, sp));
    Sound.diceRoll(dur / 1000);
    const items = [...this.tray.children] as HTMLElement[];
    items.forEach((el, i) => {
      const dx = (Math.random() * 40 - 20) * (i % 2 ? 1 : -1);
      el.animate(
        [
          { transform: `translate(${-90 + dx}px, -46px) rotate(${-200 + i * 40}deg)`, offset: 0 },
          { transform: `translate(${-20 + dx / 2}px, 8px) rotate(-60deg)`, offset: 0.5 },
          { transform: `translate(${dx * 0.1}px, -6px) rotate(-10deg)`, offset: 0.75 },
          { transform: 'translate(0, 0) rotate(0deg)', offset: 1 },
        ],
        { duration: dur, easing: 'cubic-bezier(.25,.7,.35,1)' },
      );
    });
    // мелькание граней по дороге
    const t0 = performance.now();
    while (performance.now() - t0 < dur * 0.7) {
      const fake = s.cfg.throws === 'pasa' ? dice.map(() => [1, 2, 5, 6][Math.floor(Math.random() * 4)]) : null;
      const fs = Array.from({ length: 6 }, () => Math.random() < 0.5);
      this.showTray({ ...s, used: s.used.map(() => false) }, fake ?? [0], fs);
      this.trayVal.textContent = '';
      await sleep(90);
    }
    await sleep(dur * 0.3);
    this.showTray({ ...s, used: dice.map(() => false) }, dice, shells);
  }

  // ---------------------------------------------------------------- ходы

  async play(events: CEvent[], v: CState) {
    const sp = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      if (ev.type === 'roll') {
        if (this.s) await this.rollAnim(this.s, ev.dice, ev.shells, sp);
        if (ev.noMoves) {
          Sound.nomove();
          await sleep(700 / sp);
        }
      } else if (this.s) {
        const s: CState = { ...this.s, players: this.s.players.map((p) => ({ ...p, pieces: p.pieces.slice() })) };
        const pl = s.players.find((p) => p.seat === ev.seat)!;
        if (ev.from < 0) Sound.enter();
        for (const p of ev.path) {
          pl.pieces[ev.piece] = p;
          this.place(s, true);
          if (ev.from >= 0) Sound.step();
          await sleep(Math.max(45, 120 / sp));
        }
        if (ev.captured.length) {
          await sleep(120 / sp);
          for (const c of ev.captured) s.players.find((p) => p.seat === c.seat)!.pieces[c.piece] = -1;
          Sound.capture();
          this.place(s, true);
          await sleep(380 / sp);
        } else if (ev.home) Sound.home();
        if (ev.win) Sound.win();
        this.s = s;
        // израсходованная кость гаснет сразу
        this.showTray(v, v.phase === 'move' || ev.turnEnd == null ? s.dice : null, s.shells);
      }
    }
    this.s = v;
    this.place(v);
    this.showTray(v, v.phase === 'move' ? v.dice : null, v.shells);
  }

  private clearTurn() {
    clearTimeout(this.autoTimer);
    this.rollBtn.disabled = true;
    this.rollBtn.classList.remove('pulse');
    this.rollSeat = null;
    this.moves = [];
    this.gTargets.innerHTML = '';
    for (const el of this.els.values()) el.classList.remove('can', 'sel');
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.clearTurn();
    const s = this.s;
    if (!s || s.phase === 'over' || this.ctx.demo) return;
    const seat = s.players[s.cur].seat;
    if (!interactive.includes(seat)) return;
    if (s.phase === 'roll') {
      this.rollSeat = seat;
      this.rollBtn.disabled = false;
      this.rollBtn.classList.add('pulse');
      return;
    }
    this.moves = legalMoves(s);
    for (const m of this.moves) this.els.get(`${seat}:${m.piece}`)?.classList.add('can');
    const distinct = new Set(this.moves.map((m) => `${m.from}>${m.to}`));
    if (this.ctx.autoSingle() && distinct.size === 1) {
      const m = this.moves[0];
      this.autoTimer = setTimeout(() => {
        if (this.s === s) {
          this.clearTurn();
          this.ctx.act(seat, { type: 'move', piece: m.piece, die: m.die, to: m.to });
        }
      }, 500 / this.ctx.speed());
    }
  }

  /** Выбрали фишку — показываем, куда она может встать (по одной цели на клетку). */
  private pick(k: number) {
    const s = this.s!;
    const seat = s.players[s.cur].seat;
    const from = s.players[s.cur].pieces[k];
    const opts = this.moves.map((m, i) => [m, i] as const).filter(([m]) => m.from === from);
    if (!opts.length) return;
    for (const el of this.els.values()) el.classList.remove('sel');
    this.els.get(`${seat}:${k}`)?.classList.add('sel');
    const seen = new Set<number>();
    const parts: string[] = [];
    for (const [m, i] of opts) {
      if (seen.has(m.to)) continue;
      seen.add(m.to);
      let x: number;
      let y: number;
      if (m.to >= GOAL) [x, y] = armPt(seat, 0, 0.85, this.rot);
      else {
        const [a, col, row] = cellOf(seat, m.to)!;
        const r = this.cellRect(a, col, row);
        [x, y] = [r.cx, r.cy];
      }
      parts.push(`<g class="cp-target" data-i="${i}"><rect x="${x - 0.47}" y="${y - 0.47}" width="0.94" height="0.94" rx="0.14"/><text x="${x}" y="${y + 0.17}">${m.from < 0 ? '↓' : m.value}</text></g>`);
    }
    this.gTargets.innerHTML = parts.join('');
    // цели — на передний план относительно доски, но под фишками их не спрятать: поднимаем слой
    this.svg.appendChild(this.gTargets);
  }

  private roll() {
    if (this.rollSeat == null) return;
    Sound.unlock();
    const seat = this.rollSeat;
    this.clearTurn();
    this.ctx.act(seat, { type: 'roll' });
  }

  status(s: CState, _toAct: number[], interactive: number[]) {
    if (s.phase === 'over') {
      if (!s.winners) return 'Партия окончена';
      return `Победа: ${s.winners.map((w) => this.ctx.name(w)).join(' и ')}!`;
    }
    const seat = s.players[s.cur].seat;
    const who = this.ctx.name(seat);
    if (!interactive.includes(seat)) return s.phase === 'roll' ? `${who} бросает…` : `${who} ходит…`;
    if (s.phase === 'roll') return `Ход: ${who} — бросайте ${s.cfg.throws === 'pasa' ? 'пасы' : 'каури'}`;
    const free = s.dice.filter((_d, i) => !s.used[i]).join(', ');
    return `${who}: ходите (${free})`;
  }

  playerStats(s: CState, seat: number) {
    const p = s.players.find((x) => x.seat === seat);
    if (!p) return '';
    return `<span title="В центре">🏁 ${p.pieces.filter((x) => x >= GOAL).length}</span><span title="Ждут входа">⬤ ${p.pieces.filter((x) => x < 0).length}</span>`;
  }

  destroy() {
    clearTimeout(this.autoTimer);
    document.removeEventListener('keydown', this.onKey);
  }
}

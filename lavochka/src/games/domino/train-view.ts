/* Домино — «Мексиканский поезд»: отрисовка. Слева — станция с дублем, от неё вправо поезда: сверху мексиканский,
 * ниже — по поезду на игрока, с паровозиком, если поезд открыт. Своя рука — внизу; выбрал кость → подсветились концы
 * поездов, куда её можно поставить → нажал. Хот-сит: перед ходом — занавеска. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { backSvg, boneSvg, CX, H, NS, planksSvg, W } from './draw';
import { sameBone, type Bone } from './engine';
import { MEX, trainMoves, yardLeft, type TAction, type TEvent, type TMove, type TView } from './train';

const X0 = 175;
const XMAX = W - 105;
const TOP = 105;
const BOTTOM = 545;

class TrainView implements GameView<TView, TEvent> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private gTable!: SVGGElement;
  private gGhost!: SVGGElement;
  private gHands!: SVGGElement;
  private gBanner!: SVGGElement;
  private btns!: HTMLElement;
  private cover!: HTMLElement;
  private v: TView | null = null;
  private viewer = 0;
  private hidden = false;
  private actSeat: number | null = null;
  private selected: Bone | null = null;
  private moves: TMove[] = [];
  private fresh: { train: number; i: number } | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="dm-wrap">
        <svg class="dm-board" xmlns="${NS}" viewBox="0 0 ${W} ${H}">
          <defs>
            <linearGradient id="dmIvory" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf4e2"/><stop offset="1" stop-color="#e2d4b4"/></linearGradient>
            <radialGradient id="dmBrass"><stop offset="0" stop-color="#ffe9a8"/><stop offset=".6" stop-color="#c9963a"/><stop offset="1" stop-color="#7a5414"/></radialGradient>
            <filter id="dmShadow" x="-20%" y="-30%" width="140%" height="160%"><feDropShadow dx="1.5" dy="2.5" stdDeviation="1.6" flood-color="#0a1408" flood-opacity=".55"/></filter>
          </defs>
          <g class="dm-planks">${planksSvg()}</g>
          <g class="dm-table"></g><g class="dm-ghost"></g><g class="dm-hands"></g><g class="dm-banner"></g>
        </svg>
        <div class="dm-cover" hidden><div class="dm-cover-box"><div class="dm-cover-t"></div><button class="btn primary">Показать кости</button></div></div>
      </div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.gTable = this.svg.querySelector('.dm-table') as SVGGElement;
    this.gGhost = this.svg.querySelector('.dm-ghost') as SVGGElement;
    this.gHands = this.svg.querySelector('.dm-hands') as SVGGElement;
    this.gBanner = this.svg.querySelector('.dm-banner') as SVGGElement;
    this.cover = wrap.querySelector('.dm-cover') as HTMLElement;
    const ctl = h(`<div class="dm-controls"><div class="dm-btns"></div>${ctx.demo ? '' : '<div class="hint small-hint">Нажмите на свою кость, потом — на подсвеченный конец поезда.</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.dm-btns') as HTMLElement;
    this.svg.addEventListener('click', (e) => this.onClick(e));
  }

  // ---------------------------------------------------------------- поезда

  /** Ряды: мексиканский и поезда мест (свой — ближе к руке, внизу). */
  private rows(v: TView): number[] {
    const others = v.seats.filter((x) => x !== this.viewer);
    return [MEX, ...others, ...(v.seats.includes(this.viewer) ? [this.viewer] : [])];
  }

  private rowY(v: TView, train: number): number {
    const rows = this.rows(v);
    const i = rows.indexOf(train);
    const step = (BOTTOM - TOP) / Math.max(1, rows.length - 1);
    return TOP + i * step;
  }

  /** Единица кости в ряду: длинный поезд ужимается. */
  private unit(v: TView, train: number, extra = 0): number {
    const n = v.trains[train].length + extra;
    return Math.min(40, (XMAX - X0) / Math.max(1, n * 2 + 0.2));
  }

  private tileAt(v: TView, train: number, i: number, extra = 0): [number, number, number] {
    const u = this.unit(v, train, extra);
    return [X0 + u + i * 2 * u, this.rowY(v, train), u];
  }

  private label(train: number) {
    return train === MEX ? 'Мексиканский' : this.ctx.name(train).replace(/<[^>]+>/g, '');
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    let t = '';
    // станция
    const sy = (TOP + BOTTOM) / 2;
    t += `<circle cx="95" cy="${sy}" r="58" class="tr-station"/>`;
    t += boneSvg(v.engine, v.engine, 95, sy, 40, 90, '', 'filter="url(#dmShadow)"');
    for (const train of this.rows(v)) {
      const y = this.rowY(v, train);
      t += `<path d="M 125 ${sy} C 150 ${sy}, 140 ${y}, ${X0 - 6} ${y}" class="tr-rail"/>`;
      const open = train !== MEX && v.open[train];
      const due = v.due === train;
      t += `<text class="tr-label ${train === this.viewer ? 'tr-mine' : ''}" x="${X0}" y="${y - 26}">${this.label(train)}${open ? ' 🚂' : ''}${due ? ' — закрыть дубль!' : ''}</text>`;
      v.trains[train].forEach((tile, i) => {
        const [x, yy, u] = this.tileAt(v, train, i);
        const dbl = tile.a === tile.b;
        const fresh = this.fresh && this.fresh.train === train && this.fresh.i === i;
        t += boneSvg(tile.a, tile.b, x, yy, u, dbl ? 90 : 0, fresh ? 'dm-fresh' : '', 'filter="url(#dmShadow)"');
      });
    }
    const yd = yardLeft(v);
    if (yd) {
      for (let i = 0; i < Math.min(yd, 8); i++) t += backSvg(W - 70 + (i % 4) * 4, 70 + Math.floor(i / 4) * 30 - i * 1.5, 22, 90);
      t += `<text class="dm-label" x="${W - 120}" y="128">базар: ${yd}</text>`;
    }
    t += `<text class="dm-label" x="40" y="60">Кон ${v.round} из ${v.cfg.rounds}</text>`;
    this.gTable.innerHTML = t;
    this.drawHands();
    this.drawGhosts();
  }

  private drawHands() {
    const v = this.v!;
    let s = '';
    const mine = this.ctx.mySeats.includes(this.viewer) && !this.hidden;
    const hand = mine || this.ctx.demo ? v.hands[this.viewer] : [];
    if (hand.length) {
      const gap = Math.min(54, 760 / Math.max(1, hand.length));
      const size = gap / 1.12;
      const x0 = CX - ((hand.length - 1) * gap) / 2;
      const playable = new Set(this.moves.map((m) => `${m.bone[0]}-${m.bone[1]}`));
      hand.forEach((b, i) => {
        const key = `${b[0]}-${b[1]}`;
        const sel = this.selected && sameBone(this.selected, b);
        const cls = `${playable.has(key) ? 'dm-can' : ''} ${sel ? 'dm-sel' : ''}`;
        s += boneSvg(b[0], b[1], x0 + i * gap, H - 58 - (sel ? 14 : 0), size, 90, `dm-hand ${cls}`, `data-bone="${key}" filter="url(#dmShadow)"`);
      });
    }
    // у соперников — сколько костей, рубашками у подписи поезда
    for (const seat of v.seats) {
      if (seat === this.viewer) continue;
      const y = this.rowY(v, seat);
      const n = v.counts[seat];
      for (let i = 0; i < n; i++) s += backSvg(XMAX + 30 + (i % 4) * 9, y - 12 + Math.floor(i / 4) * 10, 9, 90);
    }
    if (v.phase !== 'over') {
      const y = this.rowY(v, v.turn);
      s += `<text class="dm-turn" x="${X0 - 70}" y="${y + 5}">◆</text>`;
    }
    this.gHands.innerHTML = s;
  }

  private drawGhosts() {
    const v = this.v!;
    let g = '';
    if (this.selected && this.actSeat != null) {
      for (const m of this.moves.filter((x) => sameBone(x.bone, this.selected!))) {
        const i = v.trains[m.train].length;
        const [x, y, u] = this.tileAt(v, m.train, i, 1);
        const end = i ? v.trains[m.train][i - 1].b : v.engine;
        const b = m.bone[0] === end ? m.bone[1] : m.bone[0];
        g += boneSvg(end, b, x, y, u, end === b ? 90 : 0, 'dm-ghost-bone', `data-train="${m.train}"`);
      }
    }
    this.gGhost.innerHTML = g;
  }

  // ---------------------------------------------------------------- ход

  private onClick(e: MouseEvent) {
    const seat = this.actSeat;
    if (!this.v || seat == null || this.hidden) return;
    const ghost = (e.target as Element).closest('[data-train]') as SVGElement | null;
    if (ghost && this.selected) {
      this.send({ type: 'play', bone: this.selected, train: +ghost.dataset.train! });
      return;
    }
    const bone = (e.target as Element).closest('[data-bone]') as SVGElement | null;
    if (bone) {
      const [a, b] = bone.dataset.bone!.split('-').map(Number) as Bone;
      const mine = this.moves.filter((x) => sameBone(x.bone, [a, b]));
      if (!mine.length) {
        Sound.nomove();
        return;
      }
      if (mine.length === 1 && this.ctx.autoSingle()) return this.send({ type: 'play', bone: mine[0].bone, train: mine[0].train });
      this.selected = [a, b];
      Sound.ui();
      this.draw();
      return;
    }
    this.selected = null;
    this.draw();
  }

  private send(a: TAction) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.clearTurn();
    this.ctx.act(seat, a);
  }

  private clearTurn() {
    this.actSeat = null;
    this.selected = null;
    this.moves = [];
    this.btns.innerHTML = '';
    if (this.v) this.draw();
  }

  private button(text: string, on: () => void) {
    const b = h<HTMLButtonElement>(`<button class="btn primary">${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    this.btns.appendChild(b);
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const v = this.v;
    if (!v || this.actSeat == null || this.ctx.demo || this.hidden || this.moves.length) return;
    if (!v.drew && yardLeft(v)) this.button(`Взять из базара (${yardLeft(v)})`, () => this.send({ type: 'draw' }));
    else this.button('Пропустить — паровозик на свой поезд', () => this.send({ type: 'pass' }));
  }

  setView(v: TView) {
    this.v = v;
    this.fresh = null;
    this.gBanner.innerHTML = '';
    this.draw();
  }

  async play(events: TEvent[], v: TView) {
    const speed = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      if (ev.type === 'tplay') {
        const cur = this.v!;
        this.v = {
          ...cur,
          trains: cur.trains.map((t, i) => (i === ev.train ? [...t, ev.tile] : t)),
          hands: cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((b) => !sameBone(b, ev.bone)) : hh)),
          counts: cur.counts.map((c, i) => (i === ev.seat ? c - 1 : c)),
        };
        this.fresh = { train: ev.train, i: this.v.trains[ev.train].length - 1 };
        this.draw();
        Sound.place();
        if (ev.double) await this.banner('Дубль — закрывай!', 700 / speed);
        else await sleep(420 / speed);
      } else if (ev.type === 'tdraw') {
        Sound.card();
        await sleep(200 / speed);
      } else if (ev.type === 'tpass') {
        Sound.nomove();
        await this.banner('Паровозик!', 600 / speed);
      } else if (ev.type === 'tround') {
        Sound.place();
        await this.banner(ev.out == null ? 'Поезда встали' : 'Кон окончен', 1500 / speed);
      } else if (ev.type === 'tdeal') {
        Sound.shuffle();
      } else if (ev.type === 'tend') {
        Sound.win();
        this.v = v;
        this.draw();
        await this.banner('Приехали!', 0);
      }
    }
    this.v = v;
    this.fresh = null;
    this.draw();
  }

  private async banner(text: string, ms: number) {
    const cy = (TOP + BOTTOM) / 2;
    this.gBanner.innerHTML = `<g class="dm-bannerbox"><rect x="${CX - 200}" y="${cy - 40}" width="400" height="80" rx="14"/><text x="${CX}" y="${cy + 2}">${text}</text></g>`;
    if (!ms) return;
    await sleep(ms);
    this.gBanner.innerHTML = '';
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.clearTurn();
    const v = this.v;
    if (!v || v.phase === 'over' || this.ctx.demo) {
      if (v) this.draw();
      return;
    }
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    if (mine.length === 1) this.viewer = mine[0];
    else if (mine.length > 1) {
      const next = toAct.find((x) => mine.includes(x));
      if (next != null && next !== this.viewer) {
        this.viewer = next;
        this.hidden = true;
      }
    } else if (!v.seats.includes(this.viewer)) this.viewer = v.seats[0];
    const seat = interactive.find((x) => x === this.viewer) ?? null;
    if (this.hidden && interactive.length && mine.length > 1) {
      (this.cover.querySelector('.dm-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте ход — остальным не подглядывать!</small>`;
      this.cover.hidden = false;
    } else {
      this.hidden = false;
      this.cover.hidden = true;
    }
    this.actSeat = seat;
    if (seat != null) this.moves = trainMoves(v, seat, v.hands[seat]);
    this.draw();
    this.renderButtons();
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
  }

  status(v: TView, toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    if (v.phase === 'over') return `Приехали первыми: ${v.winners.map(name).join(' и ')}`;
    const who = toAct[0];
    if (who == null) return '';
    if (!interactive.includes(who)) return `Ходит ${name(who)}…`;
    if (v.due != null) return `Закройте дубль на поезде «${this.label(v.due)}»`;
    const can = trainMoves(v, who, v.hands[who]).length > 0;
    return can ? 'Ваш ход: свой поезд, мексиканский или чужой с паровозиком' : !v.drew && yardLeft(v) ? 'Нечем ходить — берите из базара' : 'Нечем ходить — пропускайте';
  }

  playerStats(v: TView, seat: number) {
    return `<span title="Костей на руке">${v.counts[seat]} к.</span> · <span title="Очков на себе">${v.scores[seat]} оч.</span>${v.open[seat] ? ' · 🚂' : ''}`;
  }
}

export function createTrainView(): GameView<TView, TEvent> {
  return new TrainView();
}

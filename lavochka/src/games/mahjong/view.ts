/* Пасьянс маджонг — отрисовка: стол с сукном, кости в SVG с объёмом (draw.ts). Верхние этажи сдвинуты влево-вверх, торцы — вниз-вправо.
 * Нажали на свободную кость — выбрана; нажали на такую же свободную — пара уходит. В соединялке на миг видна линия. */
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { canPair, geoOf, isFree, left, linkPath, pairScore, pairsOf } from './engine';
import { geoOfCfg, layoutOfCfg, shufflesLeft, type Action, type Event, type View } from './def';
import { tileDefs, tileSvg } from './draw';
import { kindName, kindOf } from './tiles';
import './mahjong.css';

export const PREF_DIM = 'mahjong.dim';
export const RECORDS = 'mahjong.records';
export interface Record_ {
  title: string;
  played: number;
  won: number;
  best: number;
}

const TW = 60;
const TH = 80;
const DZ = 10; // сдвиг этажа
const PAD = 24;

const fmt = (ms: number) => {
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

class MahjongView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private gTiles!: SVGGElement;
  private gFx!: SVGGElement;
  private banner!: HTMLElement;
  private info!: HTMLElement;
  private btns!: HTMLElement;
  private v: View | null = null;
  private seat = 0;
  private live = false;
  private busy = 0;
  private sel: number | null = null;
  private hint: [number, number] | null = null;
  private hintTimer = 0;
  private t0 = Date.now();
  private tEnd = 0;
  private dealKey = '';
  private tick = 0;
  private recorded = false;
  private box = { x: 0, y: 0, w: 100, h: 100 };
  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.send({ t: 'undo' });
    }
  };

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="mj-wrap"><svg class="mj-board" xmlns="http://www.w3.org/2000/svg"><defs>${tileDefs()}</defs><g class="mj-tiles"></g><g class="mj-fx"></g></svg>
      <div class="mj-banner" hidden></div></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.gTiles = this.svg.querySelector('.mj-tiles') as SVGGElement;
    this.gFx = this.svg.querySelector('.mj-fx') as SVGGElement;
    this.banner = wrap.querySelector('.mj-banner') as HTMLElement;
    this.svg.addEventListener('click', (e) => this.onClick(e));
    const ctl = h(`<div class="mj-controls"><div class="mj-info"></div><div class="mj-btns"></div>
      ${ctx.demo ? '' : '<div class="hint small-hint">Нажмите на свободную кость, потом на такую же. Цветок — к любому цветку, сезон — к любому сезону. Ctrl+Z — отменить.</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.info = ctl.querySelector('.mj-info') as HTMLElement;
    this.btns = ctl.querySelector('.mj-btns') as HTMLElement;
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);
    this.tick = window.setInterval(() => this.renderInfo(), 1000);
  }

  destroy() {
    document.removeEventListener('keydown', this.onKey);
    clearInterval(this.tick);
    clearTimeout(this.hintTimer);
  }

  // ---------------------------------------------------------------- геометрия

  private xy(i: number): [number, number] {
    const p = layoutOfCfg(this.v!.cfg).pos[i];
    return [PAD + (p.x * TW) / 2 - p.z * DZ, PAD + (p.y * TH) / 2 - p.z * DZ];
  }

  private fitBox(v: View) {
    const pos = layoutOfCfg(v.cfg).pos;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pos) {
      const x = (p.x * TW) / 2 - p.z * DZ;
      const y = (p.y * TH) / 2 - p.z * DZ;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + TW + 10);
      y1 = Math.max(y1, y + TH + 10);
    }
    const m = v.cfg.layout === 'connect' ? TW * 0.7 : 10;
    this.box = { x: PAD + x0 - m, y: PAD + y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
    this.svg.setAttribute('viewBox', `${this.box.x} ${this.box.y} ${this.box.w} ${this.box.h}`);
  }

  // ---------------------------------------------------------------- отрисовка

  private board() {
    return this.v?.boards[this.seat];
  }

  private draw() {
    const v = this.v;
    const b = this.board();
    if (!v || !b) return;
    const l = layoutOfCfg(v.cfg);
    const g = geoOf(l);
    const dim = store.get<string>(PREF_DIM, 'on') !== 'off';
    const order = l.pos.map((_, i) => i).sort((a, c) => l.pos[a].z - l.pos[c].z || l.pos[a].y - l.pos[c].y || l.pos[a].x - l.pos[c].x);
    let s = '';
    const canAct = this.live && !b.end;
    for (const i of order) {
      const id = b.t[i];
      if (id < 0) continue;
      const free = isFree(g, b.t, i);
      const [x, y] = this.xy(i);
      const cls = [free ? 'mj-free' : dim ? 'mj-blocked' : '', canAct && free ? 'mj-can' : '', this.sel === i ? 'mj-sel' : '', this.hint?.includes(i) ? 'mj-hint' : ''].join(' ');
      s += tileSvg(kindOf(id), x, y, TW, TH, { d: 9, cls, attrs: `data-i="${i}"` });
    }
    this.gTiles.innerHTML = s;
  }

  private renderInfo() {
    const v = this.v;
    const b = this.board();
    if (!v || !b) return;
    const total = layoutOfCfg(v.cfg).pos.length;
    const g = geoOfCfg(v.cfg);
    const sh = shufflesLeft(v.cfg, b);
    const pairs = b.end ? 0 : pairsOf(g, b.t).length;
    const time = this.ctx.demo ? '' : `<div><span>Время</span><b>${fmt((this.tEnd || Date.now()) - this.t0)}</b></div>`;
    this.info.innerHTML = `<div class="mj-stats">
      <div><span>Осталось</span><b>${left(b.t)} из ${total}</b></div>
      <div><span>Пар доступно</span><b>${pairs}</b></div>
      <div><span>Ходов</span><b>${b.moves}</b></div>${time}
      <div><span>Перемешать</span><b>${sh === Infinity ? '∞' : sh}</b></div></div>`;
  }

  private renderButtons() {
    const v = this.v;
    const b = this.board();
    this.btns.innerHTML = '';
    if (!v || !b || !this.live || this.ctx.demo) return;
    const btn = (label: string, cls: string, fn: () => void, off = false) => {
      const e = h(`<button class="btn ${cls}">${label}</button>`) as HTMLButtonElement;
      e.disabled = off || !!b.end;
      e.onclick = fn;
      this.btns.appendChild(e);
    };
    const g = geoOfCfg(v.cfg);
    const stuck = !pairsOf(g, b.t).length;
    btn('Подсказка', '', () => this.showHint(), stuck);
    btn(stuck ? 'Перемешать — пар нет' : 'Перемешать', stuck ? 'primary' : '', () => this.send({ t: 'shuffle' }), shufflesLeft(v.cfg, b) <= 0);
    btn('Отменить ход', '', () => this.send({ t: 'undo' }), !b.undo);
    btn('Сдаться', 'ghost', () => this.send({ t: 'giveup' }));
  }

  private showHint() {
    const v = this.v;
    const b = this.board();
    if (!v || !b) return;
    const g = geoOfCfg(v.cfg);
    const ps = pairsOf(g, b.t);
    if (!ps.length) return;
    ps.sort((p, q) => pairScore(g, b.t, q[0], q[1]) - pairScore(g, b.t, p[0], p[1]));
    this.hint = ps[0];
    this.sel = null;
    this.draw();
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      this.hint = null;
      this.draw();
    }, 2500);
  }

  private send(a: Action) {
    if (!this.live || this.busy) return;
    const b = this.board();
    if (!b || b.end) return;
    this.busy = Date.now();
    Sound.unlock();
    this.ctx.act(this.seat, a);
    // если ответ не пришёл (ход отклонён) — не зависнуть
    window.setTimeout(() => {
      if (this.busy && Date.now() - this.busy > 1500) this.busy = 0;
    }, 1600);
  }

  private onClick(e: MouseEvent) {
    const el = (e.target as Element).closest('[data-i]');
    const v = this.v;
    const b = this.board();
    if (!el || !v || !b || !this.live || b.end || this.busy) return;
    const i = Number(el.getAttribute('data-i'));
    const g = geoOfCfg(v.cfg);
    if (!g.connect && !isFree(g, b.t, i)) {
      el.classList.add('mj-shake');
      window.setTimeout(() => el.classList.remove('mj-shake'), 350);
      return;
    }
    if (this.sel === i) {
      this.sel = null;
    } else if (this.sel != null && canPair(g, b.t, this.sel, i)) {
      const a = this.sel;
      this.sel = null;
      this.send({ t: 'pair', a, b: i });
      return;
    } else {
      this.sel = i;
      Sound.ui();
    }
    this.draw();
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    const key = JSON.stringify(v.cfg) + ':' + v.seats.join(',');
    const fresh = this.dealKey !== key || !this.v;
    this.v = v;
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    this.seat = mine[0] ?? v.seats[0];
    if (fresh) {
      this.dealKey = key;
      this.t0 = Date.now();
      this.tEnd = 0;
      this.recorded = false;
      this.fitBox(v);
    }
    const b = this.board();
    if (b && b.moves === 0 && b.shuffles === 0 && !b.end) {
      // новая раздача той же раскладки («Сыграть ещё»)
      if (this.tEnd) {
        this.t0 = Date.now();
        this.tEnd = 0;
        this.recorded = false;
      }
    }
    if (b?.end && !this.tEnd) this.tEnd = Date.now();
    if (this.sel != null && (!b || b.t[this.sel] < 0)) this.sel = null;
    this.busy = 0;
    this.draw();
    this.renderInfo();
    this.renderButtons();
    this.showEnd();
  }

  private showEnd() {
    const v = this.v;
    const b = this.board();
    if (!v || !b) return;
    if (!b.end) {
      this.banner.hidden = true;
      return;
    }
    const time = fmt((this.tEnd || Date.now()) - this.t0);
    this.banner.hidden = false;
    this.banner.innerHTML =
      b.end === 1
        ? `<b>Разобрано!</b><span>${b.moves} ходов · ${time}${v.seats.length > 1 ? ` · ${v.order.indexOf(this.seat) + 1}-е место` : ''}</span>`
        : `<b>${left(b.t) ? 'Пар больше нет' : 'Конец'}</b><span>осталось ${left(b.t)} костей</span>`;
    if (!this.recorded && !this.ctx.demo && this.ctx.mySeats.includes(this.seat)) {
      this.recorded = true;
      const all = store.get<Record<string, Record_>>(RECORDS, {});
      const l = layoutOfCfg(v.cfg);
      const key = l.id + (v.cfg.solvable ? '' : '-rnd');
      const r = all[key] ?? { title: l.label + (v.cfg.solvable ? '' : ' (как ляжет)'), played: 0, won: 0, best: 0 };
      r.played++;
      if (b.end === 1) {
        r.won++;
        const ms = Math.round(((this.tEnd || Date.now()) - this.t0) / 1000);
        if (!r.best || ms < r.best) r.best = ms;
      }
      all[key] = r;
      store.set(RECORDS, all);
    }
  }

  async play(events: Event[], v: View) {
    for (const ev of events) {
      if (ev.type === 'pair' && ev.seat === this.seat && this.v) {
        const b = this.board()!;
        const g = geoOfCfg(this.v.cfg);
        if (g.connect) this.drawLink(b.t, ev.a, ev.b);
        for (const i of [ev.a, ev.b]) this.gTiles.querySelector(`[data-i="${i}"]`)?.classList.add('mj-gone');
        Sound.place();
        await sleep(g.connect ? 420 : this.ctx.demo ? 420 : 200);
        this.gFx.innerHTML = '';
        // промежуточная доска, чтобы демо шло по шагам
        const t = b.t.slice();
        t[ev.a] = -1;
        t[ev.b] = -1;
        this.v = { ...this.v, boards: { ...this.v.boards, [this.seat]: { ...b, t, moves: b.moves + 1 } } };
        this.draw();
      } else if (ev.type === 'shuffle' && ev.seat === this.seat) {
        Sound.shuffle();
        this.gTiles.classList.add('mj-shuffling');
        await sleep(260);
        this.gTiles.classList.remove('mj-shuffling');
      } else if (ev.type === 'won') {
        if (ev.seat === this.seat) Sound.win();
      }
    }
    this.setView(v);
  }

  private drawLink(t: number[], a: number, b: number) {
    const v = this.v!;
    const g = geoOfCfg(v.cfg);
    const path = linkPath(g, t, a, b);
    if (!path) return;
    const pts = path.map(([c, r]) => `${PAD + c * TW + TW / 2},${PAD + r * TH + TH / 2}`).join(' ');
    this.gFx.innerHTML = `<polyline class="mj-link" points="${pts}"/>`;
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.live = interactive.includes(this.seat);
    this.renderButtons();
    this.draw();
  }

  status(v: View, _toAct: number[], interactive: number[]) {
    const b = v.boards[this.seat];
    if (!b) return '';
    const l = layoutOfCfg(v.cfg).label;
    if (b.end === 1) return `${l}: разобрано!`;
    if (b.end === 2) return `${l}: тупик`;
    if (!interactive.includes(this.seat)) return `${l}: смотрим`;
    const g = geoOfCfg(v.cfg);
    if (!pairsOf(g, b.t).length) return shufflesLeft(v.cfg, b) > 0 ? 'Пар нет — перемешайте кости' : 'Пар нет';
    if (this.sel != null && b.t[this.sel] >= 0) return `Выбрано: ${kindName(kindOf(b.t[this.sel]))} — найдите пару`;
    return g.connect ? `${l}: соедините пару одинаковых костей` : `${l}: найдите пару свободных костей`;
  }

  playerStats(v: View, seat: number) {
    const b = v.boards[seat];
    if (!b) return '';
    return b.end === 1 ? `разобрал · ${b.moves} ходов` : `осталось ${left(b.t)}`;
  }
}

export function createView(): GameView<View, Event> {
  return new MahjongView();
}


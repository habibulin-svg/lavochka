/* Криббедж — отрисовка: доска с колышками (дерево, по дорожке на сторону, 120 лунок группами по пять, вверх и обратно, в конце — 121-я),
 * у каждой стороны два колышка — передний (счёт) и задний (прежний счёт): очки «перешагивают» задним через передний.
 * Справа — карты: своя рука внизу, соперники сверху, посередине розыгрыш с суммой, колода со стартером, криб у сдатчика.
 * Ход: сброс — выбрать карты и «В криб»; розыгрыш — касание подсвеченной карты. Показ рук — сам, по порядку, с разбором очков. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck, deckStyle } from '../../cards/render';
import { CardStage, cardKey, fan, type Point, type StageItem } from '../../cards/stage';
import { sameCard, sortHand, type Card } from '../../cards/deck';
import { canPlay, discardN, mates, pairs, sumItems, type Action, type Event, type Item, type View } from './engine';
import { SEATS, cn } from './def';
import '../../cards/trickview.css';
import './cribbage.css';

type Geo = { port: boolean; W: number; H: number; cx: number };
const LAND: Geo = { port: false, W: 1000, H: 720, cx: 610 };
const PORT: Geo = { port: true, W: 540, H: 900, cx: 270 };

/** Места лунок на доске: lane — дорожка стороны, i — 0 (старт) … 121 (финиш). */
function hole(g: Geo, lanes: number, lane: number, i: number, back = false): Point {
  if (!g.port) {
    const x0 = 22;
    const y0 = 22;
    const w = 176;
    const h = 676;
    const yb = y0 + h - 54;
    const yt = y0 + 52;
    const step = (yb - yt) / (59 + 11 * 0.9);
    const gap = step * 0.9;
    const off = (j: number) => j * step + Math.floor(j / 5) * gap;
    const xl = x0 + 30 + lane * 17;
    const xr = x0 + w - 30 - lane * 17;
    if (i <= 0) return { x: xl + (back ? -0 : 0), y: yb + (back ? 34 : 20) };
    if (i >= 121) return { x: x0 + w / 2, y: yb + 30 };
    if (i <= 60) return { x: xl, y: yb - off(i - 1) };
    return { x: xr, y: yt + off(i - 61) };
  }
  const x0 = 10;
  const y0 = 10;
  const w = 520;
  const h = 150;
  const xl = x0 + 44;
  const xr = x0 + w - 26;
  const step = (xr - xl) / (59 + 11 * 0.9);
  const gap = step * 0.9;
  const off = (j: number) => j * step + Math.floor(j / 5) * gap;
  const yt = y0 + 24 + lane * 14;
  const yb = y0 + h - 24 - lane * 14;
  void lanes;
  if (i <= 0) return { x: xl - (back ? 30 : 18), y: yt };
  if (i >= 121) return { x: xl - 26, y: y0 + h / 2 };
  if (i <= 60) return { x: xl + off(i - 1), y: yt };
  return { x: xr - off(i - 61), y: yb };
}

function boardSvg(g: Geo, sides: { color: string; score: number; back: number }[], target: number): string {
  const lanes = sides.length;
  const W = g.port ? 540 : 220;
  const H = g.port ? 170 : 720;
  let holes = '';
  for (let lane = 0; lane < lanes; lane++) {
    for (let i = 1; i <= 120; i++) {
      const p = hole(g, lanes, lane, i);
      holes += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.3"/>`;
    }
    for (const b of [false, true]) {
      const p = hole(g, lanes, lane, 0, b);
      holes += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.6"/>`;
    }
  }
  const fin = hole(g, lanes, 0, 121);
  holes += `<circle cx="${fin.x}" cy="${fin.y}" r="4.4"/>`;
  // отметки 30, 60, 90 — латунные точки сбоку
  let marks = '';
  for (const k of [30, 60, 90]) {
    const p = hole(g, lanes, 0, k);
    const q = hole(g, lanes, lanes - 1, k);
    const mx = g.port ? p.x : Math.min(p.x, q.x) - 12;
    const my = g.port ? Math.min(p.y, q.y) - 11 : p.y;
    marks += `<text x="${(g.port ? mx : k > 60 ? Math.max(p.x, q.x) + 12 : mx).toFixed(1)}" y="${(g.port ? (k > 60 ? Math.max(p.y, q.y) + 15 : my) : my + 3).toFixed(1)}">${k}</text>`;
  }
  let pegs = '';
  sides.forEach((sd, lane) => {
    for (const [val, front] of [
      [sd.back, false],
      [sd.score, true],
    ] as const) {
      const p = hole(g, lanes, lane, val >= target ? 121 : val, !front && val === 0);
      pegs += `<g class="cb-peg${front ? ' front' : ''}" style="--pc:${sd.color}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><ellipse rx="4.6" ry="2.4" cy="3" class="sh"/><circle r="4.4"/><circle r="1.6" cx="-1.2" cy="-1.3" class="hl"/></g>`;
    }
  });
  const rect = g.port ? `<rect x="6" y="6" width="528" height="158" rx="22"/>` : `<rect x="12" y="12" width="196" height="696" rx="30"/>`;
  const inlay = g.port ? `<rect x="40" y="18" width="476" height="134" rx="12" class="inlay"/>` : `<rect x="30" y="56" width="160" height="610" rx="14" class="inlay"/>`;
  const title = g.port ? '' : `<text x="110" y="40" class="ttl">КРИББЕДЖ</text>`;
  return `<svg class="cb-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><linearGradient id="cbw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9824a"/><stop offset="0.5" stop-color="#9a6234"/><stop offset="1" stop-color="#7a4622"/></linearGradient></defs><g class="wood">${rect}</g>${inlay}${title}<g class="holes">${holes}</g><g class="marks">${marks}</g><g class="pegs">${pegs}</g></svg>`;
}

class CribbageView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private board!: HTMLElement;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private btns!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private actSeat: number | null = null;
  private selected: Card[] = [];
  /** Показ руки: какие карты открыты посередине и с каким разбором. */
  private shown: { seat: number; cards: Card[]; items: Item[]; crib: boolean } | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.viewer = ctx.mySeats[0] ?? 0;
    preloadDeck(deckStyle());
    this.cs = new CardStage(root, 1000, 720, 'cb-wrap', '<div class="cb-cloth"></div><div class="cb-board"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.board = this.cs.stage.querySelector('.cb-board') as HTMLElement;
    this.cs.over.innerHTML = '<div class="cb-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.cb-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cs.stage.addEventListener('click', (e) => this.onClick(e));
    if (ctx.demo) return;
    const ctl = h('<div class="cb-controls"><div class="cb-btns"></div></div>');
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.cb-btns') as HTMLElement;
  }

  private get g(): Geo {
    return this.cs.portrait ? PORT : LAND;
  }

  private others(v: View) {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]).slice(1);
  }

  private anchor(v: View, seat: number): Point {
    const g = this.g;
    if (seat === this.viewer) return g.port ? { x: 270, y: 800 } : { x: g.cx, y: 625 };
    const list = this.others(v);
    const k = list.indexOf(seat);
    const n = list.length;
    const span = g.port ? 360 : 520;
    const x = n === 1 ? g.cx : g.cx - span / 2 + (span * k) / (n - 1);
    return { x, y: g.port ? 240 : 92 };
  }

  private center(): Point {
    return this.g.port ? { x: 300, y: 470 } : { x: this.g.cx + 40, y: 345 };
  }

  private deckPt(): Point {
    return this.g.port ? { x: 60, y: 470 } : { x: 300, y: 345 };
  }

  private cribPt(v: View): Point {
    const a = this.anchor(v, v.dealer);
    if (v.dealer === this.viewer) return this.g.port ? { x: 470, y: 640 } : { x: 920, y: 600 };
    return { x: a.x + (this.g.port ? 90 : 120), y: a.y + 10 };
  }

  private layout(v: View): StageItem[] {
    const g = this.g;
    const items: StageItem[] = [];
    // колода и стартер
    const d = this.deckPt();
    for (let k = 0; k < 3; k++) items.push({ key: `deck:${k}`, card: null, x: d.x - k * 1.5, y: d.y - k * 2.5, r: 0, s: 0.55, z: 2 + k });
    if (v.starter) items.push({ key: 'st:' + cardKey(v.starter), card: v.starter, x: d.x + (g.port ? 0 : 0), y: d.y - 4, r: 0, s: 0.62, z: 8 });
    // криб
    const cribN = v.crib.length || v.seats.reduce((x, s) => x + (v.discards[s]?.length ?? 0), 0);
    const cp = this.cribPt(v);
    if (!(this.shown && this.shown.crib))
      for (let k = 0; k < cribN; k++) items.push({ key: `crib:${k}`, card: null, x: cp.x + k * 3, y: cp.y - k * 2, r: 8, s: 0.45, z: 30 + k });
    // розыгрыш: текущий отрезок посередине
    const c = this.center();
    const cur = v.pile;
    cur.forEach((p, i) => {
      items.push({ key: cardKey(p.card), card: p.card, x: c.x + (i - (cur.length - 1) / 2) * (g.port ? 40 : 46), y: c.y + (i % 2 ? 6 : 0), r: ((i * 5) % 7) - 3, s: g.port ? 0.6 : 0.66, z: 60 + i, fromPt: this.anchor(v, p.seat) });
    });
    // сыгранные раньше — перед владельцем, мелко
    const old = v.played.filter((p) => !cur.some((q) => sameCard(q.card, p.card)));
    for (const seat of v.seats) {
      const mine = old.filter((p) => p.seat === seat);
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      mine.forEach((p, i) => {
        const x = a.x + (me ? (g.port ? -170 : -260) : 0) + i * 22 - (me ? 0 : ((mine.length - 1) * 22) / 2);
        const y = me ? a.y - (g.port ? 150 : 140) : a.y + (g.port ? 92 : 98);
        items.push({ key: cardKey(p.card), card: p.card, x, y, r: 0, s: 0.4, z: 40 + i, cls: 'cb-old' });
      });
    }
    // показ руки
    if (this.shown) {
      const sh = this.shown;
      sh.cards.forEach((card, i) => {
        items.push({ key: 'show:' + cardKey(card), card, x: c.x + (i - (sh.cards.length - 1) / 2) * (g.port ? 70 : 84), y: c.y, r: 0, s: g.port ? 0.62 : 0.72, z: 120 + i });
      });
    }
    // руки
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      if (this.shown && this.shown.seat === seat && !this.shown.crib) continue;
      const list = v.phase === 'discard' ? v.hands[seat] : v.left[seat];
      const cnt = v.counts[seat];
      if (me && list.length) {
        const sorted = sortHand(list);
        sorted.forEach((card, k) => {
          const p = fan(sorted.length, k, a.x, a.y, g.port ? 380 : 470, g.port ? 76 : 92, 12, 8);
          const act = this.actSeat === seat;
          const ok = act && (v.phase === 'discard' || canPlay(v, seat, card));
          const sel = this.selected.some((x) => sameCard(x, card));
          items.push({ key: cardKey(card), card, x: p.x, y: p.y - (sel ? 30 : ok ? 12 : 0), r: p.r, s: g.port ? 0.95 : 1, z: 100 + k, cls: act ? (sel ? 'cs-sel' : ok ? 'cs-can' : 'tv-no') : '', data: ok ? { hand: card.s + card.r } : undefined });
        });
      } else
        for (let k = 0; k < cnt; k++) {
          const p = fan(cnt, k, a.x, a.y, g.port ? 70 : 110, 12, 6, 10);
          items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: me ? 1 : 0.45, z: 50 + k });
        }
    }
    return items;
  }

  private sides(v: View): { seat: number; color: string; score: number; back: number }[] {
    const out: { seat: number; color: string; score: number; back: number }[] = [];
    for (const x of v.seats) if (!out.some((o) => mates(v, o.seat).includes(x))) out.push({ seat: x, color: SEATS[x].color, score: v.score[x], back: v.back[x] });
    return out;
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    const g = this.g;
    this.board.innerHTML = boardSvg(g, this.sides(v), v.cfg.target);
    this.board.classList.toggle('port', g.port);
    this.cs.render(this.layout(v), this.ctx.speed());
    let s = '';
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const y = me ? a.y - (g.port ? 112 : 118) : a.y + (g.port ? 40 : 44);
      const x = Math.max(g.port ? 80 : 300, Math.min(g.W - 80, a.x));
      const deal = v.dealer === seat ? ' <i title="Сдаёт, его криб">✦ криб</i>' : '';
      s += `<div class="cs-plate${v.turn === seat || (v.phase === 'discard' && !v.discards[seat]) ? ' on' : ''}" style="--c:${SEATS[seat].color};left:${x}px;top:${y}px">${esc(this.plain(seat))} <b>${v.score[seat]}</b>${deal}</div>`;
    }
    const c = this.center();
    if (v.phase === 'peg' && !this.shown) s += `<div class="cb-count" style="left:${c.x}px;top:${c.y + (g.port ? 62 : 72)}px">${v.count}</div>`;
    if (this.shown) {
      const tot = sumItems(this.shown.items);
      const lines = this.shown.items.map((i) => `${i.what} <b>+${i.pts}</b>`).join(' · ') || 'ничего';
      s += `<div class="cb-show" style="left:${c.x}px;top:${c.y + (g.port ? 70 : 82)}px">${esc(this.plain(this.shown.seat))}${this.shown.crib ? ' — криб' : ''}: <b>${tot}</b><small>${lines}</small></div>`;
    }
    s += `<div class="tv-center${g.port ? '' : ' corner'}" style="left:${g.port ? 270 : 240}px;top:${g.port ? 176 : 24}px">Сдача ${v.deal}<small>до ${v.cfg.target}${pairs(v) ? ' · пара на пару' : ''}</small></div>`;
    this.plates.innerHTML = s;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private onClick(e: MouseEvent) {
    const v = this.v;
    if (!v || this.actSeat == null) return;
    const el = (e.target as Element).closest('[data-hand]') as HTMLElement | null;
    if (!el) return;
    const seat = this.actSeat;
    const list = v.phase === 'discard' ? v.hands[seat] : v.left[seat];
    const card = list.find((c) => c.s + c.r === el.dataset.hand);
    if (!card) return;
    if (v.phase === 'discard') {
      const i = this.selected.findIndex((x) => sameCard(x, card));
      if (i >= 0) this.selected.splice(i, 1);
      else {
        if (this.selected.length >= discardN(v)) this.selected.shift();
        this.selected.push(card);
      }
      Sound.ui();
      this.draw();
      this.renderButtons();
      return;
    }
    this.send({ type: 'play', card });
  }

  private send(a: Action) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.actSeat = null;
    this.selected = [];
    if (this.btns) this.btns.innerHTML = '';
    this.ctx.act(seat, a);
  }

  private renderButtons() {
    if (!this.btns) return;
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null) return;
    if (v.phase === 'discard') {
      const k = discardN(v);
      const mine = mates(v, seat).includes(v.dealer);
      this.btns.appendChild(h(`<div class="cb-ask">Выберите ${k === 2 ? 'две карты' : 'карту'} в криб — ${mine ? 'он ваш (сдаёте вы)' : 'он достанется сдатчику'}.</div>`));
      const b = h<HTMLButtonElement>(`<button class="btn primary"${this.selected.length === k ? '' : ' disabled'}>В криб${this.selected.length ? ': ' + this.selected.map(cn).join(' ') : ''}</button>`);
      b.onclick = () => this.send({ type: 'discard', cards: this.selected.slice() });
      this.btns.appendChild(b);
      return;
    }
    this.btns.appendChild(h(`<div class="cb-ask">Счёт ${v.count}: положите карту так, чтобы не перевалить за 31.</div>`));
  }

  // ---------------------------------------------------------------- события

  async play(events: Event[], v: View) {
    this.actSeat = null;
    this.selected = [];
    if (this.btns) this.btns.innerHTML = '';
    const sp = this.ctx.speed();
    for (const ev of events) {
      const cur = this.v!;
      if (ev.type === 'discard') {
        const hands = cur.hands.map((hh, i) => (i === ev.seat && hh.length ? hh.filter((c) => !ev.cards?.some((x) => sameCard(x, c))) : hh));
        const counts = cur.counts.map((c, i) => (i === ev.seat ? c - ev.n : c));
        const discards = cur.discards.map((d, i) => (i === ev.seat ? (ev.cards ?? Array.from({ length: ev.n }, () => ({ s: 'S', r: 0 }) as Card)) : d));
        this.v = { ...cur, hands, counts, discards };
        this.draw();
        Sound.card();
        await sleep(200 / sp);
      } else if (ev.type === 'starter') {
        this.v = { ...cur, starter: ev.card, phase: 'peg', crib: cur.seats.flatMap((x) => cur.discards[x] ?? []).concat(cur.crib) };
        this.draw();
        Sound.card();
        if (ev.heels) await this.say(`Стартер — валет: ${this.plain(cur.dealer)} +2 «за пятки»`, 1100);
        else await sleep(400 / sp);
      } else if (ev.type === 'play') {
        const left = cur.left.map((hh, i) => (i === ev.seat ? hh.filter((c) => !sameCard(c, ev.card)) : hh));
        const counts = cur.counts.map((c, i) => (i === ev.seat ? c - 1 : c));
        this.v = { ...cur, left, counts, pile: [...cur.pile, { seat: ev.seat, card: ev.card }], played: [...cur.played, { seat: ev.seat, card: ev.card }], count: ev.count, turn: ev.seat };
        this.draw();
        Sound.card();
        if (ev.items.length) await this.say(`${ev.count}: ${ev.items.map((i) => `${i.what} +${i.pts}`).join(', ')}`, 800);
        else await sleep(420 / sp);
      } else if (ev.type === 'go') {
        await this.say(`${this.plain(ev.seat)}: «Пас»`, 600);
      } else if (ev.type === 'goPoint') {
        await this.say(`${this.plain(ev.seat)}: ${ev.last ? 'последняя карта' : 'никто не может'} +1`, 700);
      } else if (ev.type === 'reset') {
        this.v = { ...this.v!, pile: [], count: 0 };
        this.draw();
        await sleep(300 / sp);
      } else if (ev.type === 'score') {
        const score = cur.score.slice();
        const back = cur.back.slice();
        for (const x of mates(cur, ev.seat)) {
          back[x] = cur.score[x];
          score[x] = ev.score[x];
        }
        this.v = { ...this.v!, score, back };
        this.draw();
        Sound.step();
        await sleep(250 / sp);
      } else if (ev.type === 'show') {
        this.shown = { seat: ev.seat, cards: cur.starter ? [...ev.cards, cur.starter] : ev.cards, items: ev.items, crib: ev.crib };
        this.draw();
        Sound.ui();
        await sleep(2000 / sp);
        this.shown = null;
      } else if (ev.type === 'deal') {
        this.shown = null;
        Sound.shuffle();
        this.v = { ...v, phase: 'discard' };
        this.draw();
        await sleep(400 / sp);
      } else if (ev.type === 'end') {
        this.shown = null;
        this.v = v;
        this.draw();
        Sound.win();
        await this.say(`Партия: ${ev.winners.map((x) => this.plain(x)).join(' и ')} — ${ev.score[ev.winners[0]]}`, 0);
      }
    }
    this.shown = null;
    this.v = v;
    this.draw();
  }

  private async say(text: string, ms: number) {
    this.banner.textContent = text;
    this.banner.hidden = false;
    if (!ms) return;
    await sleep(ms / this.ctx.speed());
    this.banner.hidden = true;
  }

  setView(v: View) {
    this.v = v;
    this.banner.hidden = true;
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    this.selected = [];
    if (!v) return;
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    const next = toAct.find((x) => mine.includes(x));
    if (next != null && mine.length > 1) this.viewer = next;
    this.actSeat = interactive.includes(this.viewer) ? this.viewer : null;
    this.draw();
    this.renderButtons();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    if (v.phase === 'discard') return interactive.includes(this.viewer) && toAct.includes(this.viewer) ? 'Сбросьте в криб' : 'Сбрасывают в криб…';
    const who = toAct[0];
    return interactive.includes(who) ? 'Ваш ход' : `Ходит ${this.ctx.name(who)}…`;
  }

  playerStats(v: View, seat: number) {
    return `очки: ${v.score[seat]} из ${v.cfg.target}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new CribbageView();
}

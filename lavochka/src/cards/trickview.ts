/* Общий стол взяточных игр (черви, кинг, козёл, расписной покер, храп): рука веером внизу, соперники по дуге, взятка посередине —
 * каждая карта со стороны того, кто её положил, взятая взятка улетает к взявшему и ложится стопкой. Хот-сит — с занавеской.
 * Игра наследует TrickView: отдаёт model(v) (что где лежит), свой play() по своим событиям и кнопки (заказ, козырь) в buttons(). */
import { Sound } from '../core/audio';
import { esc, h, sleep } from '../core/util';
import type { GameView, ViewCtx } from '../core/view';
import { preloadDeck } from './render';
import { settings } from '../core/settings';
import { sameCard, sortHand, type Card, type Suit } from './deck';
import { CardStage, cardKey, fan, type Point, type StageItem } from './stage';
import type { SeatLook } from '../core/types';
import './trickview.css';

export interface TrickModel {
  seats: number[];
  /** Видимые карты руки (чужие — пусто). */
  hand(seat: number): Card[];
  count(seat: number): number;
  /** Карты текущей взятки по порядку. */
  trick: { seat: number; card: Card }[];
  /** Чей ход (подсветка таблички); null — никто. */
  turn: number | null;
  /** Можно ли сейчас сыграть эту карту (для подсветки). */
  canPlay(card: Card): boolean;
  /** Дополнительно на табличке игрока (HTML): взятки, очки, заказ. */
  plate(seat: number): string;
  /** Взяток у игрока — стопка рядом. */
  tricks(seat: number): number;
  /** Козырь (для сортировки руки и значка). */
  trump?: Suit | null;
  /** Открытая карта козыря у колоды (если есть). */
  trumpCard?: Card | null;
  /** Надпись посередине над взяткой: контракт, заказ. */
  center?: string;
  /** Чужая рука лежит открыто (лобовая: видны все карты, кроме своей). */
  open?(seat: number): boolean;
  /** Из этой открытой чужой руки ходит этот экран (болван в бридже): её карты касаются, как свои. */
  playFrom?(seat: number): boolean;
  /** Открытые чужие руки крупнее (болван). */
  openBig?: boolean;
}

export interface TrickGeo {
  port: boolean;
  W: number;
  hand: Point;
  hs: number;
  center: Point;
  os: number;
}

const LAND: TrickGeo = { port: false, W: 1000, hand: { x: 500, y: 612 }, hs: 1.05, center: { x: 500, y: 320 }, os: 0.48 };
const PORT: TrickGeo = { port: true, W: 540, hand: { x: 270, y: 792 }, hs: 1.0, center: { x: 270, y: 430 }, os: 0.42 };

export abstract class TrickView<V, E> implements GameView<V, E> {
  protected ctx!: ViewCtx;
  protected cs!: CardStage;
  protected plates!: HTMLElement;
  protected banner!: HTMLElement;
  protected cover!: HTMLElement;
  protected btns!: HTMLElement;
  protected v: V | null = null;
  protected viewer = 0;
  protected hidden = false;
  protected actSeat: number | null = null;
  /** Выбранные карты (обмен, снос) — приподняты. */
  protected selected: Card[] = [];
  /** Куда улетают карты при следующей отрисовке (взятка — к взявшему). */
  private exitPt: Point | null = null;

  constructor(
    private readonly cls: string,
    private readonly cloth: string,
    protected readonly looks: SeatLook[]
  ) {}

  /** Что где лежит при этом состоянии. */
  protected abstract model(v: V): TrickModel;
  /** Действие «сыграть карту». */
  protected abstract playAction(card: Card): unknown;
  /** Свои кнопки (заказ, козырь, пас) — когда ход не картой. Вернуть true, если кнопки нарисованы и карты трогать нельзя. */
  protected buttons(_v: V, _seat: number): boolean {
    return false;
  }
  abstract play(events: E[], v: V): Promise<void>;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(settings.deck);
    this.cs = new CardStage(root, 1000, 720, `tv-wrap ${this.cls}-wrap`, `<div class="tv-cloth ${this.cloth}"></div>`, { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="tv-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.tv-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cover = h('<div class="cs-cover" hidden><div class="cs-cover-box"><div class="tv-cover-t"></div><button class="btn primary">Показать карты</button></div></div>');
    this.cs.stage.appendChild(this.cover);
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
    const ctl = h('<div class="tv-controls"><div class="tv-btns"></div></div>');
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.tv-btns') as HTMLElement;
    this.cs.stage.addEventListener('click', (e) => this.onClick(e));
  }

  // ---------------------------------------------------------------- места

  protected get g(): TrickGeo {
    return this.cs.portrait ? PORT : LAND;
  }

  private order(m: TrickModel): number[] {
    const i0 = Math.max(0, m.seats.indexOf(this.viewer));
    return m.seats.map((_, k) => m.seats[(i0 + k) % m.seats.length]);
  }

  /** Где сидит игрок: я — внизу, остальные — по дуге слева направо через верх. */
  protected anchor(m: TrickModel, seat: number): Point {
    const k = this.order(m).indexOf(seat);
    const n = m.seats.length;
    if (k === 0) return this.g.hand;
    const g = this.g;
    const t = n === 2 ? 0.5 : (k - 1) / (n - 2);
    const a = Math.PI * (1 - t);
    if (g.port) return { x: 270 + Math.cos(a) * 200, y: 300 - Math.sin(a) * 200 + (n === 2 ? 0 : 20) };
    return { x: 500 + Math.cos(a) * 400, y: 330 - Math.sin(a) * 240 };
  }

  /** Куда кладёт карту во взятку этот игрок. */
  private trickPt(m: TrickModel, seat: number): Point {
    const a = this.anchor(m, seat);
    const c = this.g.center;
    const dx = a.x - c.x;
    const dy = a.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    const r = this.g.port ? 70 : 78;
    return { x: c.x + (dx / len) * r, y: c.y + (dy / len) * r * 0.9 };
  }

  private chooseViewer(m: TrickModel, toAct: number[]) {
    const mine = this.ctx.mySeats.filter((x) => m.seats.includes(x));
    if (!mine.length) return;
    if (mine.length === 1) {
      this.viewer = mine[0];
      return;
    }
    const next = toAct.find((x) => mine.includes(x));
    if (next != null && next !== this.viewer) {
      this.viewer = next;
      this.hidden = true;
      this.cs.clear();
    }
  }

  private faceUp(m: TrickModel, seat: number) {
    if (this.ctx.demo) return m.hand(seat).length > 0 || m.count(seat) === 0;
    return seat === this.viewer && !this.hidden && this.ctx.mySeats.includes(seat);
  }

  // ---------------------------------------------------------------- раскладка

  private layout(m: TrickModel): StageItem[] {
    const g = this.g;
    const items: StageItem[] = [];
    m.trick.forEach((t, i) => {
      const p = this.trickPt(m, t.seat);
      items.push({ key: cardKey(t.card), card: t.card, x: p.x, y: p.y, r: ((t.seat * 13 + i * 7) % 16) - 8, s: g.port ? 0.8 : 0.85, z: 200 + i, fromPt: this.anchor(m, t.seat) });
    });
    if (m.trumpCard) {
      // остаток колоды в углу, козырь — поперёк из-под него
      const d = g.port ? { x: 470, y: 600 } : { x: 92, y: 190 };
      items.push({ key: cardKey(m.trumpCard), card: m.trumpCard, x: d.x + 22, y: d.y, r: 90, s: 0.55, z: 1 });
      items.push({ key: 'tv-deck', card: null, x: d.x, y: d.y, r: 0, s: 0.55, z: 2 });
    }
    for (const seat of m.seats) {
      const cnt = m.count(seat);
      const a = this.anchor(m, seat);
      const me = seat === this.viewer;
      const up = me ? this.faceUp(m, seat) : !!m.open?.(seat);
      const list = up ? sortHand(m.hand(seat), m.trump ?? undefined) : [];
      for (let k = 0; k < cnt; k++) {
        if (me) {
          const p = fan(cnt, k, a.x, a.y, g.port ? 480 : 720, g.port ? 56 : 76, 16, 10);
          const c = list[k];
          if (!up || !c) {
            items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: g.hs, z: 100 + k });
            continue;
          }
          const act = this.actSeat === seat && !this.hidden;
          const ok = act && m.canPlay(c);
          const sel = this.selected.some((x) => sameCard(x, c));
          items.push({ key: cardKey(c), card: c, x: p.x, y: p.y - (sel ? 30 : ok ? 14 : 0), r: p.r, s: g.hs, z: 100 + k, cls: act ? (sel ? 'cs-sel' : ok ? 'cs-can' : 'tv-no') : '', data: ok ? { hand: c.s + c.r } : undefined });
        } else {
          const big = up && m.openBig;
          // крупная открытая рука сбоку — уже и не за краем стола
          const sideSeat = Math.abs(a.x - g.center.x) > (g.port ? 120 : 200);
          const bw = sideSeat ? (g.port ? 190 : 270) : g.port ? 300 : 420;
          const bx = big ? Math.max(bw / 2 + 50, Math.min(g.W - bw / 2 - 50, a.x)) : a.x;
          const p = fan(cnt, k, bx, a.y, big ? bw : g.port ? 70 : 110, big ? (sideSeat ? 22 : g.port ? 34 : 40) : 8, 6, big ? 4 : 10);
          const c = up ? list[k] : undefined;
          const os = big ? (g.port ? 0.62 : 0.66) : g.os;
          const from = !!c && this.actSeat != null && !this.hidden && !!m.playFrom?.(seat);
          const ok = from && m.canPlay(c!);
          items.push(
            c
              ? { key: cardKey(c), card: c, x: p.x, y: p.y + (ok ? -10 : 0), r: p.r, s: os, z: 50 + k, cls: from ? (ok ? 'cs-can' : 'tv-no') : '', data: ok ? { hand: c.s + c.r, from: String(seat) } : undefined }
              : { key: `b:${seat}:${k}`, card: null, ...p, s: os, z: 50 + k }
          );
        }
      }
      const tk = m.tricks(seat);
      if (tk) {
        const px = me ? a.x + (g.port ? 210 : 330) : a.x + (a.x > g.center.x + 20 ? -1 : 1) * (g.port ? 46 : 70);
        const py = me ? a.y - (g.port ? 120 : 30) : a.y + (g.port ? 30 : 10);
        items.push({ key: `pile:${seat}`, card: null, x: px, y: py, r: 80, s: 0.42, z: 40, cls: 'tv-pile' });
      }
    }
    return items;
  }

  protected draw() {
    const v = this.v;
    if (!v) return;
    const m = this.model(v);
    const exit = this.exitPt;
    this.exitPt = null;
    this.cs.render(this.layout(m), this.ctx.speed(), null, exit);
    const g = this.g;
    let s = '';
    for (const seat of m.seats) {
      const a = this.anchor(m, seat);
      const me = seat === this.viewer;
      const y = me ? a.y - 78 * g.hs - 36 : a.y + (g.port ? 34 : 42);
      const x = Math.max(g.port ? 80 : 90, Math.min(g.W - (g.port ? 80 : 90), a.x));
      s += `<div class="cs-plate${m.turn === seat ? ' on' : ''}" style="--c:${this.looks[seat].color};left:${x}px;top:${y}px">${esc(this.plain(seat))} ${m.plate(seat)}</div>`;
    }
    if (m.center) s += `<div class="tv-center${g.port ? '' : ' corner'}" style="left:${g.port ? 270 : 40}px;top:${g.port ? 18 : 34}px">${m.center}</div>`;
    this.plates.innerHTML = s;
  }

  protected plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private onClick(e: MouseEvent) {
    const v = this.v;
    if (!v || this.actSeat == null || this.hidden) return;
    const el = (e.target as Element).closest('[data-hand]') as HTMLElement | null;
    if (!el) return;
    const m = this.model(v);
    const from = el.dataset.from != null ? Number(el.dataset.from) : this.actSeat;
    const card = m.hand(from).find((c) => c.s + c.r === el.dataset.hand);
    if (!card || !m.canPlay(card)) return;
    this.onCard(card);
  }

  /** Касание карты: по умолчанию — сыграть её. Игра может выбирать несколько (обмен). */
  protected onCard(card: Card) {
    this.send(this.playAction(card));
  }

  /** Выбрать/снять карту (не больше max). */
  protected toggle(card: Card, max: number) {
    const i = this.selected.findIndex((x) => sameCard(x, card));
    if (i >= 0) this.selected.splice(i, 1);
    else {
      if (this.selected.length >= max) this.selected.shift();
      this.selected.push(card);
    }
    Sound.ui();
    this.draw();
    this.renderButtons();
  }

  protected send(a: unknown) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.clearTurn();
    this.ctx.act(seat, a);
  }

  protected clearTurn() {
    this.actSeat = null;
    this.selected = [];
    this.btns.innerHTML = '';
  }

  protected button(text: string, cls: string, on: () => void, disabled = false, into: HTMLElement = this.btns) {
    const b = h<HTMLButtonElement>(`<button class="btn ${cls}"${disabled ? ' disabled' : ''}>${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    into.appendChild(b);
    return b;
  }

  protected renderButtons() {
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null || this.ctx.demo || this.hidden) return;
    if (this.buttons(v, seat)) return;
    this.btns.appendChild(h('<div class="tv-ask">Ваш ход: коснитесь подсвеченной карты.</div>'));
  }

  // ---------------------------------------------------------------- помощники для play()

  /** Показать новое промежуточное состояние. */
  protected show(v: V) {
    this.v = v;
    this.draw();
  }

  /** Взятка улетает к взявшему: следующая отрисовка уносит исчезнувшие карты к нему. */
  protected flyTo(v: V, seat: number) {
    this.exitPt = this.anchor(this.model(v), seat);
  }

  protected async showBanner(text: string, ms: number) {
    this.banner.textContent = text;
    this.banner.hidden = false;
    if (!ms) return;
    await sleep(ms / this.ctx.speed());
    this.banner.hidden = true;
  }

  protected pause(ms: number) {
    return sleep(ms / this.ctx.speed());
  }

  /** Убрать карту из видимой руки (для промежуточных состояний). */
  protected static without(hand: Card[], c: Card) {
    return hand.filter((x) => !sameCard(x, c));
  }

  setView(v: V) {
    this.v = v;
    this.banner.hidden = true;
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.clearTurn();
    const v = this.v;
    if (!v || this.ctx.demo) return;
    const m = this.model(v);
    if (m.turn == null && !toAct.length) return;
    this.chooseViewer(m, toAct);
    const seat = interactive.find((x) => x === this.viewer) ?? null;
    if (this.hidden && interactive.length && this.ctx.mySeats.length > 1) {
      (this.cover.querySelector('.tv-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
      this.cover.hidden = false;
    } else {
      this.hidden = false;
      this.cover.hidden = true;
    }
    this.actSeat = seat;
    this.draw();
    this.renderButtons();
  }

  destroy() {
    this.cs.destroy();
  }
}

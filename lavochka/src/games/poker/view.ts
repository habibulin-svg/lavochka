/* Покер (2D) — отрисовка: зелёное сукно, места по овалу (я — внизу), свои карты крупно, у соперников — рубашки, а в стаде —
 * открытые карты лицом. Общие карты и банк — по центру, ставка каждого — фишкой перед местом, баттон — «D».
 * Панель: пас / чек / колл / рейз (в пот-лимите и безлимите — ползунок суммы) / ва-банк; на обмене — касание карт и «Сменить».
 * Хот-сит — с занавеской, как в других карточных. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { settings } from '../../core/settings';
import { preloadDeck } from '../../cards/render';
import { CardStage, cardKey, fan, type Point, type StageItem } from '../../cards/stage';
import { sameCard, type Card } from '../../cards/deck';
import { contenders, countOf, info, isMix, maxDraw, MIXES, potSize, raiseRange, structOf, toCall, type Event, type View } from './engine';
import { gameTitle, SEATS } from './def';
import './poker.css';

interface Geo {
  port: boolean;
  W: number;
  H: number;
  hand: Point;
  center: Point;
}
const LAND: Geo = { port: false, W: 1000, H: 660, hand: { x: 500, y: 560 }, center: { x: 500, y: 300 } };
const PORT: Geo = { port: true, W: 540, H: 900, hand: { x: 270, y: 780 }, center: { x: 270, y: 430 } };

class PokerView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private cover!: HTMLElement;
  private btns!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private hidden = false;
  private actSeat: number | null = null;
  private selected: Card[] = [];
  private raiseTo = 0;

  /** HUD тренажёра под табличкой соперника (poker/trainer.ts). */
  constructor(private hud: ((seat: number) => string) | null = null) {}

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(settings.deck);
    this.cs = new CardStage(root, 1000, 660, 'pk-wrap', '<div class="pk-cloth"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="pk-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.pk-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cover = h('<div class="cs-cover" hidden><div class="cs-cover-box"><div class="pk-cover-t"></div><button class="btn primary">Показать карты</button></div></div>');
    this.cs.stage.appendChild(this.cover);
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
    const ctl = h('<div class="pk-controls"></div>');
    ctx.controls.appendChild(ctl);
    this.btns = ctl;
    this.cs.stage.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-card]') as HTMLElement | null;
      const v = this.v;
      if (!el || !v || this.actSeat == null || (v.phase !== 'draw' && v.phase !== 'discard')) return;
      e.preventDefault();
      const c = v.hole[this.actSeat].find((x) => x && x.s + x.r === el.dataset.card);
      if (!c) return;
      const i = this.selected.findIndex((x) => sameCard(x, c));
      if (i >= 0) this.selected.splice(i, 1);
      else if (v.phase === 'discard') this.selected = [c];
      else if (this.selected.length < maxDraw(v)) this.selected.push(c);
      Sound.ui();
      this.draw();
      this.renderButtons();
    });
  }

  private get g(): Geo {
    return this.cs.portrait ? PORT : LAND;
  }

  private order(v: View) {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  private anchor(v: View, p: number): Point {
    const k = this.order(v).indexOf(p);
    const n = v.seats.length;
    const g = this.g;
    if (k === 0) return g.hand;
    const t = n === 2 ? 0.5 : (k - 1) / (n - 2);
    const a = Math.PI * (1.08 - 1.16 * t);
    if (g.port) return { x: 270 + Math.cos(a) * 210, y: 400 - Math.sin(a) * 260 };
    return { x: 500 + Math.cos(a) * 410, y: 290 - Math.sin(a) * 200 };
  }

  private plain(p: number) {
    return this.ctx.name(p).replace(/<[^>]+>/g, '');
  }

  private items(v: View): StageItem[] {
    const g = this.g;
    const out: StageItem[] = [];
    // общие карты
    v.board.forEach((c, i) => out.push({ key: cardKey(c), card: c, x: g.center.x + (i - 2) * (g.port ? 72 : 84), y: g.center.y + (g.port ? 30 : 20), r: 0, s: g.port ? 0.66 : 0.75, z: 10 + i }));
    for (const p of v.seats) {
      const a = this.anchor(v, p);
      // нижнее место — всегда крупно; лицом — если это мой экран (или показ правил / превью)
      const me = p === this.viewer;
      const cards = v.hole[p];
      const n = countOf(v, p);
      const folded = v.folded[p];
      const showMine = me && !this.hidden && (this.ctx.mySeats.includes(p) || this.ctx.demo);
      for (let i = 0; i < n; i++) {
        const c = cards[i] && (showMine || v.up[p]?.[i] || v.shown[p]) ? cards[i] : null;
        if (me) {
          const f = fan(n, i, a.x, a.y, g.port ? 330 : 380, g.port ? 74 : 82, 10, 8);
          const sel = !!c && this.selected.some((x) => sameCard(x, c));
          const canSel = !!c && this.actSeat === p && (v.phase === 'draw' || v.phase === 'discard');
          out.push(c ? { key: cardKey(c), card: c, x: f.x, y: f.y - (sel ? 30 : 0), r: f.r, s: g.port ? 0.95 : 0.9, z: 100 + i, cls: (sel ? 'cs-sel' : canSel ? 'cs-can' : '') + (folded ? ' cs-dim' : ''), data: canSel ? { card: c.s + c.r } : undefined } : { key: `b:${p}:${i}`, card: null, x: f.x, y: f.y, r: f.r, s: g.port ? 0.95 : 0.9, z: 100 + i });
        } else {
          const stud = info(v).family === 'stud';
          const f = fan(n, i, a.x, a.y, stud ? (g.port ? 150 : 200) : g.port ? 80 : 110, stud ? 28 : 12, 6, 8);
          const s = stud ? 0.5 : 0.46;
          out.push(c ? { key: cardKey(c), card: c, x: f.x, y: f.y + (v.up[p]?.[i] ? 0 : 0), r: f.r, s, z: 50 + i, cls: folded ? 'cs-dim' : '' } : { key: `b:${p}:${i}`, card: null, x: f.x, y: f.y, r: f.r, s, z: 50 + i, cls: folded ? 'cs-dim' : '' });
        }
      }
    }
    return out;
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.items(v), this.ctx.speed());
    const g = this.g;
    let s = '';
    for (const p of v.seats) {
      const a = this.anchor(v, p);
      const me = p === this.viewer;
      const y = me ? a.y - (g.port ? 120 : 110) : a.y + (g.port ? 46 : 52);
      const x = Math.max(80, Math.min(g.W - 80, a.x));
      const on = !v.over && v.turn === p;
      const out = v.chips[p] <= 0 && !v.inHand.includes(p);
      const tag = v.folded[p] ? ' <em>пас</em>' : v.allin[p] ? ' <em>ва-банк</em>' : v.phase === 'draw' && v.drew[p] ? ` <em>сменил ${v.drawn[p] || 'ничего'}</em>` : v.phase === 'discard' && v.drew[p] ? ' <em>сбросил</em>' : '';
      s += `<div class="cs-plate${on ? ' on' : ''}${out ? ' pk-out' : ''}" style="--c:${SEATS[p].color};left:${x}px;top:${y}px">${esc(this.plain(p).replace(/\s*\(.*\)\s*$/, ''))} <i>${v.chips[p]}</i>${tag}${v.button === p ? ' <b class="pk-d">D</b>' : ''}</div>`;
      const hud = me ? '' : (this.hud?.(p) ?? '');
      if (hud) s += `<div class="pk-hud" data-hud="${p}" style="left:${x}px;top:${y + (g.port ? 36 : 32)}px">${hud}</div>`;
      if (v.bet[p] > 0) {
        const bx = a.x + (g.center.x - a.x) * 0.45;
        const by = a.y + (g.center.y - a.y) * 0.45 + (me ? -60 : 30);
        s += `<div class="pk-bet" style="left:${bx}px;top:${by}px">${v.bet[p]}</div>`;
      }
    }
    const pot = potSize(v) - v.bet.reduce((a, b) => a + b, 0);
    s += `<div class="pk-pot" style="left:${g.center.x}px;top:${g.center.y - (g.port ? 100 : 82)}px">${isMix(v.cfg.mode) ? `${MIXES[v.cfg.mode].name}: ` : ''}${esc(gameTitle(v.game, v.hilo))} · раздача ${v.hand}${pot > 0 ? `<b>банк ${pot}</b>` : ''}</div>`;
    this.plates.innerHTML = s;
  }

  // ---------------------------------------------------------------- ход

  private send(a: unknown) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.actSeat = null;
    this.selected = [];
    this.btns.innerHTML = '';
    this.ctx.act(seat, a);
  }

  private button(text: string, cls: string, on: () => void, into: HTMLElement = this.btns) {
    const b = h<HTMLButtonElement>(`<button class="btn ${cls}">${text}</button>`);
    b.onclick = on;
    into.appendChild(b);
    return b;
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const v = this.v;
    const p = this.actSeat;
    if (!v || p == null || v.over || this.hidden || this.ctx.demo) return;
    if (v.phase === 'discard') {
      this.btns.appendChild(h('<div class="pk-ask">Коснитесь карты, которую сбросить: остаются две.</div>'));
      const b = this.button('Сбросить', 'primary', () => this.send({ type: 'discard', card: this.selected[0] }));
      b.disabled = this.selected.length !== 1;
      return;
    }
    if (v.phase === 'draw') {
      const k = this.selected.length;
      this.btns.appendChild(h(`<div class="pk-ask">Обмен: коснитесь карт, которые сбросить (до ${maxDraw(v)}).</div>`));
      this.button(k ? `Сменить ${k}` : 'Стою — не меняю', 'primary', () => this.send({ type: 'draw', cards: this.selected.slice() }));
      return;
    }
    const call = toCall(v, p);
    const rr = raiseRange(v, p);
    const st = structOf(v);
    this.btns.appendChild(h(`<div class="pk-ask">${call ? `Чтобы остаться — ${call}` : 'Ставки нет'} · банк ${potSize(v)}</div>`));
    const row = h('<div class="pk-row"></div>');
    this.btns.appendChild(row);
    this.button('Пас', '', () => this.send({ type: 'fold' }), row);
    if (call === 0) this.button('Чек', 'primary', () => this.send({ type: 'check' }), row);
    else if (call >= v.chips[p]) this.button(`Ва-банк ${v.chips[p]}`, 'primary', () => this.send({ type: 'allin' }), row);
    else this.button(`Колл ${call}`, 'primary', () => this.send({ type: 'call' }), row);
    if (!rr) return;
    const word = v.current > 0 ? 'Рейз до' : 'Ставка';
    if (st === 'limit' || rr[0] === rr[1]) {
      const all = rr[1] >= v.chips[p] + v.bet[p];
      this.button(all ? `Ва-банк ${v.chips[p]}` : `${word} ${rr[0]}`, '', () => this.send(all ? { type: 'allin' } : { type: 'raise', to: rr[0] }));
      return;
    }
    this.raiseTo = Math.max(rr[0], Math.min(rr[1], this.raiseTo || rr[0]));
    const box = h(`<div class="pk-raise"><input type="range" min="${rr[0]}" max="${rr[1]}" step="${Math.max(1, Math.round((rr[1] - rr[0]) / 40))}" value="${this.raiseTo}"><div class="pk-row"></div></div>`);
    this.btns.appendChild(box);
    const inp = box.querySelector('input') as HTMLInputElement;
    const r2 = box.querySelector('.pk-row') as HTMLElement;
    const go = this.button('', '', () => {
      const to = Number(inp.value);
      this.send(to >= v.chips[p] + v.bet[p] ? { type: 'allin' } : { type: 'raise', to });
    }, r2);
    const pot = this.button('Банк', '', () => {
      inp.value = String(rr[1] && st === 'pot' ? rr[1] : Math.min(rr[1], v.current + potSize(v)));
      upd();
    }, r2);
    void pot;
    const upd = () => {
      this.raiseTo = Number(inp.value);
      go.textContent = this.raiseTo >= v.chips[p] + v.bet[p] ? `Ва-банк ${v.chips[p]}` : `${word} ${this.raiseTo}`;
    };
    inp.oninput = upd;
    upd();
  }

  private showBanner(text: string, ms: number) {
    this.banner.textContent = text;
    this.banner.hidden = false;
    if (ms) setTimeout(() => (this.banner.hidden = true), ms / this.ctx.speed());
  }

  setView(v: View) {
    this.v = v;
    this.banner.hidden = true;
    this.draw();
  }

  async play(events: Event[], v: View) {
    const sp = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'act') {
        Sound.place();
        await sleep(260 / sp);
      } else if (ev.type === 'street') {
        Sound.card();
        await sleep(350 / sp);
      } else if (ev.type === 'draw' || ev.type === 'discard') {
        Sound.card();
        await sleep(300 / sp);
      } else if (ev.type === 'show') {
        this.v = { ...this.v!, shown: { ...this.v!.shown, [ev.seat]: ev.cards }, hole: this.v!.hole.map((hh, i) => (i === ev.seat ? ev.cards : hh)) };
        this.draw();
        await sleep(350 / sp);
      } else if (ev.type === 'win') {
        Sound.win();
        this.showBanner(`${this.plain(ev.seat)} +${ev.amount}${ev.hand ? ` (${ev.hand})` : ''}`, 1600);
        await sleep(1500 / sp);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
      } else if (ev.type === 'end') {
        this.showBanner(`Больше всех — ${this.plain(ev.winner)}`, 0);
      }
    }
    this.v = v;
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    this.actSeat = null;
    this.selected = [];
    const mine = this.ctx.mySeats.filter((x) => v?.seats.includes(x));
    const who = interactive.find((x) => toAct.includes(x));
    if (who != null && who !== this.viewer && mine.length > 1) {
      this.hidden = true;
      (this.cover.querySelector('.pk-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(who)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
      this.cover.hidden = false;
    }
    if (who != null) this.viewer = who;
    else if (mine.length && !mine.includes(this.viewer)) this.viewer = mine[0];
    if (v && !v.over && !this.ctx.demo && who != null) this.actSeat = who;
    this.raiseTo = 0;
    this.draw();
    this.renderButtons();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    if (interactive.includes(who)) return v.phase === 'draw' ? 'Ваш обмен' : v.phase === 'discard' ? 'Сбросьте лишнюю карту' : 'Ваш ход';
    return `${this.ctx.name(who)} ${v.phase === 'draw' ? 'меняет' : v.phase === 'discard' ? 'сбрасывает карту' : 'думает'}…`;
  }

  playerStats(v: View, seat: number) {
    return `фишек: ${v.chips[seat]}${contenders(v).includes(seat) ? '' : ''}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(hud: ((seat: number) => string) | null = null): GameView<View, Event> {
  return new PokerView(hud);
}

/* Канаста — отрисовка: своя рука внизу, напарник сверху, соперники по бокам (вдвоём — соперник сверху). Комбинации пары лежат
 * рядами: свои — над рукой, чужие — под верхним игроком; канаста — сложенная стопка с меткой «чистая» (красная) или «грязная» (чёрная).
 * Красные тройки — у своих комбинаций. Слева — колода и сброс (верхняя карта; замороженный сброс — поперечная карта).
 * Ход: коснуться колоды — взять; выбрать карты с руки и коснуться сброса — взять сброс; выбрать карты — «Выложить»; одну — «Сбросить». */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck, deckStyle } from '../../cards/render';
import { CardStage, fan, type Point, type StageItem } from '../../cards/stage';
import { SUITS } from '../../cards/deck';
import { canMeld, canTakePile, cleanCanasta, frozen, groupCards, isCanasta, isWild, sameC, teamOf, type Action, type CCard, type Event, type Meld, type View } from './engine';
import { SEATS, cn, RANK_RU } from './def';
import '../../cards/trickview.css';
import './canasta.css';

const key = (c: CCard) => `k:${c.s}${c.r}.${c.d}`;

class CanastaView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private btns!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private act: number | null = null;
  private sel: CCard[] = [];

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.viewer = ctx.mySeats[0] ?? 0;
    preloadDeck(deckStyle());
    this.cs = new CardStage(root, 1000, 720, 'ca-wrap', '<div class="tv-cloth ca-cloth"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="ca-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.ca-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cs.stage.addEventListener('click', (e) => this.onClick(e));
    if (ctx.demo) return;
    const ctl = h('<div class="ca-controls"><div class="ca-btns"></div></div>');
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.ca-btns') as HTMLElement;
  }

  private get port() {
    return this.cs.portrait;
  }

  private order(v: View) {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  private anchor(v: View, seat: number): Point {
    const k = this.order(v).indexOf(seat);
    const n = v.seats.length;
    const P = this.port;
    if (k === 0) return P ? { x: 270, y: 800 } : { x: 560, y: 640 };
    if (n === 2 || k === 2) return P ? { x: 270, y: 60 } : { x: 560, y: 66 };
    return k === 1 ? (P ? { x: 490, y: 430 } : { x: 900, y: 330 }) : P ? { x: 50, y: 430 } : { x: 200, y: 330 };
  }

  private sorted(hand: CCard[]) {
    const o = (s: string) => SUITS.indexOf(s as never);
    return hand.slice().sort((a, b) => (isWild(a) ? 99 : a.r) - (isWild(b) ? 99 : b.r) || o(a.s) - o(b.s));
  }

  private meldRow(ms: Meld[], y: number, x0: number, x1: number, items: StageItem[]) {
    const s = this.port ? 0.38 : 0.44;
    const w = this.port ? 44 : 58;
    const step = this.port ? 10 : 13;
    const per = Math.max(1, Math.floor((x1 - x0) / (w + 6)));
    ms.forEach((m, i) => {
      const col = i % per;
      const row = Math.floor(i / per);
      const x = x0 + col * (w + 6) + w / 2;
      const yy = y + row * (this.port ? 70 : 84);
      if (isCanasta(m)) {
        // сложенная канаста: верхняя карта лицом, по краю — метка
        const top = m.cards.find((c) => !isWild(c)) ?? m.cards[0];
        items.push({ key: key(top), card: top, x, y: yy, r: 0, s, z: 30, cls: cleanCanasta(m) ? 'ca-clean' : 'ca-dirty' });
        for (const c of m.cards) if (c !== top) items.push({ key: key(c), card: null, x, y: yy + 2, r: 0, s, z: 29 });
        return;
      }
      m.cards.forEach((c, k) => items.push({ key: key(c), card: c, x, y: yy + k * step, r: 0, s, z: 30 + k }));
    });
  }

  private layout(v: View): StageItem[] {
    const items: StageItem[] = [];
    const P = this.port;
    const canDraw = this.act != null && v.phase === 'draw';
    const st = P ? { x: 60, y: 300 } : { x: 70, y: 240 };
    for (let k = 0; k < Math.min(5, Math.ceil(v.stockLeft / 16)); k++) items.push({ key: `stock:${k}`, card: null, x: st.x - k, y: st.y - k * 2, r: 0, s: 0.55, z: 2 + k, cls: canDraw ? 'cs-can' : '', data: canDraw ? { pile: 'stock' } : undefined });
    const dp = P ? { x: 60, y: 520 } : { x: 70, y: 470 };
    const team = teamOf(v, this.viewer);
    const canPile = canDraw && canTakePile(v, this.act!, this.sel);
    v.pile.slice(-4).forEach((c, i, arr) => {
      const top = i === arr.length - 1;
      items.push({ key: key(c), card: c, x: dp.x + i * 3, y: dp.y + i * 2, r: isWild(c) && !top ? 90 : ((i * 9) % 10) - 5, s: 0.55, z: 10 + i, cls: top && canPile ? 'cs-can' : '', data: top && canDraw ? { pile: 'pile' } : undefined });
    });
    // комбинации пар
    const opp = v.melds.length === 2 ? 1 - team : team;
    this.meldRow(v.melds[team], P ? 600 : 420, P ? 20 : 200, P ? 520 : 900, items);
    if (v.melds.length > 1) this.meldRow(v.melds[opp], P ? 150 : 150, P ? 20 : 200, P ? 520 : 900, items);
    // красные тройки
    v.red3.forEach((r3, t) => {
      const y = t === team ? (P ? 560 : 520) : P ? 110 : 120;
      r3.forEach((c, k) => items.push({ key: key(c), card: c, x: (P ? 470 : 920) + k * 14, y, r: 0, s: 0.36, z: 60 + k }));
    });
    // руки
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      if (me && v.hands[seat].length) {
        const list = this.sorted(v.hands[seat]);
        const act = this.act === seat;
        list.forEach((c, k) => {
          const p = fan(list.length, k, a.x, a.y, P ? 470 : 680, P ? 46 : 54, 14, 8);
          const sel = this.sel.some((x) => sameC(x, c));
          items.push({ key: key(c), card: c, x: p.x, y: p.y - (sel ? 26 : 0), r: p.r, s: P ? 0.86 : 0.92, z: 100 + k, cls: sel ? 'cs-sel' : '', data: act ? { hand: key(c) } : undefined });
        });
      } else {
        const cnt = v.counts[seat];
        const side = this.order(v).indexOf(seat) % 2 === 1 && v.seats.length === 4;
        for (let k = 0; k < cnt; k++) {
          const p = side ? { x: a.x, y: a.y + (k - (cnt - 1) / 2) * 8, r: 90 } : fan(cnt, k, a.x, a.y, P ? 90 : 140, 8, 6, 10);
          items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: 0.4, z: 50 + k });
        }
      }
    }
    return items;
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed());
    let s = '';
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const y = me ? a.y - (this.port ? 108 : 112) : a.y + (this.port ? 36 : 42);
      const x = Math.max(80, Math.min((this.port ? 540 : 1000) - 80, a.x));
      s += `<div class="cs-plate${v.turn === seat && !v.over ? ' on' : ''}" style="--c:${SEATS[seat].color};left:${x}px;top:${y}px">${esc(this.plain(seat))}</div>`;
    }
    const team = teamOf(v, this.viewer);
    const sc = v.score.map((x, t) => `${t === team ? 'мы' : 'они'} ${x}`).join(' · ');
    s += `<div class="tv-center${this.port ? '' : ' corner'}" style="left:${this.port ? 270 : 30}px;top:${this.port ? 16 : 20}px">Канаста<small>${sc} · до ${v.cfg.target}${frozen(v, team) ? ' · сброс заморожен' : ''}</small></div>`;
    this.plates.innerHTML = s;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private onClick(e: MouseEvent) {
    const v = this.v;
    if (!v || this.act == null) return;
    const el = (e.target as Element).closest('[data-hand],[data-pile]') as HTMLElement | null;
    if (!el) return;
    if (el.dataset.pile === 'stock') return this.send({ type: 'draw' });
    if (el.dataset.pile === 'pile') {
      if (canTakePile(v, this.act, this.sel)) return this.send({ type: 'pile', cards: this.sel.slice() });
      Sound.nomove();
      return;
    }
    const c = v.hands[this.act].find((x) => key(x) === el.dataset.hand);
    if (!c) return;
    const i = this.sel.findIndex((x) => sameC(x, c));
    if (i >= 0) this.sel.splice(i, 1);
    else this.sel.push(c);
    Sound.ui();
    this.draw();
    this.renderButtons();
  }

  private send(a: Action) {
    const seat = this.act;
    if (seat == null) return;
    Sound.unlock();
    this.act = null;
    this.sel = [];
    if (this.btns) this.btns.innerHTML = '';
    this.ctx.act(seat, a);
  }

  private button(text: string, cls: string, on: () => void, ok = true) {
    const b = h<HTMLButtonElement>(`<button class="btn ${cls}"${ok ? '' : ' disabled'}>${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    this.btns.appendChild(b);
  }

  private renderButtons() {
    if (!this.btns) return;
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.act;
    if (!v || seat == null) return;
    if (v.phase === 'draw') {
      this.button('Из колоды', 'primary', () => this.send({ type: 'draw' }));
      const ok = canTakePile(v, seat, this.sel);
      this.button(`Взять сброс (${v.pile.length})`, '', () => this.send({ type: 'pile', cards: this.sel.slice() }), ok);
      this.btns.appendChild(h(`<div class="ca-ask">Чтобы взять сброс, сначала выберите карты, с которыми выложите верхнюю${frozen(v, teamOf(v, seat)) ? ' — нужны две натуральные того же достоинства' : ''}.</div>`));
      return;
    }
    if (this.sel.length) {
      const groups = groupCards(this.sel);
      const ok = !!groups && canMeld(v, seat, groups);
      const what = groups ? groups.map((g) => `${RANK_RU[g.rank]} ${g.cards.length}`).join(', ') : '';
      this.button(ok ? `Выложить: ${what}` : 'Так не выложить', 'primary', () => groups && this.send({ type: 'meld', groups }), ok);
    }
    if (this.sel.length === 1) this.button(`Сбросить ${cn(this.sel[0])}`, '', () => this.send({ type: 'discard', card: this.sel[0] }));
    this.btns.appendChild(h('<div class="ca-ask">Выберите карты: три одного достоинства (или к своим комбинациям) — выложить; одну — сбросить.</div>'));
  }

  // ---------------------------------------------------------------- события

  async play(events: Event[], v: View) {
    this.act = null;
    this.sel = [];
    if (this.btns) this.btns.innerHTML = '';
    const sp = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'meld') {
        Sound.place();
        if (ev.canasta) await this.say('Канаста!', 900);
        else await sleep(300 / sp);
      } else if (ev.type === 'pile') {
        Sound.shuffle();
        await this.say(`${this.plain(ev.seat)} берёт сброс — ${ev.n}`, 800);
      } else if (ev.type === 'red3') {
        Sound.win();
        await sleep(300 / sp);
      } else if (ev.type === 'hand') {
        Sound.win();
        await this.say(`Сдача: ${ev.add.join(' : ')}${ev.lines.length ? ` (${ev.lines.join(', ')})` : ''}`, 2000);
      } else if (ev.type === 'end') {
        this.v = v;
        this.draw();
        await this.say('Партия окончена', 0);
      } else if (ev.type === 'draw' || ev.type === 'discard') {
        Sound.card();
        await sleep(200 / sp);
      }
    }
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
    this.sel = [];
    if (!v) return;
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    const next = toAct.find((x) => mine.includes(x));
    if (next != null && mine.length > 1) this.viewer = next;
    this.act = interactive.includes(this.viewer) && toAct.includes(this.viewer) ? this.viewer : null;
    this.draw();
    this.renderButtons();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    if (!interactive.includes(who)) return `Ходит ${this.ctx.name(who)}…`;
    return v.phase === 'draw' ? 'Возьмите карту или сброс' : 'Выкладывайте и сбросьте карту';
  }

  playerStats(v: View, seat: number) {
    return `пара: ${v.score[teamOf(v, seat)]}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new CanastaView();
}

/* Сека — отрисовка: игроки по кругу стола, у каждого три карты (у себя — крупно снизу), банк посередине.
 * Под рукой — сколько вложил, «втёмную», после вскрытия — очки. Кнопки: «Посмотреть», «Пас», «Доставить», «Набавить до N»,
 * в сваре — «Примазаться» / «Не входить». */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck } from '../../cards/render';
import { settings } from '../../core/settings';
import { CardStage, cardKey, type Point, type StageItem } from '../../cards/stage';
import type { Card } from '../../cards/deck';
import { joinFee, owe, raiseTo, type Event, type View } from './engine';
import { SEATS, rub } from './def';
import './seka.css';

class SekaView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private btns!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(settings.deck);
    this.cs = new CardStage(root, 1000, 720, 'sk-wrap', '<div class="sk-cloth"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="sk-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.sk-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    if (ctx.demo) return;
    const ctl = h(`<div class="sk-controls"><div class="sk-btns"></div></div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.sk-btns') as HTMLElement;
  }

  // ---------------------------------------------------------------- места

  private get port() {
    return this.cs.portrait;
  }

  private get center(): Point {
    return this.port ? { x: 270, y: 430 } : { x: 500, y: 330 };
  }

  private isMe(seat: number) {
    return seat === this.viewer && this.ctx.mySeats.includes(seat);
  }

  private anchor(v: View, seat: number): Point {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    const n = v.seats.length;
    const k = (v.seats.indexOf(seat) - i0 + n) % n;
    const a = Math.PI / 2 + (k * 2 * Math.PI) / n;
    const c = this.center;
    const rx = this.port ? 185 : 380;
    const ry = this.port ? 330 : 235;
    return { x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) };
  }

  private scale(seat: number) {
    return this.isMe(seat) ? (this.port ? 1 : 0.95) : this.port ? 0.6 : 0.68;
  }

  private layout(v: View): StageItem[] {
    const items: StageItem[] = [];
    const c = this.center;
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const s = this.scale(seat);
      const folded = !v.live.includes(seat) && !(seat in v.shown);
      v.hands[seat].forEach((card, i) => {
        const step = (this.isMe(seat) ? 62 : 40) * s;
        const x = a.x + (i - 1) * step;
        const y = a.y + Math.abs(i - 1) * 4 * s;
        const r = (i - 1) * 6;
        const cls = folded && v.hands[seat].length ? 'sk-folded' : '';
        items.push(card.r ? { key: cardKey(card), card, x, y, r, s, z: 10 + i, cls, from: `h:${seat}:${i}`, fromPt: c } : { key: `h:${seat}:${i}`, card: null, x, y, r, s, z: 10 + i, cls, fromPt: c });
      });
    }
    return items;
  }

  private draw(exit: Point | null = null) {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed(), null, exit);
    const c = this.center;
    const W = this.port ? 540 : 1000;
    let html = '';
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const s = this.scale(seat);
      const on = v.turn === seat && !v.over;
      const out = v.out.includes(seat);
      const below = a.y >= c.y;
      const y = below ? a.y + 80 * s + 6 : a.y - 80 * s - 40;
      const x = Math.max(80, Math.min(W - 80, a.x));
      const tags: string[] = [];
      if (seat === v.dealer) tags.push('<em>сдаёт</em>');
      if (v.put[seat]) tags.push(`<span class="sk-chip"></span>${v.put[seat]}`);
      if (v.live.includes(seat) && !v.seen[seat] && v.cfg.dark && !(seat in v.shown)) tags.push('<i class="sk-dark">втёмную</i>');
      if (seat in v.shown) tags.push(`<i class="sk-score">${v.shown[seat]}</i>`);
      else if (!v.live.includes(seat) && v.hands[seat].length && !out) tags.push('<i class="sk-pas">пас</i>');
      html += `<div class="cs-plate${on ? ' on' : ''}${out ? ' sk-out' : ''}" style="--c:${SEATS[seat].color};left:${x}px;top:${y}px">${esc(this.plain(seat))} <b>${out ? 'выбыл' : v.money[seat]}</b>${tags.length ? ' ' + tags.join(' ') : ''}</div>`;
    }
    html += `<div class="sk-pot" style="left:${c.x}px;top:${c.y - 24}px"><span class="sk-chip"></span><span class="sk-chip"></span>Банк <b>${v.pot}</b>
      <small>${v.svara ? 'свара' : `сдача ${v.deal} из ${v.cfg.deals}`}${v.level ? ` · ставка ${v.level}` : ''}</small></div>`;
    this.plates.innerHTML = html;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private button(text: string, cls: string, fn: () => void) {
    const b = h<HTMLButtonElement>(`<button class="btn ${cls}">${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      this.btns.innerHTML = '';
      fn();
    };
    this.btns.appendChild(b);
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    const my = this.ctx.mySeats.filter((x) => v?.seats.includes(x));
    if (my.length && !my.includes(this.viewer)) this.viewer = my[0];
    const seat = v && !v.over && !this.ctx.demo ? interactive[0] : undefined;
    if (seat != null && seat !== this.viewer) this.viewer = seat;
    if (!this.btns) return this.draw();
    this.btns.innerHTML = '';
    if (v && seat != null) {
      const act = (a: Parameters<ViewCtx['act']>[1]) => this.ctx.act(seat, a);
      if (v.phase === 'join') {
        this.button(`Примазаться — ${rub(joinFee(v))}`, 'primary', () => act({ type: 'join', yes: true }));
        this.button('Не входить', '', () => act({ type: 'join', yes: false }));
      } else {
        const c = owe(v, seat);
        if (!v.seen[seat]) this.button('Посмотреть карты', '', () => act({ type: 'look' }));
        this.button(c ? `Доставить ${c}${v.seen[seat] ? '' : ' втёмную'}` : 'Дальше', 'primary', () => act({ type: 'call' }));
        for (const to of raiseTo(v, seat)) this.button(`Набавить до ${to}`, 'sk-up', () => act({ type: 'raise', to }));
        this.button('Пас', 'sk-fold', () => act({ type: 'fold' }));
      }
    }
    this.draw();
  }

  setView(v: View) {
    this.v = v;
    const my = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    if (my.length && !my.includes(this.viewer)) this.viewer = my[0];
    this.banner.hidden = true;
    this.draw();
  }

  private async showBanner(text: string, ms: number) {
    this.banner.textContent = text;
    this.banner.hidden = false;
    if (!ms) return;
    await sleep(ms);
    this.banner.hidden = true;
  }

  private pay(seat: number, n: number) {
    const cur = this.v!;
    this.v = { ...cur, pot: cur.pot + n, money: cur.money.map((m, i) => (i === seat ? m - n : m)), put: cur.put.map((m, i) => (i === seat ? m + n : m)) };
  }

  async play(events: Event[], v: View) {
    const sp = this.ctx.speed();
    const wait = (ms: number) => sleep(ms / sp);
    for (const ev of events) {
      const cur = this.v!;
      switch (ev.type) {
        case 'deal': {
          if (Object.keys(cur.shown).length || cur.live.length < 2) await wait(1600);
          const hands: Card[][] = cur.hands.map(() => []);
          this.v = { ...cur, hands, shown: {}, live: ev.seats.slice(), put: cur.put.map(() => 0), dealer: ev.dealer, deal: ev.n, level: 0, svara: ev.svara ? ev.seats : null, seen: cur.seen.map(() => !cur.cfg.dark) };
          this.draw(this.center);
          await wait(300);
          if (ev.ante) {
            this.v = { ...this.v!, pot: this.v!.pot + ev.ante * ev.seats.length, money: this.v!.money.map((m, i) => (ev.seats.includes(i) ? m - ev.ante : m)) };
            Sound.ui();
          }
          for (let k = 0; k < 3; k++)
            for (const p of ev.seats) {
              const hs: Card[][] = this.v!.hands.map((x) => x.slice());
              hs[p].push(ev.hands[p][k]);
              this.v = { ...this.v!, hands: hs };
              this.draw();
              Sound.card();
              await wait(90);
            }
          break;
        }
        case 'look':
          this.v = { ...cur, seen: cur.seen.map((x, i) => x || i === ev.seat), hands: cur.hands.map((x, i) => (i === ev.seat ? ev.cards.slice() : x)) };
          this.draw();
          await wait(350);
          break;
        case 'call':
          this.pay(ev.seat, ev.paid);
          this.draw();
          if (ev.paid) Sound.ui();
          await wait(350);
          break;
        case 'raise':
          this.pay(ev.seat, ev.paid);
          this.v = { ...this.v!, level: ev.to };
          this.draw();
          Sound.ui();
          await wait(500);
          break;
        case 'fold':
          this.v = { ...cur, live: cur.live.filter((p) => p !== ev.seat) };
          this.draw();
          await wait(350);
          break;
        case 'show':
          this.v = { ...cur, hands: cur.hands.map((x, i) => (i === ev.seat ? ev.cards.slice() : x)), shown: { ...cur.shown, [ev.seat]: ev.score } };
          this.draw();
          Sound.card();
          await wait(550);
          break;
        case 'win':
          this.v = { ...cur, pot: 0, money: cur.money.map((m, i) => (i === ev.seat ? m + ev.pot : m)) };
          this.draw();
          Sound.win();
          await this.showBanner(`${this.plain(ev.seat)} забирает ${rub(ev.pot)}`, 1300 / sp);
          break;
        case 'svara':
          Sound.ui();
          await this.showBanner('Свара!', 1300 / sp);
          this.v = { ...cur, svara: ev.seats.slice() };
          break;
        case 'join':
          if (ev.yes) {
            this.v = { ...cur, pot: cur.pot + ev.fee, money: cur.money.map((m, i) => (i === ev.seat ? m - ev.fee : m)) };
            this.draw();
            Sound.ui();
          }
          await wait(300);
          break;
        case 'out':
          this.v = { ...cur, out: [...cur.out, ev.seat] };
          this.draw();
          await this.showBanner(`${this.plain(ev.seat)} проигрался`, 900 / sp);
          break;
        case 'end':
          await wait(800);
          this.v = v;
          this.draw();
          await this.showBanner(`Победил ${this.plain(ev.winner)} — ${rub(ev.money[ev.winner])}`, 0);
          break;
      }
    }
    this.v = v;
    this.draw();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner != null ? `Победил ${this.ctx.name(v.winner)}` : 'Партия окончена';
    const who = toAct[0];
    if (who == null) return '';
    const mine = interactive.includes(who);
    if (v.phase === 'join') return mine ? `Свара: примазаться за ${rub(joinFee(v))}?` : `${this.ctx.name(who)} думает, входить ли в свару`;
    if (!mine) return `Ходит ${this.ctx.name(who)}`;
    const c = owe(v, who);
    return c ? `Доставить ${c}, набавить или пас?` : 'Ваш ход: дальше, набавить или пас';
  }

  playerStats(v: View, seat: number) {
    return v.out.includes(seat) ? 'проигрался' : rub(v.money[seat]);
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new SekaView();
}

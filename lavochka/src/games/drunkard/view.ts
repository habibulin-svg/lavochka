/* Пьяница — отрисовка: стопки рубашкой вверх по кругу стола, открытые карты — между стопкой и серединой, в споре — подкладка
 * рубашкой и открытая сверху. Кнопка «Открыть карту» (тап по столу тоже), «Автоигра» — карты открываются сами. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck } from '../../cards/render';
import { settings } from '../../core/settings';
import { CardStage, cardKey, type Point, type StageItem } from '../../cards/stage';
import { countOf, topUp, type Event, type View } from './engine';
import { SEATS } from './def';
import './drunkard.css';

class DrunkardView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private btns!: HTMLElement;
  private auto!: HTMLInputElement;
  private v: View | null = null;
  private viewer = 0;
  private mine: number[] = [];
  private autoTimer = 0;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(settings.deck);
    this.cs = new CardStage(root, 1000, 720, 'dk-wrap', '<div class="dk-cloth"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="dk-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.dk-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    if (ctx.demo) return;
    const ctl = h(`<div class="dk-controls"><div class="dk-btns"></div>
      <label class="dk-auto"><input type="checkbox"> Автоигра — карты открываются сами</label></div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.dk-btns') as HTMLElement;
    this.auto = ctl.querySelector('input') as HTMLInputElement;
    this.auto.onchange = () => {
      Sound.unlock();
      this.ctx.hurry?.(this.auto.checked);
      this.kick();
    };
  }

  // ---------------------------------------------------------------- места

  private get port() {
    return this.cs.portrait;
  }

  private get center(): Point {
    return this.port ? { x: 270, y: 450 } : { x: 500, y: 350 };
  }

  private anchor(v: View, seat: number): Point {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    const n = v.seats.length;
    const k = (v.seats.indexOf(seat) - i0 + n) % n;
    const a = Math.PI / 2 + (k * 2 * Math.PI) / n;
    const c = this.center;
    const rx = this.port ? 190 : 390;
    const ry = this.port ? 340 : 250;
    return { x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) };
  }

  private spot(v: View, seat: number): Point {
    const a = this.anchor(v, seat);
    const c = this.center;
    const t = this.port ? 0.42 : v.seats.length > 4 ? 0.5 : 0.47;
    return { x: c.x + (a.x - c.x) * t, y: c.y + (a.y - c.y) * t };
  }

  private layout(v: View): StageItem[] {
    const items: StageItem[] = [];
    const s = this.port ? 0.78 : 0.72;
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const n = countOf(v, seat);
      // стопка: толщина по числу карт
      const thick = Math.min(4, Math.ceil(n / 6));
      for (let k = 0; k < thick; k++) items.push({ key: `st:${seat}:${k}`, card: null, x: a.x - k * 1.5, y: a.y - k * 2.5, r: 0, s, z: 2 + k, cls: k === thick - 1 ? 'dk-top' : '' });
      const p = this.spot(v, seat);
      v.table[seat].forEach((tc, i) => {
        const dx = i * 16;
        const dy = i * 10;
        if (tc.up) items.push({ key: cardKey(tc.c), card: tc.c, x: p.x + dx, y: p.y + dy, r: ((seat * 7 + i * 5) % 11) - 5, s: s * 1.1, z: 20 + i, fromPt: a });
        else items.push({ key: `cl:${seat}:${i}`, card: null, x: p.x + dx, y: p.y + dy, r: 8, s: s * 1.1, z: 20 + i, fromPt: a });
      });
    }
    return items;
  }

  private draw(exit: Point | null = null) {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed(), null, exit);
    let html = '';
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const n = countOf(v, seat);
      const out = v.out.includes(seat);
      const on = v.pending.includes(seat) && !v.over;
      const below = a.y > this.center.y;
      const y = below ? a.y + (this.port ? 52 : 62) : a.y - (this.port ? 76 : 84);
      const x = Math.max(70, Math.min((this.port ? 540 : 1000) - 70, a.x));
      html += `<div class="cs-plate${on ? ' on' : ''}${out ? ' dk-out' : ''}" style="--c:${SEATS[seat].color};left:${x}px;top:${y}px">${esc(this.plain(seat))} <b>${out ? 'выбыл' : n}</b></div>`;
    }
    const war = v.war ? `<div class="dk-war">Спор${v.war > 1 ? ' ×' + v.war : ''}!</div>` : '';
    html += `<div class="dk-round" style="left:${this.center.x}px;top:${this.center.y}px">${war}<small>кон ${v.round + 1}${v.cfg.limit ? ' из ' + v.cfg.limit : ''}${v.sleep ? ` · спят ${v.sleep}` : ''}</small></div>`;
    this.plates.innerHTML = html;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private flip() {
    clearTimeout(this.autoTimer);
    const seats = this.mine.slice();
    this.mine = [];
    if (this.btns) this.btns.innerHTML = '';
    for (const p of seats) this.ctx.act(p, { type: 'flip' });
  }

  private kick() {
    clearTimeout(this.autoTimer);
    if (this.auto?.checked && this.mine.length) this.autoTimer = window.setTimeout(() => this.flip(), 260 / this.ctx.speed());
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    this.mine = v && !v.over && !this.ctx.demo ? interactive.slice() : [];
    const my = this.ctx.mySeats.filter((x) => v?.seats.includes(x));
    if (my.length && !my.includes(this.viewer)) this.viewer = my[0];
    if (!this.btns) return;
    this.btns.innerHTML = '';
    if (this.mine.length) {
      const b = h<HTMLButtonElement>(`<button class="btn primary" data-tap>${v!.war ? 'Спорить — открыть' : 'Открыть карту'}</button>`);
      b.onclick = () => {
        Sound.unlock();
        this.flip();
      };
      this.btns.appendChild(b);
    }
    this.kick();
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

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    const fast = this.auto?.checked ? 0.5 : 1;
    for (const ev of events) {
      const cur = this.v!;
      if (ev.type === 'flip') {
        const table = cur.table.map((t, i) => (i === ev.seat ? [...t, { c: ev.card, up: !ev.closed }] : t));
        this.v = { ...cur, table, counts: cur.counts.map((c, i) => (i === ev.seat ? c - 1 : c)), pending: cur.pending.filter((x) => x !== ev.seat || ev.closed) };
        this.draw();
        Sound.card();
        await sleep((ev.closed ? 160 : 260) * fast / speed);
      } else if (ev.type === 'war') {
        this.v = { ...cur, war: ev.n };
        this.draw();
        Sound.ui();
        await this.showBanner(ev.n > 1 ? 'Опять спор!' : 'Спор!', 700 * fast / speed);
      } else if (ev.type === 'take') {
        // дать разглядеть, чья взяла
        const by = topUp(cur.table[ev.seat]);
        this.markWinner(by ? by.s + by.r : null);
        await sleep((ev.war ? 900 : 500) * fast / speed);
        this.v = { ...cur, table: cur.table.map(() => []), war: 0, counts: cur.counts.map((c, i) => (i === ev.seat ? c + ev.count : c)) };
        this.draw(this.anchor(cur, ev.seat));
        Sound.step();
        await sleep(280 * fast / speed);
      } else if (ev.type === 'out') {
        this.v = { ...cur, out: [...cur.out, ev.seat] };
        this.draw();
        await this.showBanner(`${this.plain(ev.seat)} — пьяница!`, 1000 / speed);
      } else if (ev.type === 'end') {
        Sound.win();
        this.v = v;
        this.draw();
        await this.showBanner(ev.reason === 'all' ? `${this.plain(ev.winner)} собрал всю колоду!` : `Стемнело. Победил ${this.plain(ev.winner)}`, 0);
      }
    }
    this.v = v;
    this.draw();
  }

  private markWinner(key: string | null) {
    if (!key) return;
    const el = this.cs.stage.querySelector(`[data-id="${key}"]`);
    el?.classList.add('dk-win');
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner != null ? `Победил ${this.ctx.name(v.winner)}` : 'Партия окончена';
    if (interactive.length) return v.war ? 'Спор! Открывайте карту' : 'Открывайте карту';
    return v.war ? 'Спор…' : `Ждём: ${toAct.map((p) => this.ctx.name(p)).join(', ')}`;
  }

  playerStats(v: View, seat: number) {
    return v.out.includes(seat) ? 'выбыл' : `карт: ${countOf(v, seat)}`;
  }

  destroy() {
    clearTimeout(this.autoTimer);
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new DrunkardView();
}

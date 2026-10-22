/* Китайский покер — стол: то же сукно, что у покера. Свои три ряда — крупно внизу, сданные карты — справа (на телефоне — под
 * рядами), ряды соперников — мельче сверху. Раскладка вручную: коснуться карты, затем пустого места в ряду (или кнопки ряда
 * в панели); касание выложенной, но не подтверждённой карты возвращает её в руку. Лишняя карта уходит в сброс сама.
 * Над рядами — подсказка «фол!», если верх уже сильнее середины (или середина — низа). На подсчёте открываются все ряды
 * и табличка: роялти, фол, итог раздачи, кто идёт в фантазию. */
import { Sound } from '../../../core/audio';
import { esc, h, sleep } from '../../../core/util';
import type { GameView, ViewCtx } from '../../../core/view';

import { preloadDeck, deckStyle } from '../../../cards/render';
import { CardStage, cardKey, type StageItem } from '../../../cards/stage';
import type { Card } from '../../../cards/deck';
import { SEATS } from '../def';
import { chooseOfc } from './ai';
import { foulRisk, needDiscard, OFC_NAME, ROW_NAME, rowName, royalty, SIZE, type OEvent, type OView, type Score, type Slot } from './engine';
import './ofc.css';

interface Geo {
  port: boolean;
  W: number;
  H: number;
  /** Свои ряды: центр по x, y рядов, масштаб и шаг карт. */
  me: { x: number; ys: number[]; s: number; step: number };
  /** Рука: левый край/центр, y строк, шаг, масштаб, карт в строке. */
  held: { x: number; ys: number[]; step: number; s: number; per: number; center: boolean };
  opp: { y0: number; dy: number; s: number; step: number; xs: number[][] };
}
const LAND: Geo = {
  port: false,
  W: 1000,
  H: 660,
  me: { x: 390, ys: [304, 424, 544], s: 0.74, step: 80 },
  held: { x: 664, ys: [330, 440, 550], step: 50, s: 0.7, per: 6, center: false },
  opp: { y0: 78, dy: 66, s: 0.4, step: 44, xs: [[450], [250, 690], [170, 470, 770]] },
};
const PORT: Geo = {
  port: true,
  W: 540,
  H: 900,
  me: { x: 270, ys: [340, 450, 560], s: 0.66, step: 72 },
  held: { x: 270, ys: [700, 800], step: 54, s: 0.66, per: 9, center: true },
  opp: { y0: 98, dy: 52, s: 0.3, step: 32, xs: [[270], [140, 400], [95, 270, 445]] },
};

class OfcView implements GameView<OView, OEvent> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private cover!: HTMLElement;
  private btns!: HTMLElement;
  private v: OView | null = null;
  private viewer = 0;
  private hidden = false;
  private actSeat: number | null = null;
  /** Куда игрок уже положил карты руки (до «Готово»): ключ карты → ряд. */
  private plan = new Map<string, 0 | 1 | 2>();
  private sel: string | null = null;
  private score: Score | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(deckStyle());
    this.cs = new CardStage(root, 1000, 660, 'pk-wrap ofc-wrap', '<div class="pk-cloth"></div>', { portrait: { W: 540, H: 900 } });
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
    this.btns = h('<div class="pk-controls"></div>');
    ctx.controls.appendChild(this.btns);
    // карта: из руки — выбрать, из ряда (ещё не подтверждённая) — вернуть в руку
    this.cs.stage.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-card]') as HTMLElement | null;
      if (!el || this.actSeat == null) return;
      e.preventDefault();
      const k = el.dataset.card!;
      if (this.plan.has(k)) {
        this.plan.delete(k);
        this.sel = null;
      } else this.sel = this.sel === k ? null : k;
      Sound.ui();
      this.refresh();
    });
    // пустое место ряда
    this.plates.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-row]') as HTMLElement | null;
      if (!el) return;
      e.preventDefault();
      this.putTo(Number(el.dataset.row) as 0 | 1 | 2);
    });
  }

  private get g(): Geo {
    return this.cs.portrait ? PORT : LAND;
  }

  private plain(p: number) {
    return this.ctx.name(p).replace(/<[^>]+>/g, '').replace(/\s*\(.*\)\s*$/, '');
  }

  private held(): Card[] {
    return this.actSeat == null || !this.v ? [] : this.v.held[this.actSeat].filter(Boolean);
  }

  /** Сколько карт руки надо разложить (остальные — в сброс). */
  private need(): number {
    const v = this.v;
    if (!v || this.actSeat == null) return 0;
    return this.held().length - needDiscard(v, this.actSeat);
  }

  /** Мои ряды с учётом раскладки, которую я ещё не подтвердил. */
  private myRows(p: number): { card: Card | null; key: string; plan: boolean }[][] {
    const v = this.v!;
    const rows = v.rows[p].map((r, ri) => r.map((c, i) => ({ card: c, key: c ? cardKey(c) : `b:${p}:${ri}:${i}`, plan: false })));
    if (p === this.actSeat) for (const c of this.held()) {
      const r = this.plan.get(cardKey(c));
      if (r != null) rows[r].push({ card: c, key: cardKey(c), plan: true });
    }
    return rows;
  }

  private putTo(r: 0 | 1 | 2) {
    if (this.actSeat == null) return;
    const rows = this.myRows(this.actSeat);
    if (rows[r].length >= SIZE[r] || this.plan.size >= this.need()) return;
    const free = this.held().filter((c) => !this.plan.has(cardKey(c)));
    const k = this.sel && free.some((c) => cardKey(c) === this.sel) ? this.sel : free[0] && cardKey(free[0]);
    if (!k) return;
    this.plan.set(k, r);
    this.sel = null;
    Sound.place();
    this.refresh();
  }

  private refresh() {
    this.draw();
    this.renderButtons();
  }

  private oppSeats(v: OView) {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]).slice(1);
  }

  private items(v: OView): StageItem[] {
    const g = this.g;
    const out: StageItem[] = [];
    const show = (c: Card | null, p: number) => (c && (p !== this.viewer || !this.hidden) ? c : null);
    const sc = this.score;
    // свои ряды
    const me = this.viewer;
    const rows = sc ? sc.rows[me].map((r) => r.map((c) => ({ card: c as Card | null, key: cardKey(c), plan: false }))) : this.myRows(me);
    rows.forEach((r, ri) =>
      r.forEach((x, i) => {
        const c = show(x.card, me);
        const can = x.plan && this.actSeat === me;
        out.push({ key: c ? x.key : `b:${me}:${ri}:${i}`, card: c, x: g.me.x + (i - (SIZE[ri] - 1) / 2) * g.me.step, y: g.me.ys[ri], r: 0, s: g.me.s, z: 20 + i, cls: (x.plan ? 'ofc-plan ' : '') + (can ? 'cs-can' : '') + (sc?.foul[me] ? ' cs-dim' : ''), data: can && c ? { card: x.key } : undefined });
      }),
    );
    // рука
    if (!sc) {
      const hand = v.held[me].filter((c) => !c || !this.plan.has(cardKey(c)));
      const n = hand.length;
      const per = g.held.per;
      const lines = Math.ceil(n / per);
      const step = Math.min(n <= 5 ? 100 * g.held.s + 6 : g.held.step, g.port ? 486 / Math.max(1, Math.min(n, per) - 1) : 999);
      hand.forEach((c0, i) => {
        const line = Math.floor(i / per);
        const k = i % per;
        const inLine = Math.min(per, n - line * per);
        const x = g.held.center ? g.held.x + (k - (inLine - 1) / 2) * step : g.held.x + k * step;
        const y = g.held.ys[Math.min(line, g.held.ys.length - 1)] - (lines === 1 ? 0 : 0);
        const c = show(c0, me);
        const key = c ? cardKey(c) : `h:${me}:${i}`;
        const can = !!c && this.actSeat === me;
        out.push({ key, card: c, x, y: y - (this.sel === key ? 22 : 0), r: 0, s: g.held.s, z: 60 + i, cls: this.sel === key ? 'cs-sel' : can ? 'cs-can' : '', data: can ? { card: key } : undefined });
      });
    }
    // соперники
    const opp = this.oppSeats(v);
    const xs = g.opp.xs[Math.min(opp.length, 3) - 1] ?? [];
    opp.forEach((p, k) => {
      const ox = xs[k] ?? 0;
      const rs = sc ? sc.rows[p] : v.rows[p];
      rs.forEach((r, ri) =>
        r.forEach((c, i) => out.push({ key: c ? cardKey(c) : `b:${p}:${ri}:${i}`, card: c, x: ox + (i - (SIZE[ri] - 1) / 2) * g.opp.step, y: g.opp.y0 + ri * g.opp.dy, r: 0, s: g.opp.s, z: 10 + i, cls: sc?.foul[p] ? 'cs-dim' : '' })),
      );
    });
    return out;
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.items(v), this.ctx.speed());
    const g = this.g;
    const sc = this.score;
    let s = '';
    const me = this.viewer;
    const plate = (p: number, x: number, y: number) => {
      const on = !v.over && !sc && v.turn === p;
      const tag = sc ? ` <em>${sc.net[p] > 0 ? '+' : ''}${sc.net[p]}${sc.foul[p] ? ', фол' : ''}</em>` : v.fant[p] ? ` <em>фантазия ${v.fant[p]}</em>` : v.counts[p] && p !== me ? ` <em>на руке ${v.counts[p]}</em>` : '';
      return `<div class="cs-plate${on ? ' on' : ''}" style="--c:${SEATS[p].color};left:${x}px;top:${y}px">${esc(this.plain(p))} <i>${v.pts[p]}</i>${tag}${v.button === p ? ' <b class="pk-d">D</b>' : ''}</div>`;
    };
    // свои ряды: подписи, пустые места, подсказка фола
    const rows = sc ? sc.rows[me].map((r) => r.map((c) => ({ card: c as Card | null }))) : this.myRows(me);
    const cw = 100 * g.me.s;
    const chh = 155 * g.me.s;
    const mine = this.actSeat === me && !this.hidden;
    const room = this.plan.size < this.need();
    const blind = me === this.viewer && this.hidden;
    const cardsOf = (ri: number) => (rows[ri] ?? []).map((x) => x.card).filter((c): c is Card => !!c);
    // фол: у верхнего ряда пары, который уже сильнее нижнего, — пометка «фол!» (неизбежен) или «фол?» (угроза)
    const warn = [0, 1].map((a) => (sc || blind ? null : foulRisk(a === 0 ? [cardsOf(0), cardsOf(1), []] : [[], cardsOf(1), cardsOf(2)])));
    rows.forEach((r, ri) => {
      const y = g.me.ys[ri];
      const x0 = g.me.x - ((SIZE[ri] - 1) / 2) * g.me.step;
      for (let i = r.length; i < SIZE[ri]; i++) {
        const x = x0 + i * g.me.step;
        s += `<div class="ofc-slot${mine && room && i === r.length ? ' ofc-go' : ''}" ${mine && room ? `data-row="${ri}"` : ''} style="left:${x - cw / 2}px;top:${y - chh / 2}px;width:${cw}px;height:${chh}px"></div>`;
      }
      const cards = r.map((x) => x.card).filter((c): c is Card => !!c);
      const full = cards.length === SIZE[ri];
      const nm = cards.length && !(me === this.viewer && this.hidden) ? rowName(cards, ri) : '';
      const roy = full && !sc?.foul[me] ? royalty(cards, ri) : 0;
      const lx = x0 - g.me.step / 2 - 8;
      const w = warn[ri];
      s += `<div class="ofc-lbl" style="left:${g.port ? x0 - cw / 2 : lx}px;top:${g.port ? y - chh / 2 - 18 : y - 16}px"><b>${ROW_NAME[ri]}</b>${nm ? `<span>${esc(nm)}${roy ? ` · +${roy}` : ''}</span>` : ''}${w ? `<em class="ofc-foul${w === 'foul' ? ' sure' : ''}" title="${w === 'foul' ? 'Ряд сильнее нижнего — фол' : 'Ряд уже сильнее нижнего: тот надо усилить'}">${w === 'foul' ? 'фол!' : 'фол?'}</em>` : ''}</div>`;
    });
    s += plate(me, g.port ? g.me.x : g.me.x, g.port ? g.me.ys[2] + chh / 2 + 8 : g.me.ys[2] + chh / 2 + 6);
    if (!sc && v.held[me].length && !g.port) s += `<div class="ofc-hint" style="left:${g.held.x - 31}px;top:${g.held.ys[0] - 80}px">${this.actSeat === me ? (needDiscard(v, me) ? `разложите ${this.need()}, остальное — в сброс` : `разложите ${this.need()}`) : 'ваши карты'}</div>`;
    if (v.discN[me] && !sc) s += `<div class="ofc-disc" style="left:${g.port ? 30 : g.held.x - 31}px;top:${g.port ? g.me.ys[2] + chh / 2 + 10 : g.H - 40}px">в сбросе: ${v.disc[me].map((c) => (c ? cardWord(c) : '?')).join(' ')}</div>`;
    const opp = this.oppSeats(v);
    const xs = g.opp.xs[Math.min(opp.length, 3) - 1] ?? [];
    const ow = 100 * g.opp.s;
    const oh = 155 * g.opp.s;
    opp.forEach((p, k) => {
      const ox = xs[k] ?? 0;
      s += plate(p, ox, g.opp.y0 - oh / 2 - (g.port ? 30 : 34));
      const rs = sc ? sc.rows[p] : v.rows[p];
      for (let ri = 0; ri < 3; ri++)
        for (let i = rs[ri].length; i < SIZE[ri]; i++) s += `<div class="ofc-slot" style="left:${ox + (i - (SIZE[ri] - 1) / 2) * g.opp.step - ow / 2}px;top:${g.opp.y0 + ri * g.opp.dy - oh / 2}px;width:${ow}px;height:${oh}px"></div>`;
    });
    s += `<div class="ofc-title" style="left:${g.port ? g.W / 2 : 16}px;top:${g.port ? g.opp.y0 + 2 * g.opp.dy + 40 : g.H - 30}px">${esc(OFC_NAME[v.cfg.mode])}${v.cfg.fant === 'prog' ? ', прогрессивная фантазия' : ''} · раздача ${Math.max(1, v.hand)} из ${v.cfg.deals}</div>`;
    this.plates.innerHTML = s;
  }

  // ---------------------------------------------------------------- ход

  private renderButtons() {
    this.btns.innerHTML = '';
    const v = this.v;
    const p = this.actSeat;
    if (!v || p == null || v.over || this.hidden || this.ctx.demo || this.score) return;
    const need = this.need();
    const disc = this.held().length - need;
    const risk = foulRisk(this.myRows(p).map((r) => r.map((x) => x.card).filter((c): c is Card => !!c)));
    if (risk) this.btns.appendChild(h(`<div class="ofc-warn${risk === 'foul' ? ' sure' : ''}">${risk === 'foul' ? '⚠ Фол! Ряды не усиливаются сверху вниз — рука будет «мёртвой».' : '⚠ Осторожно: ряд выше уже сильнее нижнего — нижний надо усилить, иначе фол.'}</div>`));
    this.btns.appendChild(h(`<div class="pk-ask">${v.fant[p] ? `Фантазия: разложите ${need} из ${this.held().length}${disc ? `, ${disc} — в сброс` : ''}.` : disc ? `Положите ${need === 1 ? 'одну карту' : `${need} карты`} в ряды, ${disc === 1 ? 'третья уйдёт' : 'остальные уйдут'} в сброс.` : `Разложите ${need === 1 ? 'карту' : `${need} карт${need < 5 ? 'ы' : ''}`} по рядам.`}<br><small>Коснитесь карты, потом места в ряду.</small></div>`));
    const row = h('<div class="pk-row"></div>');
    this.btns.appendChild(row);
    const rows = this.myRows(p);
    ROW_NAME.forEach((nm, r) => {
      const b = h<HTMLButtonElement>(`<button class="btn">${r === 0 ? '↑ ' : r === 2 ? '↓ ' : ''}${nm[0].toUpperCase() + nm.slice(1)}</button>`);
      b.disabled = rows[r].length >= SIZE[r] || this.plan.size >= need;
      b.onclick = () => this.putTo(r as 0 | 1 | 2);
      row.appendChild(b);
    });
    const row2 = h('<div class="pk-row"></div>');
    this.btns.appendChild(row2);
    const hint = h<HTMLButtonElement>('<button class="btn">Подсказка</button>');
    hint.onclick = () => {
      const a = chooseOfc(v, p, 1, { next: Math.random, int: (n: number) => Math.floor(Math.random() * n), getState: () => 0 });
      if (!a) return;
      this.plan.clear();
      const hs = this.held();
      a.to.forEach((t, i) => t !== 'x' && this.plan.set(cardKey(hs[i]), t));
      this.sel = null;
      Sound.ui();
      this.refresh();
    };
    row2.appendChild(hint);
    const back = h<HTMLButtonElement>('<button class="btn">Заново</button>');
    back.disabled = !this.plan.size;
    back.onclick = () => {
      this.plan.clear();
      this.sel = null;
      this.refresh();
    };
    row2.appendChild(back);
    const ok = h<HTMLButtonElement>('<button class="btn primary">Готово</button>');
    ok.disabled = this.plan.size !== need;
    ok.onclick = () => {
      const to: Slot[] = this.held().map((c) => this.plan.get(cardKey(c)) ?? 'x');
      Sound.unlock();
      this.actSeat = null;
      this.plan.clear();
      this.sel = null;
      this.btns.innerHTML = '';
      this.ctx.act(p, { type: 'place', to });
    };
    this.btns.appendChild(ok);
  }

  private showBanner(text: string, ms: number) {
    this.banner.textContent = text;
    this.banner.hidden = false;
    if (ms) setTimeout(() => (this.banner.hidden = true), ms / this.ctx.speed());
  }

  setView(v: OView) {
    this.v = v;
    this.banner.hidden = true;
    this.draw();
  }

  async play(events: OEvent[], v: OView) {
    const sp = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'oplace' && this.v) {
        const cur = this.v;
        const rows = cur.rows.map((rs, q) => (q === ev.seat ? rs.map((r) => r.slice()) : rs));
        for (const x of ev.put) rows[ev.seat][x.row].push(x.card as Card);
        this.v = { ...cur, rows, held: cur.held.map((hh, q) => (q === ev.seat ? [] : hh)), counts: cur.counts.map((n, q) => (q === ev.seat ? 0 : n)), discN: cur.discN.map((n, q) => (q === ev.seat ? n + ev.discard : n)) };
        Sound.place();
        this.draw();
        await sleep(320 / sp);
      } else if (ev.type === 'ocards') {
        Sound.card();
        await sleep(120 / sp);
      } else if (ev.type === 'oscore') {
        this.score = ev.score;
        this.draw();
        const me = this.viewer;
        const n = ev.score.net[me] ?? 0;
        if (n > 0) Sound.win();
        this.banner.innerHTML = this.scoreHtml(ev.score);
        this.banner.classList.add('ofc-score');
        this.banner.hidden = false;
        await (this.ctx.read ? this.ctx.read(4500) : sleep(4500 / sp));
        this.banner.hidden = true;
        this.banner.classList.remove('ofc-score');
        this.score = null;
      } else if (ev.type === 'odeal') {
        Sound.shuffle();
      } else if (ev.type === 'oend') {
        this.showBanner(`Больше всех очков — ${this.plain(ev.winner)}`, 0);
      }
    }
    this.v = v;
    this.draw();
  }

  /** Табличка подсчёта: итог, роялти по рядам или фол, кто идёт в фантазию. */
  private scoreHtml(sc: Score): string {
    const rows = Object.keys(sc.net)
      .map(Number)
      .map((p) => {
        const roy = sc.roy[p].reduce((a, b) => a + b, 0);
        const what = sc.foul[p] ? 'фол!' : roy ? `роялти ${sc.roy[p].filter(Boolean).length > 1 ? sc.roy[p].join('+') + ' = ' : ''}${roy}` : 'без роялти';
        return `<div><b>${esc(this.plain(p))} ${sc.net[p] > 0 ? '+' : ''}${sc.net[p]}</b> <small>${what}${sc.next[p] ? ` · фантазия ${sc.next[p]}` : ''}</small></div>`;
      });
    return `<div class="ofc-score-t">Подсчёт</div>${rows.join('')}`;
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    this.actSeat = null;
    this.plan.clear();
    this.sel = null;
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
    this.refresh();
  }

  status(v: OView, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    if (interactive.includes(who)) return v.fant[who] ? 'Фантазия: разложите все карты' : 'Разложите карты по рядам';
    return `${this.ctx.name(who)} раскладывает…`;
  }

  playerStats(v: OView, seat: number) {
    return `очков: ${v.pts[seat]}${v.fant[seat] ? ' · фантазия' : ''}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

const cardWord = (c: Card) => `${({ 14: 'Т', 13: 'К', 12: 'Д', 11: 'В' } as Record<number, string>)[c.r] ?? c.r}${({ S: '♠', C: '♣', D: '♦', H: '♥' } as Record<string, string>)[c.s]}`;

export function createOfcView(): GameView<OView, OEvent> {
  return new OfcView();
}

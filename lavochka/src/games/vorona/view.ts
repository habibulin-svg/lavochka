/* «Белая ворона» — отрисовка: поле-календарь картинкой, фишки-пуговицы на днях, в нижнем углу — кубик и деньги выборов,
 * поверх поля — открытая карточка и решение (купить бизнес, рискнуть, страховка, что продать клиенту, банк в День Белой Вороны).
 * В панели стола — свои деньги, вклад или заём, счета, облигации, бизнесы. */
import { Sound } from '../../core/audio';
import { DiceTray } from '../../core/dice';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { BIZ, GRID, MAIL, type Biz, type Variant } from './data';
import { SEATS, type Ev } from './def';
import { bankOk, billsSum, fmt, walkTo, type Action, type State } from './engine';
import './vorona.css';

const strip = (s: string) => s.replace(/<[^>]+>/g, '');

class VoronaView implements GameView<State, Ev> {
  private ctx!: ViewCtx<Action>;
  private v: State | null = null;
  private variant: Variant | null = null;
  private wrap!: HTMLElement;
  private board!: HTMLElement;
  private img!: HTMLImageElement;
  private tokensEl!: HTMLElement;
  private potEl!: HTMLElement;
  private stage!: HTMLElement;
  private float!: HTMLElement;
  private panel!: HTMLElement;
  private rollBtn!: HTMLButtonElement;
  private mine!: HTMLElement;
  private tray!: DiceTray;
  private toEl!: HTMLElement;
  private tokens = new Map<number, HTMLElement>();
  private shown: number[] = [];
  private interactive: number[] = [];
  private busy = false;
  private ro!: ResizeObserver;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="bv-wrap"><div class="bv-board">
        <img class="bv-img" alt="поле" draggable="false">
        <div class="bv-pot"><div class="bv-potsum"></div></div>
        <div class="bv-to" hidden></div>
        <div class="bv-tokens"></div>
        <div class="bv-stage"></div>
        <div class="bv-float"></div>
      </div></div>`);
    root.appendChild(this.wrap);
    this.board = this.wrap.querySelector('.bv-board') as HTMLElement;
    this.img = this.wrap.querySelector('.bv-img') as HTMLImageElement;
    this.tokensEl = this.wrap.querySelector('.bv-tokens') as HTMLElement;
    this.potEl = this.wrap.querySelector('.bv-potsum') as HTMLElement;
    this.stage = this.wrap.querySelector('.bv-stage') as HTMLElement;
    this.float = this.wrap.querySelector('.bv-float') as HTMLElement;
    this.toEl = this.wrap.querySelector('.bv-to') as HTMLElement;
    // клетка, куда ставить свою фишку после броска; своя фишка по щелчку приподнимается
    this.toEl.addEventListener('click', (e) => {
      e.preventDefault();
      this.commitMove();
    });
    this.tokensEl.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('.bv-token') as HTMLElement | null;
      if (!el || this.moveTo() == null || Number(el.dataset.seat) !== this.v!.actor) return;
      e.preventDefault();
      el.classList.toggle('lifted');
    });
    this.img.onload = () => {
      this.board.classList.add('ready');
      this.ctx.hold?.(0);
    };
    // кубик — в лотке на сукне в панели справа, как во всех играх
    this.panel = h(`<div class="bv-panel">
        <div class="bv-dice"></div>
        <button class="btn primary bv-roll" data-tap hidden>Бросить кубик</button>
        <div class="bv-mine"></div>
      </div>`);
    ctx.controls.appendChild(this.panel);
    this.tray = new DiceTray(this.panel.querySelector('.bv-dice') as HTMLElement, 1);
    this.rollBtn = this.panel.querySelector('.bv-roll') as HTMLButtonElement;
    this.mine = this.panel.querySelector('.bv-mine') as HTMLElement;
    this.rollBtn.onclick = () => this.send({ type: 'roll' });
    this.mine.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-bank]') as HTMLElement | null;
      if (el) this.send({ type: 'bank', n: Number(el.dataset.bank) });
    });
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.wrap);
  }

  private fit() {
    const r = this.wrap.getBoundingClientRect();
    const ratio = this.variant ? GRID[this.variant].ratio : 1;
    const w = Math.max(200, Math.floor(Math.min(r.width, r.height / ratio)));
    this.board.style.width = w + 'px';
    this.board.style.height = Math.round(w * ratio) + 'px';
    this.board.style.setProperty('--u', w / 100 + 'px');
  }

  private useVariant(v: Variant) {
    if (this.variant === v) return;
    this.variant = v;
    this.board.dataset.variant = v;
    this.img.src = GRID[v].img;
    this.ctx.hold?.(8000);
    const g = GRID[v];
    // нижний правый блок поля (под клетками 32–34) — кубик и деньги выборов
    Object.assign((this.wrap.querySelector('.bv-pot') as HTMLElement).style, {
      left: (g.x + 4 * g.w) * 100 + '%',
      top: ((g.y + 4 * g.h) / g.ratio) * 100 + '%',
      width: 3 * g.w * 100 + '%',
      height: (g.h / g.ratio) * 100 + '%',
    });
    this.fit();
  }

  /** Фаза хода у этого экрана: клетка, на которую игрок ставит свою фишку; иначе null. */
  private moveTo(): number | null {
    const v = this.v;
    if (!v || this.busy || this.ctx.demo || v.phase !== 'move' || !this.interactive.includes(v.actor)) return null;
    return walkTo(v);
  }

  private commitMove() {
    const v = this.v;
    if (!v || this.moveTo() == null) return;
    this.tokens.get(v.actor)?.classList.remove('lifted');
    this.send({ type: 'move' });
  }

  /** Центр клетки дня в % от ширины и высоты поля. */
  private cellXY(i: number) {
    const g = GRID[this.variant!];
    const col = i % 7;
    const row = Math.floor(i / 7);
    return { x: (g.x + (col + 0.5) * g.w) * 100, y: ((g.y + (row + 0.55) * g.h) / g.ratio) * 100 };
  }

  setView(v: State) {
    this.useVariant(v.variant);
    this.v = v;
    this.shown = v.pos.slice();
    if (v.dice) this.tray.show([v.dice]);
    this.render();
  }

  async play(events: Ev[], v: State) {
    const speed = this.ctx.speed();
    this.useVariant(v.variant);
    this.busy = true;
    this.stage.textContent = '';
    for (const ev of events) {
      switch (ev.type) {
        case 'roll':
          await this.tray.roll([ev.d], speed);
          break;
        case 'move': {
          const el = this.tokens.get(ev.seat);
          el?.classList.add('lifted');
          for (const p of ev.path) {
            this.shown[ev.seat] = p;
            this.placeTokens();
            Sound.step();
            await sleep((ev.back ? 300 : 180) / speed);
          }
          el?.classList.remove('lifted');
          Sound.place();
          break;
        }
        case 'mail':
          this.stage.innerHTML = `<div class="bv-show">${mailHtml(ev.id)}</div>`;
          Sound.card();
          await (this.ctx.read ? this.ctx.read(1500) : sleep(1500 / speed));
          break;
        case 'biz':
          if (ev.buy == null) {
            this.stage.innerHTML = `<div class="bv-show">${bizHtml(BIZ[v.variant][ev.id])}</div>`;
            Sound.card();
            await sleep(1100 / speed);
          }
          break;
        case 'pay':
          if (typeof ev.from === 'number') this.delta(ev.from, -ev.amount);
          if (typeof ev.to === 'number') this.delta(ev.to, ev.amount);
          await sleep(300 / speed);
          break;
        case 'risk':
          await this.tray.roll([ev.d], speed);
          this.say(ev.win ? `${ev.d}! Выигрыш 1000` : `${ev.d} — ставка пропала`);
          await sleep(800 / speed);
          break;
        case 'auction':
          for (const r of ev.rolls) {
            this.say(`Аукцион: ${r.map((q) => `${strip(this.ctx.name(q.seat))} ${q.d}`).join(', ')}`);
            await sleep(1200 / speed);
          }
          this.delta(ev.winner, ev.pot);
          Sound.win();
          break;
        case 'sell':
          this.say(`Сделка: +${fmt(ev.price)}`);
          this.delta(ev.seat, ev.price);
          await sleep(800 / speed);
          if (ev.to != null) {
            this.say(`Комиссионные ${fmt(ev.fee)} — ${strip(this.ctx.name(ev.to))}`);
            this.delta(ev.to, ev.fee);
            await sleep(900 / speed);
          }
          break;
        case 'election':
          this.say(`Шестёрка! Выборы царя зверей: +${fmt(ev.pot)}`);
          this.delta(ev.seat, ev.pot);
          Sound.win();
          await sleep(1000 / speed);
          break;
        case 'payday':
          this.say(`День Белой Вороны: зарплата 325${ev.bills ? `, счета ${fmt(ev.bills)}` : ''}`);
          await sleep(1100 / speed);
          break;
        case 'end':
          Sound.win();
          break;
      }
    }
    this.v = v;
    this.shown = v.pos.slice();
    this.busy = false;
    this.render();
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.interactive = interactive;
    this.render();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.result) return `${v.result.winners.map((s) => this.ctx.name(s)).join(', ')}: ${v.result.text}!`;
    const who = toAct[0];
    const me = interactive.includes(who);
    const nm = this.ctx.name(who);
    switch (v.phase) {
      case 'roll':
        return me ? `Бросайте кубик (месяц ${v.month[who] + 1} из ${v.months})` : `Ходит ${nm}…`;
      case 'move':
        return me ? `Выпало ${v.dice} — переставьте свою фишку на подсвеченный день` : `${nm} переставляет фишку…`;
      case 'mail':
        return me ? 'Почта: решайте' : `${nm} читает почту…`;
      case 'biz':
        return me ? 'Покупать бизнес?' : `${nm} думает о бизнесе…`;
      case 'client':
        return me ? 'Клиент: что продаёте?' : `${nm} заключает сделку…`;
      case 'payday':
        return me ? 'День Белой Вороны: банк — вклад или заём' : `${nm} в банке…`;
    }
    return '';
  }

  playerStats(v: State, seat: number) {
    const bank = v.bank[seat];
    const flags = [
      bank > 0 ? `вклад ${fmt(bank)}` : bank < 0 ? `<b class="bv-debt">заём ${fmt(-bank)}</b>` : '',
      v.bills[seat].length ? `счета ${fmt(billsSum(v, seat))}` : '',
      v.biz[seat].length ? `бизнес ×${v.biz[seat].length}` : '',
      v.done[seat] ? 'отыграл' : `мес. ${v.month[seat] + 1}/${v.months}`,
    ].filter(Boolean);
    return `<b>${fmt(v.cash[seat])}</b> · ${flags.join(' · ')}`;
  }

  destroy() {
    this.ro.disconnect();
  }

  // ---------- отрисовка ----------

  private render() {
    const v = this.v;
    if (!v) return;
    this.syncTokens();
    this.placeTokens();
    const to = this.moveTo();
    this.toEl.hidden = to == null;
    if (to != null) {
      const g = GRID[this.variant!];
      const c = this.cellXY(to);
      Object.assign(this.toEl.style, { left: c.x - g.w * 50 + '%', top: c.y - (g.h / g.ratio) * 55 + '%', width: g.w * 100 + '%', height: (g.h / g.ratio) * 100 + '%' });
    }
    for (const [s, el] of this.tokens) el.classList.toggle('grab', to != null && s === v.actor);
    this.potEl.innerHTML = v.pot ? `выборы царя зверей: <b>${fmt(v.pot)}</b>` : '';
    if (!this.busy) this.renderStage();
    this.renderPanel();
  }

  private syncTokens() {
    const v = this.v!;
    for (const s of v.seats) {
      let el = this.tokens.get(s);
      if (!el) {
        el = h(`<div class="bv-token" data-seat="${s}"><div class="bv-btn" style="background-image:url(/hodilki/buttons/${s}.webp)"></div></div>`);
        this.tokensEl.appendChild(el);
        this.tokens.set(s, el);
      }
      el.classList.toggle('on', !v.result && v.actor === s);
      el.classList.toggle('done', v.done[s]);
    }
  }

  private placeTokens() {
    const v = this.v!;
    const by = new Map<number, number[]>();
    for (const s of v.seats) {
      const p = this.shown[s] ?? 0;
      by.set(p, [...(by.get(p) ?? []), s]);
    }
    for (const [p, ss] of by) {
      const c = this.cellXY(p);
      ss.forEach((s, k) => {
        const el = this.tokens.get(s)!;
        const n = ss.length;
        const ang = (k / n) * Math.PI * 2 - Math.PI / 2;
        const r = n > 1 ? 3.6 : 0;
        el.style.left = c.x + Math.cos(ang) * r + '%';
        el.style.top = c.y + Math.sin(ang) * r + '%';
      });
    }
  }

  private me(): number | null {
    const v = this.v!;
    if (this.interactive.includes(v.actor)) return v.actor;
    return this.ctx.mySeats.find((s) => v.seats.includes(s)) ?? null;
  }

  private renderPanel() {
    const v = this.v!;
    const actor = this.interactive.includes(v.actor) ? v.actor : null;
    this.rollBtn.hidden = !(actor != null && v.phase === 'roll' && !v.result && !this.busy && !this.ctx.demo);
    const me = this.me();
    if (me == null || this.ctx.demo) {
      this.mine.textContent = '';
      return;
    }
    const b = BIZ[v.variant];
    const bank = v.bank[me];
    const canLoan = !this.busy && bankOk(v, me, -100);
    const bills = v.bills[me].map((id) => `<li>${esc(MAIL[id].who)} — <b>${fmt(MAIL[id].n)}</b></li>`).join('');
    const bonds = v.bonds[me].map((id) => fmt(MAIL[id].n)).join(', ');
    this.mine.innerHTML = `<div class="bv-cash"><b>${fmt(v.cash[me])}</b> монет</div>
      <div class="bv-bank ${bank < 0 ? 'debt' : ''}">${bank > 0 ? `Вклад: <b>${fmt(bank)}</b>` : bank < 0 ? `Заём: <b>${fmt(-bank)}</b>` : 'В банке ничего'}
        ${canLoan && v.phase !== 'payday' ? '<button class="btn" data-bank="-100">Взять в долг 100</button>' : ''}</div>
      ${v.vet[me] || v.hunt[me] ? `<div class="bv-flags">${v.vet[me] ? '🩺 ветеринарное страхование' : ''}${v.vet[me] && v.hunt[me] ? ' · ' : ''}${v.hunt[me] ? '🎯 охотничий билет' : ''}</div>` : ''}
      ${bills ? `<div class="bv-sub">Счета к Дню Белой Вороны (${fmt(billsSum(v, me))}):</div><ul class="bv-bills">${bills}</ul>` : ''}
      ${bonds ? `<div class="bv-sub">Облигации: ${bonds} — погасить в «День тиража»</div>` : ''}
      ${v.biz[me].length ? `<div class="bv-sub">Бизнес:</div><div class="bv-bizs">${v.biz[me].map((id) => bizHtml(b[id], true)).join('')}</div>` : ''}`;
  }

  private renderStage() {
    const v = this.v!;
    const st = this.stage;
    if (v.result || this.ctx.demo) {
      st.innerHTML = v.result
        ? `<div class="bv-box"><div class="bv-q big">🏆 ${v.result.winners.map((s) => this.ctx.name(s)).join(', ')}</div>
          <div class="bv-score">${v.seats
            .slice()
            .sort((a, b) => v.result!.scores[b] - v.result!.scores[a])
            .map((s) => `<div>${this.ctx.name(s)}<b>${fmt(v.result!.scores[s])}</b></div>`)
            .join('')}</div></div>`
        : v.card && v.phase !== 'roll'
          ? `<div class="bv-show">${v.card.kind === 'mail' ? mailHtml(v.card.id) : bizHtml(BIZ[v.variant][v.card.id])}</div>`
          : '';
      return;
    }
    const seat = v.actor;
    const me = this.interactive.includes(seat);
    const nm = this.ctx.name(seat);
    let html = '';
    switch (v.phase) {
      case 'mail': {
        const m = MAIL[v.card!.id];
        const btn = m.kind === 'risk' ? ['Рискнуть 100', 'Не рисковать'] : [`Оплатить ${fmt(m.n)}`, 'Отбросить'];
        html = `${mailHtml(v.card!.id)}${me ? `<div class="bv-btns"><button class="btn primary" data-a="buy">${btn[0]}</button><button class="btn" data-a="pass">${btn[1]}</button></div>` : `<div class="bv-q">${nm} решает…</div>`}`;
        break;
      }
      case 'biz': {
        const b = BIZ[v.variant][v.card!.id];
        const short = Math.max(0, b.cost - v.cash[seat]);
        html = `${bizHtml(b)}${
          me
            ? `<div class="bv-btns"><button class="btn primary" data-a="buy">Купить за ${fmt(b.cost)}</button><button class="btn" data-a="pass">Вниз стопки</button></div>
              ${short ? `<div class="bv-hint">Не хватает ${fmt(short)} — возьмёте в долг у банка${v.bank[seat] > 0 ? ' (из вклада)' : ''}</div>` : ''}`
            : `<div class="bv-q">${nm}: покупать ли бизнес?</div>`
        }`;
        break;
      }
      case 'client': {
        const list = v.biz[seat];
        html = `<div class="bv-q">Клиент! ${me ? 'Какой бизнес продаёте?' : nm + ' продаёт бизнес'}</div>
          <div class="bv-bizs big">${list.map((id, i) => `<button class="bv-pick" data-sell="${i}" ${me ? '' : 'disabled'}>${bizHtml(BIZ[v.variant][id], true)}</button>`).join('')}</div>`;
        break;
      }
      case 'payday': {
        if (!me) {
          html = `<div class="bv-q">${nm}: День Белой Вороны, банк</div>`;
          break;
        }
        const bank = v.bank[seat];
        const ops: string[] = [];
        if (bank < 0) {
          const all = Math.min(-bank, Math.floor(v.cash[seat] / 50) * 50);
          if (all >= 50) ops.push(`<button class="btn primary" data-bank="${all}">Погасить ${all === -bank ? 'весь заём' : fmt(all)}</button>`);
          if (-bank >= 100 && v.cash[seat] >= 100 && all !== 100) ops.push(`<button class="btn" data-bank="100">Погасить 100</button>`);
        } else {
          for (const n of [100, 500]) if (v.cash[seat] >= n) ops.push(`<button class="btn" data-bank="${n}">Во вклад ${n}</button>`);
          const all = Math.floor(v.cash[seat] / 50) * 50;
          if (all >= 50 && all !== 100 && all !== 500) ops.push(`<button class="btn" data-bank="${all}">Во вклад всё (${fmt(all)})</button>`);
          if (bank >= 100) ops.push(`<button class="btn" data-bank="-100">Снять 100</button>`);
          if (bank > 0 && bank % 50 === 0) ops.push(`<button class="btn" data-bank="${-bank}">Снять весь вклад</button>`);
        }
        if (bank <= 0) ops.push('<button class="btn" data-bank="-100">Взять в долг 100</button>');
        html = `<div class="bv-q">🐦 День Белой Вороны · наличные <b>${fmt(v.cash[seat])}</b> · ${bank > 0 ? `вклад ${fmt(bank)} (10 % в месяц)` : bank < 0 ? `заём ${fmt(-bank)} (20 % в месяц, до 100 — без процентов)` : 'в банке пусто'}</div>
          <div class="bv-btns">${ops.join('')}</div>
          <div class="bv-btns"><button class="btn primary" data-a="done">Закрыть месяц</button></div>`;
        break;
      }
    }
    st.innerHTML = html ? `<div class="bv-box">${html}</div>` : '';
    st.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((el) => (el.onclick = () => this.send({ type: el.dataset.a } as Action)));
    st.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach((el) => (el.onclick = () => this.send({ type: 'sell', i: Number(el.dataset.sell) })));
    st.querySelectorAll<HTMLButtonElement>('[data-bank]').forEach((el) => (el.onclick = () => this.send({ type: 'bank', n: Number(el.dataset.bank) })));
  }

  private send(a: Action) {
    const v = this.v;
    if (!v || this.busy || !this.interactive.includes(v.actor)) return;
    Sound.unlock();
    this.ctx.act(v.actor, a);
  }

  private say(text: string) {
    const el = h(`<div class="bv-say">${esc(text)}</div>`);
    this.float.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  private delta(seat: number, n: number) {
    const tok = this.tokens.get(seat);
    if (!tok) return;
    const el = h(`<div class="bv-delta ${n > 0 ? 'plus' : 'minus'}" style="left:${tok.style.left};top:${tok.style.top};--c:${SEATS[seat].color}">${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}</div>`);
    this.float.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
}

/** Карточка «Почты» — как напечатана: круг «Оплатить»/«Взять», текст в рамке, полоса с отправителем. */
function mailHtml(id: number) {
  const m = MAIL[id];
  if (m.kind === 'junk') return `<div class="bv-mail junk"><div class="bv-mw">${esc(m.who)}</div><div class="bv-mt">${esc(m.text)}</div></div>`;
  if (m.kind === 'risk') return `<div class="bv-mail risk"><div class="bv-risk">5<small>или</small>6</div><div class="bv-mt">${esc(m.text)}</div></div>`;
  const take = m.kind === 'take' || m.kind === 'bond';
  return `<div class="bv-mail"><div class="bv-mtop"><div class="bv-circle ${take ? 'take' : ''}">${take ? 'Взять' : 'Оплатить'}<b>${fmt(m.n)}</b></div><div class="bv-mt">${esc(m.text)}</div></div>
    <div class="bv-band ${m.band}">${esc(m.who)}</div></div>`;
}

/** Карточка «Бизнес»: скан синего издания или напечатанная по образцу (зелёное). */
function bizHtml(b: Biz, small = false) {
  const nums = `<div class="bv-bn"><span>плата <b>${fmt(b.cost)}</b></span><span>цена <b>${fmt(b.price)}</b></span><span>комиссионные <b>${fmt(b.fee)}</b></span></div>`;
  if (b.img) return `<div class="bv-biz ${small ? 'small' : ''}" style="background-image:url(${b.img})" title="${esc(b.name)}: плата ${b.cost}, цена ${b.price}">${small ? `<em>${esc(b.name)}</em>` : ''}</div>`;
  return `<div class="bv-biz drawn ${small ? 'small' : ''}"><div class="bv-bt">${esc(b.name)}</div>${nums}</div>`;
}

export function createView(): GameView<State, Ev> {
  return new VoronaView();
}


/* «Менеджер» / «Космос 2000» — отрисовка: оригинальное поле картинкой (print'n'play-скан), поверх клеток — владельцы, филиалы,
 * залог, жетоны «Космоса»; пуговицы игроков; в центре поля — кубики, вытянутая карточка и то, что сейчас решать
 * (покупка, торги, сделка, долг, страховка, казино). Нажатие на участок — его карточка «Право на собственность» с действиями. */
import { Sound } from '../../core/audio';
import { DiceTray } from '../../core/dice';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { boardOf, CASINO, CASINO_STAR, INSURE, RATE, type Board, type MapId } from './boards';
import type { Ev } from './def';
import { SEATS } from './def';
import {
  alive,
  canBuild,
  canMortgage,
  canRedeem,
  canSell,
  dollars,
  fmt,
  fullGroup,
  owned,
  redeemCost,
  rent,
  tradeable,
  type Action,
  type State,
} from './engine';
import './manager.css';

const strip = (s: string) => s.replace(/<[^>]+>/g, '');

interface Deal {
  to: number;
  give: Set<number>;
  get: Set<number>;
  cash: number;
  cards: number;
}

class ManagerView implements GameView<State, Ev> {
  private ctx!: ViewCtx<Action>;
  private b: Board | null = null;
  private v: State | null = null;
  private wrap!: HTMLElement;
  private board!: HTMLElement;
  private img!: HTMLImageElement;
  private cellsEl!: HTMLElement;
  private tokensEl!: HTMLElement;
  private center!: HTMLElement;
  private cardEl!: HTMLElement;
  private prompt!: HTMLElement;
  private pop!: HTMLElement;
  private float!: HTMLElement;
  private panel!: HTMLElement;
  private rollBtn!: HTMLButtonElement;
  private dealBtn!: HTMLButtonElement;
  private mine!: HTMLElement;
  private tray: DiceTray | null = null;
  private trayEl!: HTMLElement;
  private shown: number[] = [];
  private tokens = new Map<number, HTMLElement>();
  private marks: HTMLElement[] = [];
  private interactive: number[] = [];
  private busy = false;
  private popCell: number | null = null;
  private deal: Deal | null = null;
  private ro!: ResizeObserver;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="mg-wrap">
        <div class="mg-board">
          <img class="mg-img" alt="поле" draggable="false">
          <div class="mg-cells"></div>
          <div class="mg-center">
            <div class="mg-tray"></div>
            <div class="mg-card" hidden></div>
            <div class="mg-prompt"></div>
          </div>
          <div class="mg-tokens"></div>
          <div class="mg-float"></div>
          <div class="mg-pop" hidden></div>
        </div>
      </div>`);
    root.appendChild(this.wrap);
    this.board = this.wrap.querySelector('.mg-board') as HTMLElement;
    this.img = this.wrap.querySelector('.mg-img') as HTMLImageElement;
    this.cellsEl = this.wrap.querySelector('.mg-cells') as HTMLElement;
    this.tokensEl = this.wrap.querySelector('.mg-tokens') as HTMLElement;
    this.center = this.wrap.querySelector('.mg-center') as HTMLElement;
    this.trayEl = this.wrap.querySelector('.mg-tray') as HTMLElement;
    this.cardEl = this.wrap.querySelector('.mg-card') as HTMLElement;
    this.prompt = this.wrap.querySelector('.mg-prompt') as HTMLElement;
    this.pop = this.wrap.querySelector('.mg-pop') as HTMLElement;
    this.float = this.wrap.querySelector('.mg-float') as HTMLElement;
    this.img.onload = () => {
      this.board.classList.add('ready');
      this.ctx.hold?.(0);
    };

    this.panel = h(`<div class="mg-panel">
        <button class="btn primary mg-roll" data-tap hidden>Бросить кубики</button>
        <button class="btn mg-deal" hidden>Сделка…</button>
        <div class="mg-mine"></div>
      </div>`);
    ctx.controls.appendChild(this.panel);
    this.rollBtn = this.panel.querySelector('.mg-roll') as HTMLButtonElement;
    this.dealBtn = this.panel.querySelector('.mg-deal') as HTMLButtonElement;
    this.mine = this.panel.querySelector('.mg-mine') as HTMLElement;
    this.rollBtn.onclick = () => this.send({ type: 'roll' });
    this.dealBtn.onclick = () => this.openDeal(null);

    this.cellsEl.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-cell]') as HTMLElement | null;
      if (!el || this.ctx.demo) return;
      const c = Number(el.dataset.cell);
      if (this.b?.cells[c].kind !== 'prop') return;
      e.preventDefault(); // не тап «по свободному месту»: стол бросил бы кубики
      this.openCard(c);
    });
    this.mine.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-cell]') as HTMLElement | null;
      if (el) this.openCard(Number(el.dataset.cell));
    });
    this.pop.addEventListener('click', (e) => {
      e.preventDefault();
      const t = e.target as HTMLElement;
      if (t === this.pop || t.closest('[data-close]')) this.closePop();
    });

    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.wrap);
  }

  private fit() {
    const r = this.wrap.getBoundingClientRect();
    const size = Math.max(200, Math.floor(Math.min(r.width, r.height)));
    this.board.style.width = this.board.style.height = size + 'px';
    this.board.style.setProperty('--u', size / 100 + 'px');
  }

  private useBoard(map: MapId) {
    if (this.b?.id === map) return;
    const b = boardOf(map);
    this.b = b;
    this.board.dataset.map = map;
    this.img.src = b.img;
    this.ctx.hold?.(8000);
    // внутренний квадрат поля — под кубики, карточку и решения
    const inner = b.cells[0].w;
    Object.assign(this.center.style, { left: inner * 100 + '%', top: inner * 100 + '%', width: (1 - 2 * inner) * 100 + '%', height: (1 - 2 * inner) * 100 + '%' });
    Object.assign(this.pop.style, { left: inner * 100 + '%', top: inner * 100 + '%', width: (1 - 2 * inner) * 100 + '%', height: (1 - 2 * inner) * 100 + '%' });
    this.cellsEl.textContent = '';
    this.marks = b.cells.map((c, i) => {
      const el = h(`<div class="mg-cell side-${c.side}${c.kind === 'prop' ? ' prop' : ''}" data-cell="${i}"
          style="left:${c.x * 100}%;top:${c.y * 100}%;width:${c.w * 100}%;height:${c.h * 100}%"></div>`);
      this.cellsEl.appendChild(el);
      return el;
    });
    this.tokensEl.textContent = '';
    this.tokens.clear();
    this.trayEl.textContent = '';
    this.tray = new DiceTray(this.trayEl, map === 'kosmos' ? 1 : 2);
  }

  // ---------- состояние ----------

  setView(v: State) {
    this.useBoard(v.map);
    this.v = v;
    this.shown = v.pos.slice();
    if (v.dice) this.tray?.show(v.dice);
    this.render();
  }

  async play(events: Ev[], v: State) {
    const speed = this.ctx.speed();
    this.useBoard(v.map);
    this.busy = true;
    this.closePop();
    this.prompt.textContent = '';
    for (const ev of events) {
      switch (ev.type) {
        case 'roll':
          this.cardEl.hidden = true;
          await this.tray?.roll(ev.dice, speed);
          break;
        case 'move': {
          const el = this.tokens.get(ev.seat);
          el?.classList.add('lifted');
          for (const p of ev.path) {
            this.shown[ev.seat] = p;
            this.placeTokens();
            Sound.step();
            await sleep((ev.path.length > 12 ? 70 : 170) / speed);
          }
          el?.classList.remove('lifted');
          Sound.place();
          await sleep(120 / speed);
          break;
        }
        case 'jump': {
          const el = this.tokens.get(ev.seat);
          el?.classList.add('fly');
          this.shown[ev.seat] = ev.to;
          this.placeTokens();
          Sound.jump();
          await sleep(800 / speed);
          el?.classList.remove('fly');
          break;
        }
        case 'card':
          this.showCard(ev.deck, ev.id);
          Sound.card();
          await sleep(1500 / speed);
          break;
        case 'pay':
          this.money(ev.from, -ev.amount);
          this.money(ev.to, ev.amount);
          await sleep(350 / speed);
          break;
        case 'casino':
          this.say(`Казино: сектор ${ev.sector} — ${ev.amount > 0 ? '+' : '−'}${fmt(Math.abs(ev.amount))}${ev.star ? ' ★' : ''}`);
          await sleep(900 / speed);
          break;
        case 'buy':
        case 'won':
        case 'build':
        case 'unbuild':
        case 'mortgage':
        case 'sellBank':
          Sound.place();
          await sleep(200 / speed);
          break;
        case 'jail':
          this.say(`${strip(this.ctx.name(ev.seat))} — на бирже`);
          Sound.nomove();
          await sleep(700 / speed);
          break;
        case 'bankrupt':
          this.say(`${strip(this.ctx.name(ev.seat))} разорился`);
          Sound.capture();
          await sleep(900 / speed);
          break;
        case 'loan':
          this.say(`${strip(this.ctx.name(ev.seat))} — банкрот, ссуда 1 000`);
          await sleep(900 / speed);
          break;
        case 'deal':
          this.say(ev.ok ? 'Сделка!' : 'От сделки отказались');
          await sleep(600 / speed);
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
    const b = boardOf(v.map);
    switch (v.phase) {
      case 'roll':
        if (v.jail[who]) return me ? 'Вы на бирже: дубль, 500 или карточка освобождения' : `${nm} на бирже…`;
        return me ? (b.id !== 'kosmos' ? 'Бросайте кубики (до броска можно строить, закладывать и меняться)' : 'Бросайте кубик') : `Ходит ${nm}…`;
      case 'buy':
        return me ? `Покупать ${esc(b.cells[v.pos[who]].full ?? '')}?` : `${nm} думает, покупать ли…`;
      case 'auction':
        return me ? 'Торги: ваша ставка' : `Торги: решает ${nm}`;
      case 'offer':
        return me ? 'Вам предлагают сделку' : `${nm} думает над сделкой…`;
      case 'debt':
        return me ? 'Не хватает денег: продайте постройки или заложите участки' : `${nm} ищет деньги…`;
      case 'insure':
        if (b.id === 'biznes') return me ? 'Прошли «Страховое общество»: страхуетесь?' : `${nm} думает о страховке…`;
        return me ? 'Страховое агентство: страхуетесь?' : `${nm} в страховом агентстве…`;
      case 'exchange':
        return me ? 'Валютная биржа: меняйте рубли на доллары и обратно' : `${nm} на валютной бирже…`;
      case 'casino':
      case 'casino2':
        return me ? 'Казино: бросайте кубик' : `${nm} в казино…`;
      case 'bankBuy':
        return me ? 'Выкупить планету у банка?' : `${nm} думает…`;
    }
    return '';
  }

  playerStats(v: State, seat: number) {
    const b = boardOf(v.map);
    if (v.out[seat]) return 'разорился';
    const n = owned(v, seat).length;
    const biz = b.id === 'biznes';
    const ins = v.ins[seat] ? (v.ins[seat] === 2 || biz ? 'страховка' : '½ страховки') : '';
    const perk = biz ? [v.perk[seat] & 1 ? 'без налога' : v.perk[seat] & 2 ? 'налог ½' : '', v.perk[seat] & 4 ? 'стройка запрещена' : ''] : [];
    const flags = [biz && v.usd[seat] ? `<b>${dollars(v.usd[seat])}</b>` : '', v.jail[seat] ? 'на бирже' : '', ins, ...perk, v.loan[seat] ? 'ссуда' : '', v.skip[seat] ? 'пропуск' : '']
      .filter(Boolean)
      .join(' · ');
    return `<b>${fmt(v.cash[seat])}</b> ${b.cur} · ${n} ${b.id === 'kosmos' ? 'пл.' : 'уч.'}${flags ? ' · ' + flags : ''}`;
  }

  destroy() {
    this.ro.disconnect();
  }

  // ---------- отрисовка ----------

  /** Место, которое может делать операции прямо сейчас (свой ход до броска, покупка, долг). */
  private opSeat(): number | null {
    const v = this.v;
    if (!v || v.result || this.busy || this.ctx.demo) return null;
    if (!['roll', 'buy', 'debt'].includes(v.phase)) return null;
    return this.interactive.includes(v.turn) ? v.turn : null;
  }

  /** Чьё имущество показывать в панели: ходящий за этим экраном или первый свой. */
  private meSeat(): number | null {
    const v = this.v;
    if (!v) return null;
    if (this.interactive.includes(v.turn)) return v.turn;
    return this.ctx.mySeats.find((s) => v.seats.includes(s)) ?? null;
  }

  private render() {
    const v = this.v;
    const b = this.b;
    if (!v || !b) return;
    // клетки: владелец, постройки, залог
    b.cells.forEach((c, i) => {
      const el = this.marks[i];
      if (c.kind !== 'prop') return;
      const o = v.owner[i];
      el.classList.toggle('owned', o != null);
      el.classList.toggle('mort', v.mort[i]);
      el.style.setProperty('--own', o == null ? 'transparent' : o < 0 ? '#777' : SEATS[o].color);
      let html = '';
      if (b.id === 'kosmos') {
        if (o != null) html = o < 4 ? `<i class="mg-chip" style="background-image:url(/manager/chip-${o < 0 ? 'bank' : o}.webp)"></i>` : `<i class="mg-chip ring" style="--c:${SEATS[o].color}"></i>`;
      } else if (o != null) {
        const hs = v.houses[i];
        html = `<i class="mg-band">${hs === 4 ? '<b class="mg-ent"></b>' : '<b class="mg-house"></b>'.repeat(hs)}</i>${v.mort[i] ? '<span class="mg-mort">залог</span>' : ''}`;
      }
      if (el.dataset.html !== html) {
        el.innerHTML = html;
        el.dataset.html = html;
      }
    });
    this.syncTokens();
    this.placeTokens();
    if (!this.busy) {
      if (v.card) this.showCard(v.card.deck, v.card.id);
      else this.cardEl.hidden = true;
      this.renderPrompt();
    }
    this.renderPanel();
    if (this.popCell != null && !this.busy) this.openCard(this.popCell);
    if (this.deal && !this.busy) this.renderDeal();
  }

  private syncTokens() {
    const v = this.v;
    if (!v) return;
    for (const s of v.seats) {
      let el = this.tokens.get(s);
      if (!el) {
        // «Космос»: ходят теми же жетонами SPACE 2000, что метят планеты (fishki.pdf, четыре цвета); «Менеджер» — пуговицы: фишек в распечатке нет
        const look = this.b?.id === 'kosmos' ? (s < 4 ? `chip" style="background-image:url(/manager/chip-${s}.webp)` : `chip ring" style="--c:${SEATS[s].color}`) : `" style="background-image:url(/hodilki/buttons/${s}.webp)`;
        el = h(`<div class="mg-token" data-seat="${s}"><div class="mg-btn ${look}"></div></div>`);
        this.tokensEl.appendChild(el);
        this.tokens.set(s, el);
      }
      el.hidden = v.out[s];
      el.classList.toggle('on', !v.result && v.turn === s);
    }
  }

  private placeTokens() {
    const v = this.v;
    const b = this.b;
    if (!v || !b) return;
    const by = new Map<number, number[]>();
    for (const s of v.seats) {
      if (v.out[s]) continue;
      const p = this.shown[s] ?? 0;
      by.set(p, [...(by.get(p) ?? []), s]);
    }
    for (const [p, ss] of by) {
      const c = b.cells[p];
      ss.forEach((s, k) => {
        const el = this.tokens.get(s)!;
        const n = ss.length;
        const ang = (k / n) * Math.PI * 2 - Math.PI / 2;
        const r = n > 1 ? Math.min(c.w, c.h) * 0.22 : 0;
        el.style.left = (c.x + c.w / 2 + Math.cos(ang) * r) * 100 + '%';
        el.style.top = (c.y + c.h / 2 + Math.sin(ang) * r) * 100 + '%';
      });
    }
  }

  private renderPanel() {
    const v = this.v!;
    const b = this.b!;
    const op = this.opSeat();
    const actor = this.interactive.includes(v.turn) ? v.turn : null;
    this.rollBtn.hidden = !(actor != null && v.phase === 'roll' && !v.result && !this.busy && !this.ctx.demo);
    this.rollBtn.textContent = v.jail[v.turn] ? 'Бросить на дубль' : b.id !== 'kosmos' ? 'Бросить кубики' : 'Бросить кубик';
    this.dealBtn.hidden = !(op != null && v.phase === 'roll' && v.offers < 3 && alive(v).length > 1);
    const me = this.meSeat();
    if (me == null || this.ctx.demo) {
      this.mine.textContent = '';
      return;
    }
    const props = owned(v, me);
    const notes = this.notes(v.cash[me], b.notes);
    const usd = b.usdNotes && v.usd[me] ? `<div class="mg-cash usd"><span class="mg-sum">${dollars(v.usd[me])}</span><span class="mg-notes">${this.notes(v.usd[me], b.usdNotes)}</span></div>` : '';
    this.mine.innerHTML = `<div class="mg-cash"><span class="mg-sum">${fmt(v.cash[me])} ${b.cur}</span><span class="mg-notes">${notes}</span></div>${usd}
      ${v.freeCards[me].length ? `<div class="mg-free">🎫 освобождение от биржи × ${v.freeCards[me].length}</div>` : ''}
      ${props.length ? `<div class="mg-props">${props.map((c) => this.chip(c)).join('')}</div>` : `<div class="mg-empty">${b.id === 'kosmos' ? 'Планет пока нет' : 'Участков пока нет'}</div>`}`;
  }

  /** Пачка купюр под суммой: по одной картинке каждого нужного номинала. */
  private notes(sum: number, list: Board['notes']) {
    const b = this.b!;
    const out: string[] = [];
    let rest = sum;
    for (const n of list) {
      const k = Math.floor(rest / n.v);
      if (!k) continue;
      rest -= k * n.v;
      out.push(`<i class="mg-note${b.id === 'kosmos' ? ' h' : ''}" style="background-image:url(${n.img})" title="${fmt(n.v)} × ${k}"><em>${k > 1 ? '×' + k : ''}</em></i>`);
      if (out.length >= 5) break;
    }
    return out.join('');
  }

  private chip(c: number) {
    const v = this.v!;
    const b = this.b!;
    const cell = b.cells[c];
    const color = cell.group != null ? b.groups[cell.group].color : '#2a3a6a';
    const hs = v.houses[c];
    return `<button class="mg-pchip${v.mort[c] ? ' mort' : ''}" data-cell="${c}" style="--g:${color}">${esc(cell.name)}${hs ? `<small>${hs === 4 ? '🏭' : '▪'.repeat(hs)}</small>` : ''}</button>`;
  }

  private showCard(deck: number, id: number) {
    const b = this.b!;
    const d = b.decks[deck];
    const card = d.cards[id];
    this.cardEl.hidden = false;
    this.cardEl.dataset.map = b.id;
    this.cardEl.innerHTML = `<div class="mg-cardin" style="${d.face ? `background-image:url(${d.face})` : ''}">
        <div class="mg-cardt">${esc(d.name)}</div><div class="mg-cardx">${esc(card.text)}</div></div>`;
  }

  private say(text: string) {
    const el = h(`<div class="mg-say">${esc(text)}</div>`);
    this.float.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  /** Всплывающая сумма у пуговицы игрока. */
  private money(who: number | null | 'pot', n: number) {
    if (typeof who !== 'number') return;
    const tok = this.tokens.get(who);
    if (!tok) return;
    const el = h(`<div class="mg-delta ${n > 0 ? 'plus' : 'minus'}" style="left:${tok.style.left};top:${tok.style.top}">${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}</div>`);
    this.float.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  // ---------- решения в центре поля ----------

  private send(a: Action, seat?: number) {
    const v = this.v;
    if (!v || this.busy) return;
    const s = seat ?? (v.phase === 'auction' ? v.auction!.order[v.auction!.at] : v.phase === 'offer' ? v.offer!.to : v.turn);
    if (!this.interactive.includes(s)) return;
    Sound.unlock();
    this.closePop();
    this.deal = null;
    this.ctx.act(s, a);
  }

  private propHtml(c: number) {
    const b = this.b!;
    const v = this.v!;
    const cell = b.cells[c];
    const o = v.owner[c];
    const owner = o == null ? 'ничья' : o < 0 ? 'банк (жетон «Б»)' : strip(this.ctx.name(o));
    if (b.id === 'kosmos') {
      return `<div class="mg-deed kos"><div class="mg-dh">${esc(cell.name)}<b>${fmt(cell.price!)}</b></div>
        <div class="mg-db"><div>рента: <b>${fmt(cell.rents![0])}</b></div>${o === -1 ? `<div>выкуп у банка: ${fmt(cell.price! + 100)}</div>` : ''}
        <div class="mg-own">владелец: ${esc(owner)}</div></div></div>`;
    }
    const g = b.groups[cell.group!];
    if (b.id === 'biznes') {
      const rowsB = ['поле', 'монополия', '1 филиал', '2 филиала', '3 филиала', 'предприятие'];
      const own = o != null && o >= 0;
      const lvB = own ? (v.houses[c] === 0 ? (fullGroup(v, c) ? 1 : 0) : v.houses[c] + 1) : -1;
      return `<div class="mg-deed"><div class="mg-dh" style="--g:${g.color}">${esc(cell.full ?? cell.name)}<b>${fmt(cell.price!)}</b></div>
        <div class="mg-db"><div class="mg-dt">плата владельцу:</div>
        ${cell.rents!.map((r, i) => `<div class="mg-dr${i === lvB ? ' on' : ''}"><span>${rowsB[i]}</span><b>${fmt(r)}</b></div>`).join('')}
        <div class="mg-dn">цена: филиал — <b>${fmt(cell.build!)} р.</b>, валютное предприятие (после трёх филиалов) — <b>${dollars(cell.buildUsd!)}</b></div>
        <div class="mg-dn">${esc(g.name)}</div>
        <div class="mg-own">владелец: ${esc(owner)}${v.mort[c] ? ' · <b>заложен</b>' : ''}${own && !v.mort[c] ? ` · сейчас ${fmt(rent(v, c))}` : ''}</div></div></div>`;
    }
    const rows = ['пустой участок', '1 филиал', '2 филиала', '3 филиала', 'предприятие'];
    const lv = o != null && o >= 0 ? v.houses[c] : -1;
    const cur = o != null && o >= 0 ? rent(v, c) : 0;
    return `<div class="mg-deed"><div class="mg-dh" style="--g:${g.color}">${esc(cell.full ?? cell.name)}<b>${fmt(cell.price!)}</b></div>
      <div class="mg-db"><div class="mg-dt">плата за наём:</div>
      ${cell.rents!.map((r, i) => `<div class="mg-dr${i === lv ? ' on' : ''}"><span>${rows[i]}</span><b>${fmt(r)}</b></div>`).join('')}
      <div class="mg-dn">Если играющий владеет всеми участками одного цвета, плата за наём (за пустой участок) удваивается</div>
      <div class="mg-dr"><span>филиал / предприятие</span><b>${fmt(cell.build!)}</b></div>
      <div class="mg-own">владелец: ${esc(owner)}${v.mort[c] ? ' · <b>заложен</b>' : ''}${o != null && o >= 0 && !v.mort[c] ? ` · сейчас ${fmt(cur)}` : ''}</div></div></div>`;
  }

  private openCard(c: number) {
    const v = this.v;
    const b = this.b;
    if (!v || !b || b.cells[c].kind !== 'prop') return;
    this.popCell = c;
    this.deal = null;
    const op = this.opSeat();
    const btns: string[] = [];
    const cell = b.cells[c];
    if (op != null && v.owner[c] === op) {
      const biz = b.id === 'biznes';
      const cost = biz && v.houses[c] === 3 ? dollars(cell.buildUsd!) : fmt(cell.build!);
      const back = biz && v.houses[c] === 4 ? dollars(cell.buildUsd! / 2) : fmt(cell.build! / 2);
      if (canBuild(v, op, c) && v.phase !== 'debt') btns.push(`<button class="btn primary" data-a="build">${v.houses[c] === 3 ? 'Предприятие' : 'Филиал'} — ${cost}</button>`);
      if (canSell(v, op, c)) btns.push(`<button class="btn" data-a="sell">Продать постройку +${back}</button>`);
      if (canMortgage(v, op, c)) btns.push(`<button class="btn" data-a="mortgage">Заложить +${fmt(cell.price! / 2)}</button>`);
      if (canRedeem(v, op, c) && v.phase !== 'debt') btns.push(`<button class="btn" data-a="redeem">Выкупить −${fmt(redeemCost(v, c))}</button>`);
      if (b.id === 'kosmos' && v.phase !== 'debt') btns.push(`<button class="btn" data-a="sellBank">Продать банку +${fmt(cell.price!)}</button>`);
    } else if (op != null && v.phase === 'roll' && v.owner[c] != null && v.owner[c]! >= 0 && v.offers < 3 && tradeable(v, v.owner[c]!, c)) {
      btns.push(`<button class="btn" data-a="deal">Предложить сделку</button>`);
    }
    this.pop.hidden = false;
    this.pop.innerHTML = `<div class="mg-popin">${this.propHtml(c)}<div class="mg-btns">${btns.join('')}<button class="btn ghost" data-close>Закрыть</button></div></div>`;
    this.pop.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((el) => {
      el.onclick = () => {
        const a = el.dataset.a!;
        if (a === 'deal') {
          this.openDeal(v.owner[c]!, c);
          return;
        }
        this.send({ type: a, cell: c } as Action, op!);
      };
    });
  }

  private closePop() {
    this.popCell = null;
    this.pop.hidden = true;
    this.pop.textContent = '';
  }

  private renderPrompt() {
    const v = this.v!;
    const b = this.b!;
    const p = this.prompt;
    if (v.result || this.ctx.demo) {
      p.innerHTML = v.result ? `<div class="mg-q big">🏆 ${v.result.winners.map((s) => this.ctx.name(s)).join(', ')}</div>` : '';
      return;
    }
    const seat = v.phase === 'auction' && v.auction ? v.auction.order[v.auction.at] : v.phase === 'offer' && v.offer ? v.offer.to : v.turn;
    const me = this.interactive.includes(seat);
    const nm = this.ctx.name(seat);
    const c = v.pos[v.turn];
    const cell = b.cells[c];
    let html = '';
    switch (v.phase) {
      case 'roll':
        if (me && v.jail[seat]) {
          html = `<div class="mg-q">На бирже, попытка ${v.jail[seat]} из 3</div><div class="mg-btns">
            <button class="btn" data-a="payJail" ${v.cash[seat] < 500 ? 'disabled' : ''}>Заплатить 500</button>
            ${v.freeCards[seat].length ? '<button class="btn" data-a="useCard">Сдать карточку</button>' : ''}</div>`;
        }
        break;
      case 'buy': {
        const can = v.cash[seat] >= cell.price!;
        html = me
          ? `${this.propHtml(c)}<div class="mg-btns"><button class="btn primary" data-a="buy" ${can ? '' : 'disabled'}>Купить за ${fmt(cell.price!)}</button>
              <button class="btn" data-a="pass">${b.id === 'kosmos' ? 'Не покупать — на торги' : 'Отказаться — на торги'}</button></div>
              ${can ? '' : `<div class="mg-hint">Не хватает денег${b.id !== 'kosmos' ? ' — можно заложить участок или продать постройку (нажмите на свой участок)' : ' — можно продать планету банку'}</div>`}`
          : `<div class="mg-q">${nm}: ${esc(cell.full ?? cell.name)} — покупать?</div>`;
        break;
      }
      case 'auction': {
        const a = v.auction!;
        const ac = b.cells[a.cell];
        const lead = a.leader != null ? `${this.ctx.name(a.leader)} — <b>${fmt(a.bid)}</b>` : 'ставок нет';
        if (me) {
          const min = a.bid ? a.bid + b.step : b.step;
          const steps = [...new Set([min, Math.max(min, a.bid + b.step * 2), Math.max(min, a.bid + b.step * 10), a.bid ? 0 : Math.round(ac.price! / 2 / b.step) * b.step].filter((x) => x >= min))].sort((x, y) => x - y);
          html = `${this.propHtml(a.cell)}<div class="mg-q">Торги: ${lead}</div><div class="mg-btns">
            ${steps.map((n) => `<button class="btn primary" data-bid="${n}" ${n > v.cash[seat] ? 'disabled' : ''}>${fmt(n)}</button>`).join('')}
            <button class="btn" data-a="fold">Пас</button></div>`;
        } else html = `<div class="mg-q">Торги: ${esc(ac.full ?? ac.name)}<br>${lead} · ходит ${nm}</div>`;
        break;
      }
      case 'offer': {
        const o = v.offer!;
        const list = (cs: number[]) => (cs.length ? cs.map((x) => this.chip(x)).join('') : '—');
        const cashTxt = o.cash > 0 ? `${this.ctx.name(o.from)} доплачивает ${fmt(o.cash)}` : o.cash < 0 ? `${this.ctx.name(o.to)} доплачивает ${fmt(-o.cash)}` : '';
        const cardsTxt = o.cards ? `карточка освобождения: ${o.cards > 0 ? 'от ' + this.ctx.name(o.from) : 'от ' + this.ctx.name(o.to)}` : '';
        html = `<div class="mg-q">${this.ctx.name(o.from)} → ${this.ctx.name(o.to)}: сделка</div>
          <div class="mg-offer"><div><small>отдаёт ${this.ctx.name(o.from)}</small>${list(o.give)}</div><div><small>просит</small>${list(o.get)}</div></div>
          ${cashTxt ? `<div class="mg-q">${cashTxt}</div>` : ''}${cardsTxt ? `<div class="mg-q">${cardsTxt}</div>` : ''}
          ${me ? '<div class="mg-btns"><button class="btn primary" data-a="accept">Принять</button><button class="btn" data-a="reject">Отказаться</button></div>' : ''}`;
        break;
      }
      case 'debt': {
        const d = v.debt!;
        if (me) {
          const acts = owned(v, seat).flatMap((x) => {
            const out: string[] = [];
            if (canSell(v, seat, x)) out.push(`<button class="btn" data-op="sell" data-c="${x}">${esc(b.cells[x].name)}: продать постройку +${fmt(b.cells[x].build! / 2)}</button>`);
            if (canMortgage(v, seat, x)) out.push(`<button class="btn" data-op="mortgage" data-c="${x}">${esc(b.cells[x].name)}: заложить +${fmt(b.cells[x].price! / 2)}</button>`);
            return out;
          });
          if (b.id === 'biznes' && v.usd[seat] >= 50) {
            const need = Math.min(v.usd[seat] - (v.usd[seat] % 50), Math.ceil((d.amount - v.cash[seat]) / RATE / 50) * 50);
            acts.unshift(`<button class="btn" data-x="${-need}">продать ${dollars(need)} +${fmt(need * RATE)}</button>`);
          }
          html = `<div class="mg-q">Нужно заплатить <b>${fmt(d.amount)}</b>, есть ${fmt(v.cash[seat])}</div>
            <div class="mg-btns col">${acts.join('')}</div>
            <div class="mg-btns"><button class="btn danger" data-a="bankrupt">Объявить банкротство</button></div>`;
        } else html = `<div class="mg-q">${nm} должен ${fmt(d.amount)} — ищет деньги</div>`;
        break;
      }
      case 'insure':
        if (b.id === 'biznes') {
          html = me
            ? `<div class="mg-q">Вы прошли «Страховое общество». Страховка отменяет один убыток по «Шансу».</div><div class="mg-btns">
              <button class="btn primary" data-ins="1" ${v.cash[seat] < INSURE ? 'disabled' : ''}>Застраховаться — ${fmt(INSURE)}</button>
              <button class="btn" data-ins="0">Не надо</button></div>`
            : `<div class="mg-q">${nm} думает о страховке</div>`;
          break;
        }
        html = me
          ? `<div class="mg-q">Страховое агентство. Страховка — до следующего агентства: от полиции, чёрной дыры и пиратов.</div><div class="mg-btns col">
              <button class="btn primary" data-ins="2" ${v.cash[seat] < 250 ? 'disabled' : ''}>Полностью — 250</button>
              <button class="btn" data-ins="1" ${v.cash[seat] < 100 ? 'disabled' : ''}>Наполовину — 100</button>
              <button class="btn" data-ins="0">Без страховки</button></div>`
          : `<div class="mg-q">${nm} в страховом агентстве</div>`;
        break;
      case 'casino':
      case 'casino2':
        html = `<div class="mg-casino">${(v.phase === 'casino' ? CASINO.slice(0, 6) : CASINO.slice(6))
          .map((n, i) => `<span class="${n > 0 ? 'plus' : 'minus'}">${v.phase === 'casino' ? i + 1 : i + 7}: ${n > 0 ? '+' : '−'}${Math.abs(n)}${v.phase === 'casino' && CASINO_STAR[i] ? '★' : ''}</span>`)
          .join('')}</div>${
          me
            ? `<div class="mg-btns"><button class="btn primary" data-a="spin" data-tap>${v.phase === 'casino' ? 'Бросить кубик' : 'Ещё бросок (7–12)'}</button>${v.phase === 'casino2' ? '<button class="btn" data-a="pass">Хватит</button>' : ''}</div>`
            : `<div class="mg-q">${nm} играет в казино</div>`
        }`;
        break;
      case 'exchange': {
        if (!me) {
          html = `<div class="mg-q">${nm} на валютной бирже</div>`;
          break;
        }
        const buy = [100, 500, 1000, 5000].filter((n) => n * RATE <= v.cash[seat]);
        const sell = [100, 1000, v.usd[seat] - (v.usd[seat] % 50)].filter((n, i, a) => n >= 50 && n <= v.usd[seat] && a.indexOf(n) === i);
        html = `<div class="mg-q">Валютная биржа: ${RATE} р. за 1 $<br>у вас ${fmt(v.cash[seat])} р. и ${dollars(v.usd[seat])}</div>
          <div class="mg-btns">${buy.map((n) => `<button class="btn" data-x="${n}">купить ${dollars(n)}</button>`).join('')}</div>
          ${sell.length ? `<div class="mg-btns">${sell.map((n) => `<button class="btn" data-x="${-n}">продать ${dollars(n)}</button>`).join('')}</div>` : ''}
          <div class="mg-btns"><button class="btn primary" data-a="pass">Готово</button></div>`;
        break;
      }
      case 'bankBuy':
        html = me
          ? `${this.propHtml(c)}<div class="mg-btns"><button class="btn primary" data-a="buy" ${v.cash[seat] < cell.price! + 100 ? 'disabled' : ''}>Выкупить за ${fmt(cell.price! + 100)}</button><button class="btn" data-a="pass">Не надо</button></div>`
          : `<div class="mg-q">${nm}: выкупать ли планету у банка?</div>`;
        break;
    }
    if (b.id === 'kosmos' && v.pot > 0 && !html) html = `<div class="mg-q small">Золото Амазонок: ${fmt(v.pot)}</div>`;
    p.innerHTML = html;
    p.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((el) => (el.onclick = () => this.send({ type: el.dataset.a } as Action, seat)));
    p.querySelectorAll<HTMLButtonElement>('[data-bid]').forEach((el) => (el.onclick = () => this.send({ type: 'bid', amount: Number(el.dataset.bid) }, seat)));
    p.querySelectorAll<HTMLButtonElement>('[data-ins]').forEach((el) => (el.onclick = () => this.send({ type: 'insure', level: Number(el.dataset.ins) }, seat)));
    p.querySelectorAll<HTMLButtonElement>('[data-x]').forEach((el) => (el.onclick = () => this.send({ type: 'exchange', usd: Number(el.dataset.x) }, seat)));
    p.querySelectorAll<HTMLButtonElement>('[data-op]').forEach((el) => (el.onclick = () => this.send({ type: el.dataset.op, cell: Number(el.dataset.c) } as Action, seat)));
  }

  // ---------- сделка ----------

  private openDeal(to: number | null, cell?: number) {
    const v = this.v;
    const op = this.opSeat();
    if (!v || op == null) return;
    const others = alive(v).filter((s) => s !== op);
    if (!others.length) return;
    const t = to ?? others[0];
    this.popCell = null;
    this.deal = { to: t, give: new Set(), get: new Set(cell != null ? [cell] : []), cash: 0, cards: 0 };
    this.renderDeal();
  }

  private renderDeal() {
    const v = this.v!;
    const b = this.b!;
    const d = this.deal!;
    const op = this.opSeat();
    if (op == null) {
      this.deal = null;
      this.closePop();
      return;
    }
    const others = alive(v).filter((s) => s !== op);
    if (!others.includes(d.to)) d.to = others[0];
    const mineT = owned(v, op).filter((c) => tradeable(v, op, c));
    const theirT = owned(v, d.to).filter((c) => tradeable(v, d.to, c));
    const sel = (cs: number[], set: Set<number>, side: string) =>
      cs.length ? cs.map((c) => this.chip(c).replace('<button class="mg-pchip', `<button data-side="${side}" class="mg-pchip${set.has(c) ? ' sel' : ''}`)).join('') : '<span class="mg-empty">нечего</span>';
    const ok =
      (d.give.size || d.get.size) &&
      d.cash <= v.cash[op] &&
      -d.cash <= v.cash[d.to] &&
      !(d.give.size === 0 && d.cash <= 0 && d.cards <= 0) &&
      !(d.get.size === 0 && d.cash >= 0 && d.cards >= 0);
    this.pop.hidden = false;
    this.pop.innerHTML = `<div class="mg-popin deal">
      <div class="mg-q">Сделка с: ${others.map((s) => `<button class="mg-who${s === d.to ? ' sel' : ''}" data-to="${s}">${this.ctx.name(s)}</button>`).join('')}</div>
      <div class="mg-offer"><div><small>отдаю</small>${sel(mineT, d.give, 'give')}</div><div><small>прошу</small>${sel(theirT, d.get, 'get')}</div></div>
      <div class="mg-q">${d.cash >= 0 ? 'доплачиваю я' : 'доплачивает он'}: <b>${fmt(Math.abs(d.cash))} ${b.cur}</b>
        <span class="mg-step"><button class="btn" data-cash="-${b.step * 10}">−${fmt(b.step * 10)}</button><button class="btn" data-cash="-${b.step}">−${fmt(b.step)}</button><button class="btn" data-cash="${b.step}">+${fmt(b.step)}</button><button class="btn" data-cash="${b.step * 10}">+${fmt(b.step * 10)}</button></span></div>
      ${v.freeCards[op].length || v.freeCards[d.to].length ? `<div class="mg-q">карточка освобождения от биржи: <button class="mg-who${d.cards > 0 ? ' sel' : ''}" data-cards="1" ${v.freeCards[op].length ? '' : 'disabled'}>отдаю</button><button class="mg-who${d.cards < 0 ? ' sel' : ''}" data-cards="-1" ${v.freeCards[d.to].length ? '' : 'disabled'}>прошу</button></div>` : ''}
      <div class="mg-btns"><button class="btn primary" data-send ${ok ? '' : 'disabled'}>Предложить</button><button class="btn ghost" data-close>Отмена</button></div></div>`;
    this.pop.querySelectorAll<HTMLElement>('[data-to]').forEach((el) => (el.onclick = () => {
      d.to = Number(el.dataset.to);
      d.get.clear();
      d.cards = Math.max(0, d.cards);
      this.renderDeal();
    }));
    this.pop.querySelectorAll<HTMLElement>('[data-side]').forEach((el) => (el.onclick = (e) => {
      e.stopPropagation();
      const c = Number(el.dataset.cell);
      const set = el.dataset.side === 'give' ? d.give : d.get;
      if (set.has(c)) set.delete(c);
      else set.add(c);
      this.renderDeal();
    }));
    this.pop.querySelectorAll<HTMLElement>('[data-cash]').forEach((el) => (el.onclick = () => {
      d.cash = Math.max(-v.cash[d.to], Math.min(v.cash[op], d.cash + Number(el.dataset.cash)));
      this.renderDeal();
    }));
    this.pop.querySelectorAll<HTMLElement>('[data-cards]').forEach((el) => (el.onclick = () => {
      const k = Number(el.dataset.cards);
      d.cards = d.cards === k ? 0 : k;
      this.renderDeal();
    }));
    const sendBtn = this.pop.querySelector('[data-send]') as HTMLButtonElement;
    sendBtn.onclick = () => this.send({ type: 'offer', to: d.to, give: [...d.give], get: [...d.get], cash: d.cash, cards: d.cards }, op);
  }
}

export function createView(): GameView<State, Ev> {
  return new ManagerView();
}

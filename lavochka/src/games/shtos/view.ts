/* Штос — отрисовка: ломберное сукно, вверху колода банкомёта и две кучки — налево (понтёрам) и направо (банку);
 * посередине «лейаут» — по карте каждого достоинства, на них фишки понтёров и счёты «сколько осталось»; сидящие — внизу.
 * Кнопки: банк, ставка (карта нажатием на лейаут, сумма, медью), угол/пе/снять, «Мечите!», «Метать». */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { cardHTML, preloadDeck, deckStyle } from '../../cards/render';
import { CardStage, type Point, type StageItem } from '../../cards/stage';
import type { Card } from '../../cards/deck';
import { bankChoices, canParoli, canPaix, canStake, LEVEL_NAME, MAX_BETS, MIN_BET, pending, ranksOf, room, stakeRange, type Event, type View } from './engine';
import { onRank, rk, SEATS } from './def';
import './shtos.css';

class ShtosView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private btns!: HTMLElement;
  private v: View | null = null;
  private actSeat: number | null = null;
  private rank: number | null = null;
  private amount = 50;
  private copper = false;
  /** Только что сыгравшие ставки: подсветка на лейауте. */
  private flash = new Map<string, 'win' | 'lose' | 'plie'>();

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(deckStyle());
    this.cs = new CardStage(
      root,
      1000,
      720,
      'sh-wrap',
      '<div class="sh-cloth"></div>',
      { portrait: { W: 540, H: 900 } }
    );
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="sh-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.sh-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.plates.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-rank]') as HTMLElement | null;
      if (!el || this.actSeat == null || this.v?.phase !== 'stake') return;
      Sound.unlock();
      Sound.ui();
      this.rank = Number(el.dataset.rank);
      this.draw();
      this.renderButtons();
    });
    if (ctx.demo) return;
    const ctl = h('<div class="sh-controls"><div class="sh-btns"></div></div>');
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.sh-btns') as HTMLElement;
  }

  // ---------------------------------------------------------------- места

  private get port() {
    return this.cs.portrait;
  }

  private get deckPt(): Point {
    return this.port ? { x: 270, y: 120 } : { x: 500, y: 120 };
  }

  private pilePt(side: 'L' | 'R'): Point {
    if (this.port) return { x: side === 'L' ? 120 : 420, y: 130 };
    return { x: side === 'L' ? 330 : 670, y: 120 };
  }

  private sidePt(which: 'soda' | 'hock'): Point {
    if (this.port) return { x: which === 'soda' ? 50 : 490, y: 232 };
    return { x: which === 'soda' ? 120 : 880, y: 120 };
  }

  /** Место карты лейаута. */
  private layPt(v: View, i: number): Point {
    const n = ranksOf(v.cfg).length;
    if (this.port) {
      const perRow = Math.ceil(n / 2);
      const row = i < perRow ? 0 : 1;
      const k = row ? i - perRow : i;
      const inRow = row ? n - perRow : perRow;
      const step = 74;
      return { x: 270 + (k - (inRow - 1) / 2) * step, y: 350 + row * 160 };
    }
    const step = n > 9 ? 72 : 96;
    return { x: 500 + (i - (n - 1) / 2) * step, y: 330 };
  }

  private seatPt(v: View, seat: number): Point {
    const list = v.seats;
    const n = list.length;
    const k = list.indexOf(seat);
    if (this.port) {
      const cols = n <= 4 ? 2 : 3;
      const row = Math.floor(k / cols);
      const inRow = row === Math.floor((n - 1) / cols) ? n - row * cols : cols;
      const j = k - row * cols;
      const span = inRow === 2 ? 250 : 340;
      return { x: inRow === 1 ? 270 : 270 - span / 2 + (span * j) / (inRow - 1), y: 680 + row * 64 };
    }
    const t = n === 1 ? 0.5 : k / (n - 1);
    const span = Math.min(820, 200 * (n - 1));
    return { x: 500 - span / 2 + span * t, y: 610 - Math.pow(2 * t - 1, 2) * (n > 2 ? 50 : 10) };
  }

  private layout(v: View): StageItem[] {
    const items: StageItem[] = [];
    const s = this.port ? 0.62 : 0.72;
    const pile = (cards: Card[], side: 'L' | 'R') => {
      const p = this.pilePt(side);
      const from = Math.max(0, cards.length - 4);
      for (let i = from; i < cards.length; i++) {
        const k = i - from;
        items.push({ key: `${side}:${i}`, card: cards[i], x: p.x + k * 3 - (side === 'L' ? 12 : -12) * (k % 2), y: p.y + k * 2, r: ((i * 37) % 9) - 4, s, z: 10 + i, fromPt: this.deckPt });
      }
    };
    pile(v.left, 'L');
    pile(v.right, 'R');
    const d = this.deckPt;
    const stack = Math.min(5, Math.ceil(v.deckLeft / 8));
    for (let k = 0; k < stack; k++) items.push({ key: `deck:${k}`, card: null, x: d.x - k * 1.5, y: d.y - k * 2.5, r: 0, s, z: 2 + k });
    if (v.soda) items.push({ key: 'soda', card: v.soda, x: this.sidePt('soda').x, y: this.sidePt('soda').y, r: -90, s: s * 0.7, z: 5, fromPt: d });
    if (v.hock) items.push({ key: 'hock', card: v.hock, x: this.sidePt('hock').x, y: this.sidePt('hock').y, r: 90, s: s * 0.7, z: 5, fromPt: d });
    return items;
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed(), null, this.deckPt);
    const st = deckStyle();
    const pick = this.actSeat != null && v.phase === 'stake';
    let html = '';
    // подписи кучек, соды и хока
    for (const side of ['L', 'R'] as const) {
      const p = this.pilePt(side);
      const n = side === 'L' ? v.left.length : v.right.length;
      html += `<div class="sh-chalk" style="left:${p.x}px;top:${p.y + (this.port ? 62 : 68)}px">${side === 'L' ? 'налево · понтёрам' : 'направо · банку'}${n ? ` · ${n}` : ''}</div>`;
    }
    if (v.soda) html += `<div class="sh-tag" style="left:${this.sidePt('soda').x}px;top:${this.sidePt('soda').y + (this.port ? 30 : 42)}px">сода</div>`;
    if (v.hock) html += `<div class="sh-tag" style="left:${this.sidePt('hock').x}px;top:${this.sidePt('hock').y + (this.port ? 30 : 42)}px">хок</div>`;
    // лейаут
    ranksOf(v.cfg).forEach((r, i) => {
      const p = this.layPt(v, i);
      const rest = v.rest[r] ?? 0;
      const bets = v.bets.filter((b) => b.rank === r);
      const chips = bets
        .map((b) => {
          const f = this.flash.get(`${b.seat}:${r}`);
          return `<span class="sh-chip${b.win ? ' won' : ''}${b.copper ? ' cu' : ''}${f ? ' ' + f : ''}" style="--c:${SEATS[b.seat].color}" title="${esc(this.plain(b.seat))}">${b.amt}${b.level ? `<i>${'◣'.repeat(b.level)}</i>` : ''}${b.win ? `<em>+${b.win}</em>` : ''}</span>`;
        })
        .join('');
      const beads = Array.from({ length: 4 }, (_, k) => `<i class="${k < rest ? 'on' : ''}"></i>`).join('');
      const sel = pick && this.rank === r;
      html += `<div class="sh-rank${rest ? '' : ' dead'}${pick && rest ? ' pick' : ''}${sel ? ' sel' : ''}" data-rank="${r}" style="left:${p.x}px;top:${p.y}px">${cardHTML({ s: 'S', r }, st, 'card sh-lay')}<div class="sh-beads">${beads}</div><div class="sh-chips">${chips}</div></div>`;
    });
    // банк и талья
    const bp = this.port ? { x: 270, y: 20 } : { x: 500, y: 226 };
    if (v.banker != null) html += `<div class="sh-bank" style="left:${bp.x}px;top:${bp.y}px"><span class="sh-coin"></span>Банк <b>${v.bank}</b> · мечет ${esc(this.plain(v.banker))}</div>`;
    html += `<div class="sh-talia" style="left:${this.port ? 14 : 24}px;top:${this.port ? 852 : 24}px">Талья ${v.talia} из ${v.talias}<small>в колоде ${v.deckLeft}</small></div>`;
    for (const seat of v.seats) {
      const p = this.seatPt(v, seat);
      const on = v.turn === seat;
      const role = v.banker === seat ? '🂠 ' : '';
      const out = v.out.includes(seat) ? ' <em>пас</em>' : '';
      html += `<div class="cs-plate sh-plate${on ? ' on' : ''}${v.money[seat] < MIN_BET && v.banker !== seat ? ' sh-broke' : ''}" style="--c:${SEATS[seat].color};left:${p.x}px;top:${p.y}px">${role}${esc(this.plain(seat))} <b>${v.money[seat]}</b>${out}</div>`;
    }
    this.plates.innerHTML = html;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private send(a: unknown) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.actSeat = null;
    this.rank = null;
    this.btns.innerHTML = '';
    this.ctx.act(seat, a);
  }

  private button(text: string, cls: string, on: () => void, into: HTMLElement = this.btns, disabled = false) {
    const b = h<HTMLButtonElement>(`<button class="btn ${cls}"${disabled ? ' disabled' : ''}>${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    into.appendChild(b);
    return b;
  }

  private renderButtons() {
    if (!this.btns) return;
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null) return;
    if (v.phase === 'bank') {
      this.btns.appendChild(h('<div class="sh-ask">Ваш банк. Сколько кладёте на стол?</div>'));
      for (const n of bankChoices(v, seat)) this.button(`Банк ${n}`, n === 300 ? 'primary' : '', () => this.send({ type: 'bank', n }));
      return;
    }
    if (v.phase === 'deal') {
      const b = this.button(v.left.length ? 'Метать дальше' : 'Метать', 'primary', () => this.send({ type: 'deal' }));
      b.setAttribute('data-tap', '');
      return;
    }
    if (v.phase !== 'stake') return;
    const won = pending(v, seat);
    if (won.length) {
      for (const b of won) {
        this.btns.appendChild(h(`<div class="sh-ask">Выиграла ставка на ${onRank(b.rank)}: +${b.win} к кушу ${b.amt}.</div>`));
        const row = h('<div class="sh-row"></div>');
        if (v.cfg.corners) {
          const next = LEVEL_NAME[b.level + 1] ?? '';
          this.button(`Загнуть угол<small>${next}: на карте ${b.amt + b.win}</small>`, 'primary', () => this.send({ type: 'paroli', rank: b.rank }), row, !canParoli(v, b));
        }
        this.button(`Пе<small>${b.win} в карман, куш стоит</small>`, '', () => this.send({ type: 'paix', rank: b.rank }), row, !canPaix(v, b));
        this.button(`Снять<small>забрать ${b.amt + b.win}</small>`, v.cfg.corners ? '' : 'primary', () => this.send({ type: 'take', rank: b.rank }), row);
        this.btns.appendChild(row);
      }
      return;
    }
    const mine = v.bets.filter((b) => b.seat === seat);
    const [lo, hi] = stakeRange(v, seat);
    const free = ranksOf(v.cfg).filter((r) => (v.rest[r] ?? 0) > 0 && !mine.some((b) => b.rank === r));
    const can = mine.length < MAX_BETS && hi >= lo && free.length > 0;
    if (can) {
      if (this.rank == null || !free.includes(this.rank)) this.rank = null;
      this.amount = Math.max(lo, Math.min(hi, this.amount));
      this.btns.appendChild(h(`<div class="sh-ask">${this.rank == null ? 'Выберите карту на сукне' : `Куш на ${onRank(this.rank)}`} · против банка можно ещё ${room(v)}</div>`));
      const amt = h('<div class="sh-row sh-amount"></div>');
      const set = (n: number) => {
        this.amount = Math.max(lo, Math.min(hi, n));
        Sound.ui();
        this.renderButtons();
      };
      this.button('−', 'sh-q', () => set(this.amount - (this.amount > 100 ? 50 : 10)), amt);
      amt.appendChild(h(`<div class="sh-n"><span class="sh-coin"></span>${this.amount}</div>`));
      this.button('+', 'sh-q', () => set(this.amount + (this.amount >= 100 ? 50 : 10)), amt);
      for (const q of [10, 50, 100]) if (q <= hi) this.button(String(q), 'sh-q', () => set(q), amt);
      this.button(hi === room(v) ? 'Ва-банк' : 'Всё', 'sh-q', () => set(hi), amt);
      if (v.cfg.copper)
        this.button(`Медью${this.copper ? ' ✓' : ''}`, `sh-q${this.copper ? ' on' : ''}`, () => {
          this.copper = !this.copper;
          Sound.ui();
          this.renderButtons();
        }, amt);
      this.btns.appendChild(amt);
      const r = this.rank;
      this.button(r == null ? 'Поставить' : `Поставить ${this.amount} на ${onRank(r)}${this.copper ? ' медью' : ''}`, 'primary', () => {
        if (r != null) this.send({ type: 'stake', rank: r, n: this.amount, copper: this.copper });
      }, this.btns, r == null || !canStake(v, seat, r, this.amount, this.copper));
    } else if (!mine.length) this.btns.appendChild(h('<div class="sh-ask">Ставить сейчас нечем.</div>'));
    this.button(mine.length ? 'Мечите!' : 'Пас', mine.length ? '' : '', () => this.send({ type: 'done' }));
    if (!mine.length) this.button('Пас до конца тальи', '', () => this.send({ type: 'sitout' }));
  }

  // ---------------------------------------------------------------- события

  async play(events: Event[], v: View) {
    this.actSeat = null;
    if (this.btns) this.btns.innerHTML = '';
    const speed = this.ctx.speed();
    for (const ev of events) {
      const cur = this.v!;
      if (ev.type === 'talia') {
        this.flash.clear();
        this.v = { ...cur, right: [], left: [], soda: null, hock: null, bets: [], out: [], banker: ev.banker, bank: 0, talia: ev.talia, deckLeft: cur.cfg.deck, rest: cur.rest.map(() => 4) };
        this.draw();
        Sound.shuffle();
        await this.banner_(`Талья ${ev.talia}: мечет ${this.plain(ev.banker)}`, 1000);
      } else if (ev.type === 'bank') {
        this.v = { ...cur, bank: ev.n, bankStart: ev.n, money: cur.money.map((m, i) => (i === ev.seat ? m - ev.n : m)) };
        this.draw();
        Sound.place();
        await sleep(300 / speed);
      } else if (ev.type === 'soda') {
        this.v = { ...cur, soda: ev.card, deckLeft: cur.deckLeft - 1 };
        this.draw();
        Sound.card();
        await sleep(450 / speed);
      } else if (ev.type === 'stake') {
        this.v = { ...cur, bets: [...cur.bets, { seat: ev.seat, rank: ev.rank, amt: ev.n, win: 0, level: 0, copper: ev.copper }], money: cur.money.map((m, i) => (i === ev.seat ? m - ev.n : m)) };
        this.draw();
        Sound.place();
        await sleep(220 / speed);
      } else if (ev.type === 'decide') {
        if (ev.how === 'paroli') await this.banner_(`${this.plain(ev.seat)}: угол! ${LEVEL_NAME[ev.level][0].toUpperCase() + LEVEL_NAME[ev.level].slice(1)}`, 700);
        else if (ev.how === 'paix') await this.banner_(`${this.plain(ev.seat)}: «Пе!»`, 500);
      } else if (ev.type === 'pair') {
        this.flash.clear();
        this.v = { ...cur, right: [...cur.right, ev.right], deckLeft: cur.deckLeft - 1 };
        this.draw();
        Sound.card();
        await sleep(380 / speed);
        this.v = { ...this.v, left: [...cur.left, ev.left], deckLeft: cur.deckLeft - 2 };
        for (const r of ev.res) this.flash.set(`${r.seat}:${r.rank}`, r.outcome);
        this.draw();
        Sound.card();
        await sleep(380 / speed);
        if (ev.res.length) {
          const mine = ev.res.filter((r) => this.ctx.mySeats.includes(r.seat));
          const any = mine.length ? mine : ev.res;
          if (any.some((r) => r.outcome === 'win')) Sound.win();
          else Sound.step();
          const plie = ev.right.r === ev.left.r;
          const text = plie ? `Плие! ${rk(ev.right.r)} и ${rk(ev.left.r)}` : any.map((r) => `${this.plain(r.seat)}: ${r.outcome === 'win' ? `+${r.amt}` : `−${r.amt}`}`).join(' · ');
          await this.banner_(text, 1000);
        }
      } else if (ev.type === 'endTalia') {
        this.v = { ...cur, hock: ev.hock };
        this.draw();
        Sound.step();
        const d = ev.bank - ev.start;
        await this.banner_(`${ev.broke ? 'Банк сорван!' : 'Талья вышла'} · ${this.plain(ev.banker)} ${d >= 0 ? '+' : ''}${d}`, 1500);
      } else if (ev.type === 'end') {
        this.v = v;
        this.draw();
        Sound.win();
        await this.banner_(`Больше всех у ${this.plain(ev.winner)} — ${ev.money[ev.winner]}`, 0);
      }
    }
    this.v = v;
    this.draw();
  }

  private async banner_(text: string, ms: number) {
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

  setTurn(_toAct: number[], interactive: number[]) {
    const v = this.v;
    this.actSeat = v && v.turn != null && interactive.includes(v.turn) ? v.turn : null;
    this.draw();
    this.renderButtons();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    if (who == null) return 'Банкомёт тасует…';
    const what = v.phase === 'bank' ? 'кладёт банк' : v.phase === 'deal' ? 'мечет' : pending(v, who).length ? 'решает про угол' : 'ставит';
    return interactive.includes(who) ? (v.phase === 'deal' ? 'Ваш банк — мечите' : 'Ваш ход') : `${this.ctx.name(who)} ${what}…`;
  }

  playerStats(v: View, seat: number) {
    const on = v.bets.filter((b) => b.seat === seat).reduce((x, b) => x + b.amt, 0);
    return `фишки: ${v.money[seat]}${v.banker === seat ? `, банк ${v.bank}` : on ? `, на картах ${on}` : ''}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new ShtosView();
}

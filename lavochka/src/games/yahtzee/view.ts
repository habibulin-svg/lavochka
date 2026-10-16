/* Яхтзи — отрисовка: лоток с пятью кубиками (касание кубика — отложить, отложенные приподняты с меткой), под ним — тетрадная
 * таблица: графы по строкам, игроки по столбцам; в свой ход в пустых клетках своего столбца карандашом — сколько дадут
 * эти кости, касание записывает. Покер на костях — вместо таблицы победы по конам и выпавшие руки. */
import { Sound } from '../../core/audio';
import { DiceTray } from '../../core/dice';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { CAT_NAME, catsOf, HAND_NAME, options, pokerRank, total, upperSum, type Event, type State } from './engine';
import { SEATS } from './def';
import './yahtzee.css';

class YahtzeeView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private v: State | null = null;
  private wrap!: HTMLElement;
  private trays: DiceTray[] = [];
  private slots: HTMLElement[] = [];
  private sheet!: HTMLElement;
  private info!: HTMLElement;
  private rollBtn!: HTMLButtonElement;
  private standBtn!: HTMLButtonElement;
  private hint!: HTMLElement;
  private hold = [false, false, false, false, false];
  private actSeat: number | null = null;
  private holdKey = '';

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="yz-wrap"><div class="yz-table">
        <div class="yz-tray"></div>
        <div class="yz-info"></div>
        <div class="yz-sheet"></div>
      </div></div>`);
    root.appendChild(this.wrap);
    const tray = this.wrap.querySelector('.yz-tray') as HTMLElement;
    for (let i = 0; i < 5; i++) {
      const slot = h(`<div class="yz-slot" data-die="${i}"><div class="yz-die"></div><small>отложена</small></div>`);
      tray.appendChild(slot);
      this.slots.push(slot);
      this.trays.push(new DiceTray(slot.querySelector('.yz-die') as HTMLElement, 1));
    }
    // касание кубика — отложить; гасим клик, иначе стол примет его за тап по свободному месту и бросит кости
    tray.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-die]') as HTMLElement | null;
      if (!el) return;
      e.preventDefault();
      this.toggle(Number(el.dataset.die));
    });
    this.info = this.wrap.querySelector('.yz-info') as HTMLElement;
    this.sheet = this.wrap.querySelector('.yz-sheet') as HTMLElement;
    this.sheet.addEventListener('click', (e) => {
      e.preventDefault();
      const el = (e.target as HTMLElement).closest('[data-cat]') as HTMLElement | null;
      if (el && this.actSeat != null) this.send({ type: 'score', cat: el.dataset.cat });
    });
    const panel = h(`<div class="yz-panel"><button class="btn primary" data-tap>Бросить</button><button class="btn">Хватит — стоп</button><div class="yz-hint"></div></div>`);
    ctx.controls.appendChild(panel);
    [this.rollBtn, this.standBtn] = [...panel.querySelectorAll('button')] as HTMLButtonElement[];
    this.hint = panel.querySelector('.yz-hint') as HTMLElement;
    this.rollBtn.onclick = () => this.send({ type: 'roll', hold: this.hold.slice() });
    this.standBtn.onclick = () => this.send({ type: 'stand' });
  }

  private toggle(i: number) {
    const v = this.v;
    if (!v || this.actSeat == null || v.rolls === 0 || v.rolls >= 3) return;
    this.hold[i] = !this.hold[i];
    Sound.ui();
    this.drawDice();
    this.drawPanel();
  }

  private send(a: unknown) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.actSeat = null;
    this.drawPanel();
    this.ctx.act(seat, a);
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- отрисовка

  private drawDice(animate?: boolean[]) {
    const v = this.v;
    if (!v) return;
    v.dice.forEach((d, i) => {
      if (!animate?.[i]) this.trays[i].show([d]);
      const held = this.actSeat != null ? this.hold[i] : v.held[i] && v.rolls > 0 && v.rolls < 3;
      this.slots[i].classList.toggle('held', held);
      this.slots[i].classList.toggle('can', this.actSeat != null && v.rolls > 0 && v.rolls < 3);
      this.slots[i].classList.toggle('blank', v.rolls === 0);
    });
  }

  private drawInfo() {
    const v = this.v!;
    const who = esc(this.plain(v.turn));
    const r = v.rolls ? `бросок ${v.rolls} из 3` : 'ещё не бросал';
    let extra = '';
    if (v.cfg.variant === 'poker' && v.rolls) extra = ` · ${HAND_NAME[pokerRank(v.dice)[0]]}`;
    this.info.innerHTML = v.over ? 'Партия окончена' : `<span style="color:${SEATS[v.turn].ink ?? SEATS[v.turn].color}">${who}</span> — ${r}${extra}`;
  }

  private drawSheet() {
    const v = this.v!;
    const seats = v.seats;
    const head = `<tr><th></th>${seats.map((p) => `<th style="color:${SEATS[p].ink ?? SEATS[p].color}" class="${p === v.turn && !v.over ? 'cur' : ''}">${esc(this.plain(p).replace(/\s*\(.*\)\s*$/, '').slice(0, 8))}</th>`).join('')}</tr>`;
    if (v.cfg.variant === 'poker') {
      const rows = [
        `<tr><td class="lb">Побед</td>${seats.map((p) => `<td class="ink big"><i>${v.wins[p]}</i></td>`).join('')}</tr>`,
        `<tr><td class="lb">Кон ${v.pround}</td>${seats.map((p) => `<td>${v.hands[p] ? dice(v.hands[p]!) + `<small>${HAND_NAME[pokerRank(v.hands[p]!)[0]]}</small>` : p === v.turn && v.rolls ? '…' : ''}</td>`).join('')}</tr>`,
      ];
      if (v.last)
        rows.push(
          `<tr class="prev"><td class="lb">Прошлый</td>${seats
            .map((p) => {
              const hd = v.last!.hands[p];
              const win = v.last!.winners.length === 1 && v.last!.winners[0] === p;
              return `<td class="${win ? 'win' : ''}">${hd ? dice(hd) + `<small>${HAND_NAME[pokerRank(hd)[0]]}</small>` : ''}</td>`;
            })
            .join('')}</tr>`
        );
      this.sheet.innerHTML = `<div class="yz-title">${TITLE.poker}</div><table class="yz-grid poker">${head}${rows.join('')}</table><div class="yz-note">До ${v.cfg.wins} побед.</div>`;
      return;
    }
    const opts = this.actSeat != null ? options(v, this.actSeat) : [];
    // записано — рукой, чернилами (лёгкий наклон у каждой цифры свой); можно записать — карандашом
    const cell = (p: number, c: string) => {
      const val = v.sheet[p][c];
      if (val != null) return `<td class="ink${val === 0 ? ' zero' : ''}"><i style="--r:${tilt(p, c)}deg">${val === 0 ? '—' : val}</i></td>`;
      const o = p === this.actSeat ? opts.find((x) => x.cat === c) : undefined;
      return o ? `<td class="opt" data-cat="${c}"><i>${o.pts}</i></td>` : '<td></td>';
    };
    const label = (c: string) => {
      const n = /^n([1-6])$/.exec(c);
      return n ? `<td class="lb"><img src="${TEX}d${n[1]}.webp" alt="">${CAT_NAME[c as keyof typeof CAT_NAME]}</td>` : `<td class="lb">${CAT_NAME[c as keyof typeof CAT_NAME]}</td>`;
    };
    const cats = catsOf(v.cfg);
    const rows: string[] = [];
    for (const c of cats) {
      rows.push(`<tr class="${c === 'n6' ? 'sep' : ''}">${label(c)}${seats.map((p) => cell(p, c)).join('')}</tr>`);
      if (c === 'n6' && v.cfg.variant === 'yahtzee')
        rows.push(`<tr class="sum"><td class="lb">Верх <small>· бонус +35 от 63</small></td>${seats.map((p) => {
          const u = upperSum(v.sheet[p]);
          return `<td class="ink"><i>${u}${u >= 63 ? ' <b>+35</b>' : ''}</i>${u < 63 ? '<small>/63</small>' : ''}</td>`;
        }).join('')}</tr>`);
    }
    if (v.cfg.variant === 'yahtzee' && seats.some((p) => v.ybonus[p])) rows.push(`<tr><td class="lb">Ещё яхтзи</td>${seats.map((p) => `<td class="ink"><i>${v.ybonus[p] || ''}</i></td>`).join('')}</tr>`);
    const top = Math.max(...seats.map((p) => total(v, p)));
    rows.push(`<tr class="total"><td class="lb">Итого</td>${seats.map((p) => `<td class="ink${v.over && total(v, p) === top ? ' win' : ''}"><i>${total(v, p)}</i></td>`).join('')}</tr>`);
    this.sheet.innerHTML = `<div class="yz-title">${TITLE[v.cfg.variant] ?? 'Яхтзи'}</div><table class="yz-grid">${head}${rows.join('')}</table>`;
  }

  private drawPanel() {
    const v = this.v;
    const me = this.actSeat;
    const can = !!v && me != null && !v.over;
    const poker = v?.cfg.variant === 'poker';
    this.rollBtn.hidden = !can || v!.rolls >= 3;
    this.rollBtn.disabled = can && v!.rolls > 0 && this.hold.every(Boolean);
    this.rollBtn.textContent = !v || v.rolls === 0 ? 'Бросить кости' : `Перебросить (${3 - v.rolls})`;
    this.standBtn.hidden = !can || !poker || v!.rolls === 0;
    if (!can) {
      this.hint.textContent = '';
      return;
    }
    if (v!.rolls === 0) this.hint.textContent = 'Бросайте все пять костей.';
    else if (poker) this.hint.textContent = v!.rolls < 3 ? 'Коснитесь костей, которые оставить, и перебросьте остальные — или «стоп».' : '';
    else this.hint.textContent = v!.rolls < 3 ? 'Отложите кости касанием и перебросьте — или запишите в графу (карандашные цифры).' : 'Запишите в графу: коснитесь карандашной цифры.';
  }

  private draw() {
    if (!this.v) return;
    this.drawDice();
    this.drawInfo();
    this.drawSheet();
    this.drawPanel();
  }

  setView(v: State) {
    this.v = v;
    this.draw();
  }

  async play(events: Event[], v: State) {
    const speed = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'roll') {
        const cur = this.v!;
        this.v = { ...cur, dice: ev.dice, held: ev.held, rolls: ev.n, turn: ev.seat };
        this.drawInfo();
        this.drawDice(ev.held.map((x) => !x));
        await Promise.all(this.trays.map((t, i) => (ev.held[i] ? Promise.resolve() : t.roll([ev.dice[i]], speed))));
        this.drawDice();
        this.drawInfo();
      } else if (ev.type === 'score') {
        Sound.place();
        await sleep(250 / speed);
      } else if (ev.type === 'stand') {
        Sound.place();
        await sleep(400 / speed);
      } else if (ev.type === 'pround') {
        Sound.win();
        this.v = { ...this.v!, last: { winners: ev.winners, hands: ev.hands }, wins: ev.wins };
        this.info.innerHTML = ev.winners.length === 1 ? `Кон за ${esc(this.plain(ev.winners[0]))}!` : 'Ничья — кон никому';
        await sleep(1300 / speed);
      } else if (ev.type === 'instant') {
        Sound.win();
        this.info.innerHTML = `Генерал с руки — ${esc(this.plain(ev.seat))} выиграл!`;
        await sleep(1500 / speed);
      } else if (ev.type === 'end') Sound.win();
    }
    this.v = v;
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    this.actSeat = v && !v.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    // отложенное сбрасываем только при новом броске или смене хода — повторный вызов не должен стирать выбор
    const key = v ? `${v.turn}:${v.rolls}:${v.moves}` : '';
    if (v && key !== this.holdKey) {
      this.holdKey = key;
      this.hold = v.rolls > 0 && v.rolls < 3 ? v.held.slice() : [false, false, false, false, false];
    }
    this.draw();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    return interactive.includes(toAct[0]) ? 'Ваш ход' : `Ходит ${this.ctx.name(toAct[0])}…`;
  }

  playerStats(v: State, seat: number) {
    return v.cfg.variant === 'poker' ? `побед: ${v.wins[seat]}` : `очков: ${total(v, seat)}`;
  }
}

const TEX = `${import.meta.env.BASE_URL}tex/yahtzee/`;
const TITLE: Record<string, string> = { yahtzee: 'Яхтзи', generala: 'Генерал', poker: 'Покер на костях' };
/** Наклон рукописной цифры: свой у каждой клетки, устойчивый. */
const tilt = (p: number, c: string) => ((((p + 3) * 31 + [...c].reduce((a, ch) => a * 7 + ch.charCodeAt(0), 0)) % 9) - 4) * 0.8;
const dice = (d: number[]) => `<span class="yz-dots">${d.map((x) => `<img src="${TEX}d${x}.webp" alt="${x}">`).join('')}</span>`;

export function createView(): GameView<State, Event> {
  return new YahtzeeView();
}

/* Перудо — отрисовка: стол, по кругу стаканчики игроков (под ними — сколько костей), свои кости — перед своим стаканчиком,
 * в центре — текущая заявка. При «Не верю!»/«Точно!» стаканчики поднимаются: под ними кости, посчитанные подсвечены.
 * Заявка — в панели: число (− +) и грань, «Ставлю», «Не верю!», «Точно!». */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { calzaAllowed, minBid, totalDice, validBid, wild, type Event, type Reveal, type State } from './engine';
import { bidText, SEATS } from './def';
import './perudo.css';

const PIPS: Record<number, number[]> = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
export const dieHTML = (v: number, cls = '') => `<span class="pd-die ${cls}" data-v="${v}">${Array.from({ length: 9 }, (_, i) => `<i${PIPS[v].includes(i + 1) ? ' class="p"' : ''}></i>`).join('')}</span>`;

class PerudoView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private v: State | null = null;
  private wrap!: HTMLElement;
  private seatsEl!: HTMLElement;
  private center!: HTMLElement;
  private banner!: HTMLElement;
  private panel!: HTMLElement;
  private actSeat: number | null = null;
  private viewer = 0;
  private n = 1;
  private face = 2;
  /** Вскрытие на столе (пока идёт показ). */
  private open: Reveal | null = null;
  /** Хот-сит: кости спрятаны, пока следующий не нажмёт «показать». */
  private hidden = false;
  private cover!: HTMLElement;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="pd-wrap"><div class="pd-table"><div class="pd-seats"></div><div class="pd-center"></div><div class="pd-banner" hidden></div></div></div>`);
    root.appendChild(this.wrap);
    this.seatsEl = this.wrap.querySelector('.pd-seats') as HTMLElement;
    this.center = this.wrap.querySelector('.pd-center') as HTMLElement;
    this.banner = this.wrap.querySelector('.pd-banner') as HTMLElement;
    this.cover = h('<div class="pd-cover" hidden><div><p></p><button class="btn primary">Показать мои кости</button></div></div>');
    (this.wrap.querySelector('.pd-table') as HTMLElement).appendChild(this.cover);
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
    };
    this.panel = h('<div class="pd-panel"></div>');
    ctx.controls.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-do]') as HTMLElement | null;
      if (!el || this.actSeat == null || !this.v) return;
      Sound.unlock();
      const d = el.dataset.do!;
      if (d === 'minus') this.n = Math.max(1, this.n - 1);
      else if (d === 'plus') this.n = Math.min(totalDice(this.v), this.n + 1);
      else if (d.startsWith('face')) {
        this.face = Number(d.slice(4));
        const m = minBid(this.v, this.face);
        if (m && !validBid(this.v, this.n, this.face)) this.n = m;
      } else if (d === 'bid') return this.send({ type: 'bid', n: this.n, face: this.face });
      else if (d === 'dudo') return this.send({ type: 'dudo' });
      else if (d === 'calza') return this.send({ type: 'calza' });
      Sound.ui();
      this.drawPanel();
    });
  }

  private send(a: unknown) {
    const seat = this.actSeat;
    if (seat == null) return;
    this.actSeat = null;
    this.drawPanel();
    this.ctx.act(seat, a);
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  /** Имя для таблички — без «(бот)». */
  private short(seat: number) {
    return this.plain(seat).replace(/\s*\(.*\)\s*$/, '');
  }

  // ---------------------------------------------------------------- стол

  private order(v: State) {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  /** Место за столом в % (я — внизу, остальные по дуге). */
  private spot(v: State, seat: number) {
    const k = this.order(v).indexOf(seat);
    const n = v.seats.length;
    if (k === 0) return { x: 50, y: 82 };
    const t = n === 2 ? 0.5 : (k - 1) / (n - 2);
    const a = Math.PI * (1 - t);
    return { x: Math.max(17, Math.min(83, 50 + Math.cos(a) * 40)), y: 46 - Math.sin(a) * 34 };
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    const rv = this.open;
    const counted = (face: number, x: number, wildOnes: boolean) => x === face || (wildOnes && face !== 1 && x === 1);
    let s = '';
    for (const p of v.seats) {
      const at = this.spot(v, p);
      const me = p === this.viewer && this.ctx.mySeats.includes(p) && !this.hidden;
      const cnt = v.counts[p];
      const out = cnt <= 0 && !rv;
      const on = !v.over && v.turn === p;
      const shown = rv ? rv.dice[p] : me || this.ctx.demo ? v.dice[p] : [];
      const wildOnes = rv ? this.ctxWild(rv) : false;
      const dice = shown.map((x) => dieHTML(x, rv && counted(rv.bid.face, x, wildOnes) ? 'hit' : '')).join('');
      const cup = rv || out ? '' : `<div class="pd-cup${me ? ' mine' : ''}" style="--c:${SEATS[p].color}"></div>`;
      const pips = Array.from({ length: Math.max(0, cnt) }, () => '<b></b>').join('');
      const last = v.history.filter((b) => b.seat === p).pop();
      s += `<div class="pd-seat${me ? ' me' : ''}${out ? ' out' : ''}" style="left:${at.x}%;top:${at.y}%">
        ${cup}<div class="pd-dice${rv ? ' open' : ''}">${dice}</div>
        <div class="pd-plate${on ? ' on' : ''}" style="--c:${SEATS[p].color}">${esc(this.short(p))} <span class="pd-left">${pips || 'выбыл'}</span>${last && !rv ? `<em>${bidText(last.n, last.face)}</em>` : ''}</div>
      </div>`;
    }
    this.seatsEl.innerHTML = s;
    const b = rv ? rv.bid : v.bid;
    const tags = [v.palafico && !rv ? '<span class="pd-tag">палафико</span>' : '', !wild(v) && !v.palafico ? '<span class="pd-tag">без джокеров</span>' : ''].join('');
    this.center.innerHTML = b
      ? `<div class="pd-bid"><small>${esc(this.plain(b.seat))} заявляет</small><div><b>${b.n}</b> × ${dieHTML(b.face, 'big')}</div><small>на столе ${totalDice(v)} костей</small>${rv ? `<div class="pd-actual">на деле: <b>${rv.actual}</b></div>` : ''}</div>${tags}`
      : `<div class="pd-bid quiet"><small>новый кон</small><div>на столе ${totalDice(v)} костей</div></div>${tags}`;
    this.drawPanel();
  }

  private ctxWild(rv: Reveal) {
    return this.v!.cfg.jokers && !rv.palafico;
  }

  private drawPanel() {
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null || v.over || this.ctx.demo || this.hidden) {
      this.panel.innerHTML = '';
      return;
    }
    if (!validBid(v, this.n, this.face)) {
      // подобрать допустимую ставку: та же грань — наименьшее число, иначе любая грань
      const m = minBid(v, this.face);
      if (m) this.n = m;
      else
        for (const f of [2, 3, 4, 5, 6, 1]) {
          const mm = minBid(v, f);
          if (mm) {
            this.face = f;
            this.n = mm;
            break;
          }
        }
    }
    const ok = validBid(v, this.n, this.face);
    const faces = [1, 2, 3, 4, 5, 6].map((f) => `<button class="pd-face${f === this.face ? ' on' : ''}" data-do="face${f}"${minBid(v, f) ? '' : ' disabled'}>${dieHTML(f)}</button>`).join('');
    this.panel.innerHTML = `
      <div class="pd-ask">Ваша заявка: на всём столе не меньше…</div>
      <div class="pd-n"><button class="btn" data-do="minus">−</button><b>${this.n}</b><button class="btn" data-do="plus">+</button></div>
      <div class="pd-faces">${faces}</div>
      <button class="btn primary" data-do="bid"${ok ? '' : ' disabled'}>Ставлю: ${bidText(this.n, this.face)}</button>
      ${v.bid ? `<button class="btn" data-do="dudo">Не верю!</button>` : ''}
      ${calzaAllowed(v) ? `<button class="btn" data-do="calza">Точно!</button>` : ''}`;
  }

  private showBanner(text: string) {
    this.banner.textContent = text;
    this.banner.hidden = !text;
  }

  // ---------------------------------------------------------------- GameView

  setView(v: State) {
    this.v = v;
    this.open = null;
    this.showBanner(v.over ? 'Партия окончена' : '');
    this.draw();
  }

  async play(events: Event[], v: State) {
    const speed = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'bid') {
        this.v = { ...this.v!, bid: { seat: ev.seat, n: ev.n, face: ev.face }, history: [...this.v!.history, { seat: ev.seat, n: ev.n, face: ev.face }] };
        this.draw();
        Sound.place();
        await sleep(550 / speed);
      } else if (ev.type === 'reveal') {
        const r = ev.reveal;
        this.showBanner(`${this.plain(r.caller)}: ${r.kind === 'dudo' ? '«Не верю!»' : '«Точно!»'}`);
        Sound.ui();
        await sleep(700 / speed);
        this.open = r;
        this.draw();
        Sound.diceRoll(0.3);
        await sleep(900 / speed);
        this.showBanner(r.loser != null ? `${this.plain(r.loser)} теряет кость` : r.gainer != null ? `${this.plain(r.gainer)} возвращает кость` : 'Точно!');
        if (r.loser != null && this.ctx.mySeats.includes(r.loser)) Sound.nomove();
        else Sound.win();
        await sleep(1900 / speed);
      } else if (ev.type === 'roll') {
        this.open = null;
        this.showBanner(ev.palafico ? 'Палафико!' : '');
        Sound.diceRoll(0.5);
        await sleep(300 / speed);
      } else if (ev.type === 'end') {
        this.open = null;
        this.v = v;
        this.draw();
        this.showBanner(`Победил ${this.plain(ev.winner)}`);
        Sound.win();
      }
    }
    this.v = v;
    this.open = null;
    if (!v.over) this.showBanner(v.palafico && !v.bid ? 'Палафико!' : '');
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    const mine = this.ctx.mySeats.filter((x) => v?.seats.includes(x));
    // несколько людей за одним экраном — показываем кости того, чей ход (остальным не подглядывать)
    const who = interactive.find((x) => toAct.includes(x));
    if (who != null && who !== this.viewer && mine.length > 1) {
      this.hidden = true;
      (this.cover.querySelector('p') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(who)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
      this.cover.hidden = false;
    }
    if (who != null) this.viewer = who;
    else if (mine.length && !mine.includes(this.viewer)) this.viewer = mine[0];
    this.actSeat = v && !v.over && !this.ctx.demo ? (who ?? null) : null;
    if (v && this.actSeat != null) {
      // по умолчанию — грань, которой у меня больше всего
      const my = v.dice[this.actSeat];
      const best = [2, 3, 4, 5, 6].sort((a, b) => my.filter((x) => x === b).length - my.filter((x) => x === a).length)[0];
      this.face = minBid(v, best) ? best : this.face;
      this.n = minBid(v, this.face) || this.n;
    }
    this.draw();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    return interactive.includes(toAct[0]) ? 'Ваш ход' : `Заявляет ${this.ctx.name(toAct[0])}…`;
  }

  playerStats(v: State, seat: number) {
    return v.counts[seat] > 0 ? `костей: ${v.counts[seat]}` : 'выбыл';
  }
}

export function createView(): GameView<State, Event> {
  return new PerudoView();
}

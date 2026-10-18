/* Лото — отрисовка. Русское: на клеёнке мешок и последний бочонок с присказкой, ряд вышедших бочонков, свои карточки
 * (пастельный картон, числа в белых клетках — как в коробке 70-х), фишки кладёт сам игрок нажатием; чужие карточки — мельче.
 * «Вокруг света»: карточка-вопрос в центре, свои большие карты по 8 картинок (картинки — со сканов 1972 года),
 * угаданная картинка закрывается маленькой карточкой. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { cardNums, fullRows, ownerOf, picsOf, STAGES, type Card, type Event, type View } from './engine';
import { barrelCall } from './names';
import { edition } from './world-data';
import './loto.css';

const PIC = `${import.meta.env.BASE_URL}loto/`;
const TINTS = ['yellow', 'pink', 'blue', 'green', 'orange'];

class LotoView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private v: View | null = null;
  private root!: HTMLElement;
  private panel!: HTMLElement;
  private toAct: number[] = [];
  private interactive: number[] = [];
  /** Последняя выкрикнутая присказка. */
  private call = '';
  /** Баннер поверх стола. */
  private banner = '';
  /** «Вокруг света»: подсветить ответ (после разбора). */
  private reveal: { pic: number; ok: boolean } | null = null;
  /** Только что положенная фишка (анимируется только она). */
  private fresh = '';

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h('<div class="lt-wrap"></div>');
    root.appendChild(this.root);
    this.panel = h('<div class="lt-panel"></div>');
    ctx.controls.appendChild(this.panel);
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.panel.addEventListener('click', (e) => this.onClick(e));
  }

  /** Места этого экрана, которые сейчас в партии. */
  private mine(): number[] {
    const v = this.v;
    return v ? this.ctx.mySeats.filter((p) => v.seats.includes(p)) : [];
  }

  private onClick(e: Event | MouseEvent) {
    const el = ((e as MouseEvent).target as HTMLElement).closest('[data-do]') as HTMLElement | null;
    const v = this.v;
    if (!el || !v || this.ctx.demo || v.over) return;
    Sound.unlock();
    const d = el.dataset.do!;
    if (d === 'draw') {
      const seat = this.toAct.find((p) => this.interactive.includes(p));
      if (seat != null) this.ctx.act(seat, { type: 'draw' });
    } else if (d === 'mark') {
      const seat = Number(el.dataset.seat);
      const n = Number(el.dataset.n);
      if (!this.ctx.mySeats.includes(seat)) return;
      const c = v.cards[seat][Number(el.dataset.card)];
      if (c.marked.includes(n)) return;
      if (!v.called.includes(n)) {
        el.classList.remove('shake');
        void el.offsetWidth;
        el.classList.add('shake');
        Sound.nomove();
        return;
      }
      // сразу кладём фишку (сервер подтвердит)
      c.marked.push(n);
      this.fresh = `${seat}:${el.dataset.card}:${n}`;
      Sound.place();
      this.draw();
      this.ctx.act(seat, { type: 'mark', card: Number(el.dataset.card), n });
    } else if (d === 'pic' || d === 'pass') {
      const seat = Number(el.dataset.seat ?? this.answering());
      if (!this.toAct.includes(seat) || !this.interactive.includes(seat)) return;
      const pic = d === 'pass' ? 0 : Number(el.dataset.pic);
      if (pic && v.covered.includes(pic)) return;
      Sound.place();
      v.answers[seat] = pic;
      this.draw();
      this.ctx.act(seat, { type: 'answer', pic });
    }
  }

  /** Кто за этим экраном сейчас отвечает (хот-сит — первый, кто ещё не ответил). */
  private answering(): number | undefined {
    return this.toAct.find((p) => this.interactive.includes(p));
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '').replace(/\s*\(.*\)\s*$/, '');
  }

  // ---------------------------------------------------------------- русское лото

  private cardHTML(c: Card, seat: number, ci: number, big: boolean, called: Set<number>) {
    const rows = c.rows
      .map(
        (r) =>
          `<div class="lt-row">${r
            .map((n) => {
              if (!n) return '<i class="lt-cell empty"></i>';
              const on = c.marked.includes(n);
              const can = big && !on && !this.ctx.demo;
              return `<b class="lt-cell${on ? ' on' : ''}${can ? ' can' : ''}" ${can ? `data-do="mark" data-seat="${seat}" data-card="${ci}" data-n="${n}"` : ''}><span>${n}</span><small>${n}</small>${on ? `<em class="lt-chip${this.fresh === `${seat}:${ci}:${n}` ? ' fresh' : ''}"></em>` : ''}</b>`;
            })
            .join('')}</div>`
      )
      .join('');
    const fr = fullRows(c, called);
    return `<div class="lt-card t-${TINTS[c.tint % TINTS.length]}${big ? ' big' : ''}${fr ? ` rows${fr}` : ''}">${rows}</div>`;
  }

  private barrel(n: number, cls = '') {
    return `<span class="lt-barrel ${cls}"><span>${n}</span></span>`;
  }

  private drawRussian(v: View) {
    const called = new Set(v.called);
    const mine = this.mine();
    const last = v.called[v.called.length - 1];
    const recent = v.called.slice(-9, -1).reverse();
    const others = v.seats.filter((p) => !mine.includes(p));
    const prize = v.over ? 'Партия окончена' : `Разыгрываем: <b>${STAGES[v.stage]}</b>`;
    const myCards = (mine.length ? mine : this.ctx.demo ? [v.seats[0]] : [])
      .map(
        (p) =>
          `<div class="lt-mine">${mine.length > 1 || this.ctx.demo ? `<div class="lt-who">${this.ctx.name(p)}</div>` : ''}<div class="lt-cards">${v.cards[p]
            .map((c, ci) => this.cardHTML(c, p, ci, true, called))
            .join('')}</div></div>`
      )
      .join('');
    const shown = this.ctx.demo ? v.seats.slice(1) : others;
    const small = shown
      .map(
        (p) =>
          `<div class="lt-other${this.toAct.includes(p) ? ' turn' : ''}"><div class="lt-who">${this.ctx.name(p)}</div><div class="lt-cards">${v.cards[p]
            .map((c, ci) => this.cardHTML(c, p, ci, false, called))
            .join('')}</div></div>`
      )
      .join('');
    this.root.innerHTML = `<div class="lt-cloth">
      <div class="lt-top">
        <div class="lt-bag" title="В мешке: ${v.bagLeft}"><span>${v.bagLeft}</span></div>
        <div class="lt-last">${last ? this.barrel(last, 'big') : ''}<div class="lt-call">${esc(this.call || (last ? barrelCall(last, v.callKey) : 'Тянем бочонок!'))}</div></div>
        <div class="lt-recent">${recent.map((n) => this.barrel(n)).join('')}</div>
      </div>
      <div class="lt-prize">${prize}</div>
      ${this.banner ? `<div class="lt-banner">${this.banner}</div>` : ''}
      ${myCards}
      <div class="lt-others">${small}</div>
    </div>`;
    const myTurn = this.toAct.some((p) => this.interactive.includes(p)) && !v.over && !this.ctx.demo;
    const board = Array.from({ length: 90 }, (_, i) => `<i class="${called.has(i + 1) ? 'on' : ''}${i + 1 === last ? ' last' : ''}">${i + 1}</i>`).join('');
    this.panel.innerHTML = `${myTurn ? '<button class="btn primary lt-draw" data-do="draw" data-tap>Тянуть бочонок</button>' : ''}
      <div class="lt-board" title="Вышедшие бочонки">${board}</div>`;
  }

  // ---------------------------------------------------------------- «Вокруг света»

  private sheetHTML(id: number, seat: number, big: boolean, v: View) {
    const can = big && !this.ctx.demo && this.toAct.includes(seat) && this.interactive.includes(seat) && !(seat in v.answers);
    const picked = v.answers[seat];
    const ed = edition(v.cfg.edition);
    const pics = ed.sheets[id]
      .map((n) => {
        const cov = v.covered.includes(n);
        const rv = this.reveal && this.reveal.pic === n ? (this.reveal.ok ? ' right' : ' wrong') : '';
        const sel = picked === n ? ' picked' : '';
        const act = can && !cov ? `data-do="pic" data-seat="${seat}" data-pic="${n}"` : '';
        return `<figure class="lt-pic${cov ? ' cov' : ''}${rv}${sel}${act ? ' can' : ''}" ${act}><img src="${PIC}${ed.dir}/p${n}.webp" alt="" loading="lazy" draggable="false">${
          cov ? `<div class="lt-qcard mini"><b>${n}</b></div>` : ''
        }<figcaption>${esc(ed.a[n] ?? '')}</figcaption></figure>`;
      })
      .join('');
    const hint = big && v.cfg.hint && v.current != null && ed.sheets[id].includes(v.current) && !v.covered.includes(v.current) ? ' hint' : '';
    return `<div class="lt-sheet c${ed.cols}${big ? ' big' : ''}${hint}">${pics}</div>`;
  }

  private qcard(n: number | null, v: View) {
    if (n == null) return '<div class="lt-qcard empty"></div>';
    return `<div class="lt-qcard"><b>${n}</b><p>${esc(edition(v.cfg.edition).q[n] ?? '')}</p></div>`;
  }

  private drawWorld(v: View) {
    const mine = this.mine();
    const show = mine.length ? mine : this.ctx.demo ? [v.seats[0]] : [];
    const others = v.seats.filter((p) => !show.includes(p));
    const tally = (p: number) => {
      const all = picsOf(v, p);
      return `${all.filter((x) => v.covered.includes(x)).length} из ${all.length}`;
    };
    const answered = (p: number) => (p in v.answers ? (v.answers[p] ? ' ✋' : ' ✓') : '');
    const reader = v.seats[v.turn];
    this.root.innerHTML = `<div class="lt-cloth world">
      <div class="lt-ask">
        ${this.qcard(v.current, v)}
        <div class="lt-asknote">${v.current != null ? `Читает ${this.ctx.name(reader)}` : ''}<br><small>в колоде: ${v.deckLeft}</small></div>
      </div>
      ${this.banner ? `<div class="lt-banner">${this.banner}</div>` : ''}
      ${show
        .map(
          (p) =>
            `<div class="lt-mine">${show.length > 1 || this.ctx.demo ? `<div class="lt-who">${this.ctx.name(p)}${answered(p)} · закрыто ${tally(p)}</div>` : ''}<div class="lt-sheets">${v.sheets[p]
              .map((id) => this.sheetHTML(id, p, true, v))
              .join('')}</div></div>`
        )
        .join('')}
      <div class="lt-others">${others
        .map(
          (p) =>
            `<div class="lt-other${this.toAct.includes(p) ? ' turn' : ''}"><div class="lt-who">${this.ctx.name(p)}${answered(p)}</div><div class="lt-sheets small">${v.sheets[p]
              .map((id) => this.sheetHTML(id, p, false, v))
              .join('')}</div><div class="lt-tally">закрыто ${tally(p)}</div></div>`
        )
        .join('')}</div>
    </div>`;
    const who = this.answering();
    const can = who != null && !v.over && !this.ctx.demo && v.current != null;
    this.panel.innerHTML = can
      ? `<button class="btn lt-pass" data-do="pass" data-seat="${who}">Не у меня</button>`
      : '';
  }

  // ---------------------------------------------------------------- GameView

  private draw() {
    const v = this.v;
    if (!v) return;
    if (v.cfg.mode === 'world') this.drawWorld(v);
    else this.drawRussian(v);
  }

  setView(v: View) {
    this.v = v;
    this.call = '';
    this.banner = v.over ? 'Партия окончена' : '';
    this.reveal = null;
    this.draw();
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    this.fresh = '';
    let cur = this.v ?? v;
    for (const ev of events) {
      if (ev.type === 'draw') {
        cur = { ...cur, called: [...cur.called, ev.n], callKey: ev.k, bagLeft: ev.left };
        this.v = cur;
        this.call = barrelCall(ev.n, ev.k);
        this.banner = '';
        this.draw();
        this.root.querySelector('.lt-barrel.big')?.classList.add('fresh');
        Sound.diceRoll(0.25);
        await sleep(1300 / speed);
      } else if (ev.type === 'prize') {
        this.v = { ...v };
        this.banner = `🎉 ${this.plain(ev.seat)}: ${ev.stage === 2 ? 'вся карточка!' : STAGES[ev.stage] + '!'}`;
        this.draw();
        if (this.ctx.mySeats.includes(ev.seat)) Sound.win();
        else Sound.turn();
        await sleep(1700 / speed);
      } else if (ev.type === 'read') {
        this.reveal = null;
        this.banner = '';
        cur = { ...v, current: ev.card, answers: {} };
        this.v = cur;
        this.draw();
        Sound.card();
        await sleep(500 / speed);
      } else if (ev.type === 'take' || ev.type === 'unknown') {
        const owner = ev.type === 'take' ? ev.seat : ownerOf(this.v!, ev.card);
        this.reveal = { pic: ev.card, ok: ev.type === 'take' };
        this.banner =
          ev.type === 'take'
            ? `${this.plain(ev.seat)}: «${esc(ev.text)}» — верно!`
            : `Это «${esc(ev.text)}»${owner != null ? ` — у ${esc(this.plain(owner))}` : ''}. ${ev.lost ? 'Карточка уходит в коробку.' : 'Под низ колоды.'}`;
        this.draw();
        if (ev.type === 'take' && this.ctx.mySeats.includes(ev.seat)) Sound.win();
        else Sound.ui();
        await sleep(1800 / speed);
      } else if (ev.type === 'wrong') {
        if (this.ctx.mySeats.includes(ev.seat)) Sound.nomove();
      } else if (ev.type === 'end') {
        this.v = v;
        const w = v.seats.filter((p) => (ev.winners as number[]).includes(p)).map((p) => this.plain(p));
        this.banner = `🏁 ${w.length > 1 ? 'Победили' : 'Победил'} ${esc(w.join(', '))}`;
        this.draw();
        Sound.win();
      }
    }
    this.v = v;
    if (!v.over && v.cfg.mode === 'russian') this.banner = '';
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.toAct = toAct;
    this.interactive = interactive;
    this.draw();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    if (v.cfg.mode === 'world') return toAct.some((p) => interactive.includes(p)) ? 'Узнали? Нажмите на картинку или «Не у меня»' : 'Ждём ответов…';
    return interactive.includes(toAct[0]) ? 'Ваша очередь тянуть бочонок' : `Тянет ${this.ctx.name(toAct[0])}…`;
  }

  playerStats(v: View, seat: number) {
    if (v.cfg.mode === 'world') {
      const all = picsOf(v, seat);
      return `закрыто ${all.filter((x) => v.covered.includes(x)).length} из ${all.length}`;
    }
    const called = new Set(v.called);
    const best = Math.max(0, ...v.cards[seat].map((c) => cardNums(c).filter((n) => c.marked.includes(n) && called.has(n)).length));
    const prizes = v.prizes.filter((x) => x.seat === seat).map((x) => STAGES[x.stage]);
    return `${prizes.length ? '🎉 ' + prizes.join(', ') + ' · ' : ''}лучшая: ${best}/15`;
  }
}

export function createView(): GameView<View, Event> {
  return new LotoView();
}

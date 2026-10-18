/* «А у нас во дворе» — отрисовка: тетрадный лист в клетку. Сверху — этап, норматив, часы и очки; дальше повод,
 * как решать и поле задачи. Кнопки «Проверить / Подсказка / Сдаться» — в панели стола. Поле задачи не
 * перерисовывается от чужих ходов: черновик живёт, пока у игрока та же задача. */
import { Sound } from '../../core/audio';
import { esc, h } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { fmtSec } from './def';
import { award, type BoardView, type Event, type View } from './engine';
import { kindOf, LEVELS } from './kinds';
import { makePad, type Pad } from './pads';
import { stageOf } from './stages';
import './dvor.css';

class DvorView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private sheet!: HTMLElement;
  private ctl!: HTMLElement;
  private v: View | null = null;
  private seat = -1;
  private key = '';
  private pad: Pad | null = null;
  private hintsShown = 0;
  private closed = false;
  private clockEl: HTMLElement | null = null;
  private tick: ReturnType<typeof setInterval> | undefined;
  private msgEl: HTMLElement | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="dv-wrap"><div class="dv-sheet"></div></div>`);
    this.sheet = this.root.querySelector('.dv-sheet')!;
    root.appendChild(this.root);
    this.ctl = h(`<div class="dv-ctl"></div>`);
    ctx.controls.appendChild(this.ctl);
    this.tick = setInterval(() => this.clock(), 500);
  }

  destroy() {
    clearInterval(this.tick);
  }

  /** Чью доску показываем: своё место, которое ещё решает, иначе первое своё; в показе — 0. */
  private pickSeat(v: View): number {
    const mine = this.ctx.demo ? v.seats : this.ctx.mySeats.filter((s) => v.seats.includes(s));
    if (!mine.length) return v.seats[0];
    if (mine.includes(this.seat) && v.boards[this.seat].i < v.total) return this.seat;
    return mine.find((s) => v.boards[s].i < v.total) ?? mine[0];
  }

  setView(v: View) {
    this.v = v;
    const seat = this.pickSeat(v);
    this.seat = seat;
    const b = v.boards[seat];
    const key = `${seat}:${b.i}:${v.total}`;
    if (key !== this.key) {
      this.key = key;
      this.build(v, seat, b);
    } else {
      if (b.hints && b.hints.length !== this.hintsShown) this.showHints(b);
      if (b.phase === 'done' && !this.closed) this.close(b);
    }
    this.controls(v, seat, b);
  }

  async play(events: Event[], v: View) {
    for (const e of events) {
      if (e.seat !== this.seat) continue;
      if (e.type === 'wrong') {
        this.flash('Не сходится — проверьте ещё раз. Ошибка стоит очко.', 'bad');
        Sound.nomove();
      } else if (e.type === 'solved') Sound.win();
      else if (e.type === 'hint') Sound.pen();
    }
    this.setView(v);
  }

  setTurn() {
    if (this.v) this.controls(this.v, this.seat, this.v.boards[this.seat]);
  }

  status(v: View): string {
    const b = v.boards[this.seat];
    if (!b) return '';
    if (b.i >= v.total) return 'Олимпиада окончена';
    return b.phase === 'done' ? 'Задача закрыта — дальше!' : `Задача ${b.i + 1} из ${v.total}`;
  }

  playerStats(v: View, seat: number): string {
    const b = v.boards[seat];
    if (!b) return '';
    const solved = b.marks.filter((m) => m.ok).length;
    return `<b>${b.score}</b> очк. · ${Math.min(b.i + (b.phase === 'done' ? 1 : 0), v.total)}/${v.total}${solved ? ` · решено ${solved}` : ''}`;
  }

  // ---------------------------------------------------------------- лист

  private build(v: View, seat: number, b: BoardView) {
    this.pad = null;
    this.hintsShown = 0;
    this.sheet.innerHTML = '';
    if (b.phase === 'solve') this.root.scrollTop = 0;
    if (b.i >= v.total || !b.cur) {
      this.sheet.appendChild(this.final(v, seat, b));
      this.clockEl = null;
      return;
    }
    const p = b.cur;
    const K = kindOf(p.kind);
    const st = stageOf(p.stage);
    const stageNo = v.cfg.mode === 'olymp' ? `Этап ${Math.floor(b.i / 2) + 1} · ` : '';
    const head = h(`<header class="dv-head">
      <span class="dv-stage">${st.icon} ${stageNo}${esc(st.title)}</span>
      <span class="dv-kind">${esc(K.title)} · ${LEVELS[p.level]}</span>
      <span class="dv-par" title="норматив">⏱ ${fmtSec(K.par[p.level])}</span>
      <span class="dv-clock"></span>
      <span class="dv-score">${b.score} очк.</span>
    </header>`);
    this.clockEl = head.querySelector('.dv-clock');
    this.sheet.appendChild(head);
    this.sheet.appendChild(h(`<div class="dv-num">Задача ${b.i + 1} из ${v.total} · до ${K.pts[p.level]} очк.</div>`));
    const lead = st.lead[p.kind];
    if (lead) this.sheet.appendChild(h(`<p class="dv-lead">${esc(lead)}</p>`));
    this.sheet.appendChild(h(`<p class="dv-how">${esc(K.how)}</p>`));
    const pad = makePad(p.kind, p.data, () => this.flash(''));
    this.pad = pad;
    const box = h(`<div class="dv-pad dv-pad--${p.kind}"></div>`);
    box.appendChild(pad.el);
    this.sheet.appendChild(box);
    this.msgEl = h(`<div class="dv-msg"></div>`);
    this.sheet.appendChild(this.msgEl);
    this.sheet.appendChild(h(`<ul class="dv-hints"></ul>`));
    this.showHints(b);
    this.closed = false;
    if (b.phase === 'done') this.close(b);
    if (this.ctx.demo) pad.lock();
    this.clock();
  }

  /** Задача закрыта: решение поверх черновика, карточка с очками и «А знаете ли вы». */
  private close(b: BoardView) {
    this.closed = true;
    const p = b.cur;
    if (!p || !this.pad) return;
    if (p.sol != null) this.pad.solution(p.sol);
    this.pad.lock();
    const card = this.doneCard(b, stageOf(p.stage).facts, b.i);
    this.sheet.appendChild(card);
    requestAnimationFrame(() => card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  private showHints(b: BoardView) {
    const hs = b.hints ?? [];
    this.hintsShown = hs.length;
    const ul = this.sheet.querySelector('.dv-hints');
    if (ul) ul.innerHTML = hs.map((x) => `<li>💡 ${esc(x.text)}</li>`).join('');
    this.pad?.hints(hs);
  }

  private doneCard(b: BoardView, facts: string[], i: number): HTMLElement {
    const m = b.marks[b.marks.length - 1];
    const fact = facts.length ? facts[i % facts.length] : '';
    const parts = m?.ok
      ? [`Решено за ${fmtSec(m.sec)}`, m.hints ? `подсказок ${m.hints}` : '', m.wrong ? `ошибок ${m.wrong}` : '', m.par ? 'в норматив +1' : '', m.first ? 'первым +1' : ''].filter(Boolean).join(' · ')
      : 'Сдался — вот ответ.';
    return h(`<div class="dv-done ${m?.ok ? 'ok' : 'fail'}">
      <div class="dv-done-t">${m?.ok ? `✔ +${m.pts}` : '✕ 0'}</div><div>${esc(parts)}</div>
      ${fact ? `<p class="dv-fact"><b>А знаете ли вы?</b> ${esc(fact)}</p>` : ''}
    </div>`);
  }

  private final(v: View, seat: number, b: BoardView): HTMLElement {
    const total = b.marks.reduce((t, m) => t + (m.ok ? 1 : 0), 0);
    const others = v.seats.filter((s) => s !== seat);
    const rows = v.seats
      .map((s) => ({ s, b: v.boards[s] }))
      .sort((x, y) => y.b.score - x.b.score)
      .map((x) => `<tr${x.s === seat ? ' class="me"' : ''}><td>${this.ctx.name(x.s)}</td><td>${x.b.score}</td><td>${x.b.marks.filter((m) => m.ok).length}/${v.total}</td><td>${x.b.i >= v.total ? '🏁' : `решает ${x.b.i + 1}`}</td></tr>`)
      .join('');
    const mx = v.max;
    const aw = award(b.score, mx);
    return h(`<div class="dv-final">
      <div class="dv-gramota"><div class="dv-medal">${aw.medal}</div><h2>${aw.title}</h2>
      <p>${this.ctx.name(seat)} — ${b.score} очков из ${mx}, решено задач: ${total} из ${v.total}.</p></div>
      ${others.length ? `<table class="dv-rank"><tr><th>Кто</th><th>Очки</th><th>Решено</th><th></th></tr>${rows}</table>` : ''}
    </div>`);
  }

  // ---------------------------------------------------------------- кнопки

  private ctlKey = '';

  private controls(v: View, seat: number, b: BoardView) {
    // ходы соперников приходят часто — кнопки не пересоздаём без надобности (иначе срывается нажатие)
    const key = `${seat}:${b?.i}:${b?.phase}:${b?.hints?.length ?? 0}:${v.total}:${this.ctx.mySeats.join(',')}`;
    if (key === this.ctlKey) return;
    this.ctlKey = key;
    this.ctl.innerHTML = '';
    if (this.ctx.demo || !b) return;
    const mine = this.ctx.mySeats.includes(seat);
    if (!mine || b.i >= v.total) return;
    if (b.phase === 'done') {
      const next = h<HTMLButtonElement>(`<button class="btn primary" data-tap>${b.i + 1 >= v.total ? 'К грамоте' : 'Дальше →'}</button>`);
      next.onclick = () => this.ctx.act(seat, { t: 'next' });
      this.ctl.appendChild(next);
      return;
    }
    const check = h<HTMLButtonElement>(`<button class="btn primary">Проверить</button>`);
    check.onclick = () => {
      const a = this.pad?.answer();
      if (a == null) {
        this.flash('Заполнено не всё — допишите ответ.', 'warn');
        return;
      }
      this.ctx.act(seat, { t: 'ans', a });
    };
    const K = b.cur ? kindOf(b.cur.kind) : null;
    const hint = h<HTMLButtonElement>(`<button class="btn" title="Подсказка стоит очко">💡 Подсказка</button>`);
    hint.disabled = (b.hints?.length ?? 0) >= 3 || !K;
    hint.onclick = () => this.ctx.act(seat, { t: 'hint' });
    const skip = h<HTMLButtonElement>(`<button class="btn">Сдаться</button>`);
    skip.onclick = () => {
      if (confirm('Сдаться? Покажут ответ, очков за задачу не будет.')) this.ctx.act(seat, { t: 'skip' });
    };
    this.ctl.append(check, hint, skip);
  }

  private flash(text: string, cls = '') {
    if (!this.msgEl) return;
    this.msgEl.textContent = text;
    this.msgEl.className = 'dv-msg' + (cls ? ' ' + cls : '');
  }

  private clock() {
    if (!this.clockEl || !this.v) return;
    const b = this.v.boards[this.seat];
    if (!b || b.phase !== 'solve') {
      const m = b?.marks[b.marks.length - 1];
      this.clockEl.textContent = m ? fmtSec(m.sec) : '';
      return;
    }
    const sec = Math.max(0, Math.floor((Date.now() - b.t0) / 1000));
    this.clockEl.textContent = fmtSec(sec);
    const K = b.cur ? kindOf(b.cur.kind) : null;
    this.clockEl.classList.toggle('over', !!K && !!b.cur && sec > K.par[b.cur.level]);
  }
}

export function createView(): GameView<View, Event> {
  return new DvorView();
}

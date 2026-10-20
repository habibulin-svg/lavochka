/* Данетки — отрисовка: вечерний двор, игроки кругом (ведущий — с лампой), в центре — карточка данетки с историей и подсказками.
 * В панели — блокнот «что выяснили», вопросы (готовые — с ботом-ведущим, свои — с живым), разгадка; живому ведущему — разгадка и кнопки «да/нет/неважно». */
import { Sound } from '../../core/audio';
import { esc, h, keepDrafts, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { ANS, LEVEL, SEATS } from './def';
import { danetka } from './data';
import type { Event, View } from './engine';
import './danetki.css';

/** Псевдослучайное число по ключу — для постоянного перемешивания. */
const mix = (x: number) => {
  let t = (x * 2654435761) >>> 0;
  t ^= t >>> 15;
  return Math.imul(t, 2246822519) >>> 0;
};
const live = (v: View) => v.host != null && v.humans.includes(v.host);

class DanetkiView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private ring!: HTMLElement;
  private center!: HTMLElement;
  private sheet!: HTMLElement;
  private panel!: HTMLElement;
  private v: View | null = null;
  private interactive: number[] = [];
  private showSecret = false;
  /** Открыта форма «Знаю разгадку!» — переживает перерисовку панели (ход того же игрока). */
  private guessOpen = -1;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="dn-wrap"><div class="dn-bg"></div><div class="dn-ring"></div><div class="dn-center"></div><div class="dn-sheet" hidden></div></div>`);
    root.appendChild(this.root);
    this.ring = this.root.querySelector('.dn-ring') as HTMLElement;
    this.center = this.root.querySelector('.dn-center') as HTMLElement;
    this.sheet = this.root.querySelector('.dn-sheet') as HTMLElement;
    this.panel = h('<div class="dn-panel"></div>');
    ctx.controls.appendChild(this.panel);
  }

  private plain(seat: number) {
    return seat < 0 ? 'Ведущий' : this.ctx.name(seat).replace(/<[^>]+>/g, '').replace(/\s*\(бот\)/, '');
  }
  private mine(v: View) {
    return this.ctx.demo ? [] : this.ctx.mySeats.filter((x) => v.seats.includes(x));
  }
  private can(x: number) {
    return this.interactive.includes(x);
  }
  private send(seat: number, a: unknown) {
    this.sheet.hidden = true;
    this.guessOpen = -1;
    this.ctx.act(seat, a);
  }

  // ---------------------------------------------------------------- рисунок

  private draw() {
    const v = this.v;
    if (!v) return;
    const n = v.seats.length;
    const mine = this.mine(v);
    const i0 = mine.length === 1 ? Math.max(0, v.seats.indexOf(mine[0])) : 0;
    const order = v.seats.map((_, k) => v.seats[(i0 + k) % n]);
    const last = v.log[v.log.length - 1];
    let s = '';
    order.forEach((seat, k) => {
      const a = Math.PI / 2 + (k / n) * Math.PI * 2;
      const x = 50 + Math.cos(a) * 44;
      const y = 50 + Math.sin(a) * 42;
      const host = v.host === seat;
      const turn = v.phase === 'play' && v.turn === seat && v.pending == null;
      const asked = v.phase === 'play' && v.rules && v.asked.includes(seat);
      const said = last && last.seat === seat && !last.hint && v.phase === 'play' ? `<div class="dn-bubble">${esc(last.text || (last.guess ? 'разгадка голосом' : 'вопрос голосом'))}${last.a ? ` <b class="dn-${last.a}">${ANS[last.a]}</b>` : last.right != null ? ` <b class="dn-${last.right ? 'y' : 'n'}">${last.right ? 'Верно!' : 'Нет'}</b>` : ''}</div>` : '';
      const side = x < 30 ? ' dn-l' : x > 70 ? ' dn-r' : '';
      s += `<div class="dn-seat${turn ? ' dn-turn' : ''}${host ? ' dn-host' : ''}${asked ? ' dn-asked' : ''}${side}" style="left:${x}%;top:${y}%;--c:${SEATS[seat].color}">
        ${said}<div class="dn-face">${host ? '🔦' : esc(this.plain(seat)).slice(0, 1)}</div><div class="dn-name">${esc(this.plain(seat))}${v.rules ? ` <b>${v.scores[seat] ?? 0}</b>` : ''}</div>${host ? '<span class="dn-tag">ведущий</span>' : ''}</div>`;
    });
    this.ring.innerHTML = s;
    this.center.innerHTML = this.cardHTML(v);
  }

  private cardHTML(v: View): string {
    const lv = `<span class="dn-lv dn-lv${v.level}">${'★'.repeat(v.level)}<i>${'★'.repeat(3 - v.level)}</i> ${LEVEL[v.level]}</span>`;
    const head = `<div class="dn-head"><span>Данетка ${v.n} из ${v.total}</span>${lv}</div><div class="dn-title">${esc(v.title)}</div>`;
    if (v.phase === 'over') {
      const rows = v.seats
        .slice()
        .sort((a, b) => (v.scores[b] ?? 0) - (v.scores[a] ?? 0))
        .map((x) => `<div>${esc(this.plain(x))} — <b>${v.scores[x] ?? 0}</b></div>`)
        .join('');
      return `<div class="dn-card dn-l${v.level}"><div class="dn-title">Игра окончена</div>${v.rules ? `<div class="dn-score">${rows}</div>` : `<div class="dn-story">Разгадано ${v.history.filter((r) => r.solver != null).length} из ${v.history.length}.</div>`}</div>`;
    }
    if (v.phase === 'reveal' && v.secret) {
      const r = v.last;
      const who = r?.solver != null ? `Разгадал <b>${esc(this.plain(r.solver))}</b>${r.gain ? ` (+${r.gain})` : ''}` : 'Никто не разгадал';
      return `<div class="dn-card dn-l${v.level}">${head}<div class="dn-who">${who}</div><div class="dn-answer">${esc(v.secret.answer)}</div></div>`;
    }
    const hints = v.hints.map((t, i) => `<div class="dn-hint">🔎 ${i + 1}. ${esc(t)}</div>`).join('');
    const clock = v.rules ? `<div class="dn-circle">круг ${Math.min(v.circle, v.circles)} из ${v.circles}</div>` : '';
    return `<div class="dn-card dn-l${v.level}">${head}<div class="dn-story">${esc(v.story)}</div>${hints}${clock}</div>`;
  }

  // ---------------------------------------------------------------- панель

  private notebook(v: View): string {
    const d = danetka(v.id);
    const facts = v.log
      .filter((e) => e.a === 'y' || (e.a === 'n' && e.q != null))
      .map((e) => {
        const f = e.q != null && e.a === 'y' ? d?.questions[e.q]?.f : undefined;
        return `<li class="dn-f-${e.a}">${esc(f ?? e.text ?? '')}${f ? '' : ` — ${ANS[e.a!].toLowerCase()}`}</li>`;
      });
    if (!facts.length) return '';
    return `<div class="dn-note"><div class="dn-ask">Что выяснили:</div><ul>${facts.join('')}</ul></div>`;
  }

  private renderPanel() {
    keepDrafts(this.panel, () => this.drawPanel());
  }

  private drawPanel() {
    const v = this.v;
    if (!v) return;
    this.panel.innerHTML = '';
    if (this.ctx.demo) return;
    const mine = this.mine(v);
    const add = (html: string) => this.panel.appendChild(h(html));
    const btn = (label: string, fn: () => void, cls = 'btn') => {
      const b = h<HTMLButtonElement>(`<button class="${cls}">${label}</button>`);
      b.onclick = fn;
      this.panel.appendChild(b);
      return b;
    };

    if (v.phase === 'reveal') {
      const me = mine.find((x) => this.can(x));
      if (me != null) btn(v.n >= v.total ? 'К итогам' : 'Следующая данетка', () => this.send(me, { type: 'next' }), 'btn primary');
      return;
    }
    if (v.phase !== 'play') return;

    const amHost = v.host != null && mine.includes(v.host);
    // живой ведущий: разгадка (по нажатию), ответы
    if (amHost && v.secret) {
      const sec = h(`<div class="dn-secret${this.showSecret ? ' open' : ''}"><div class="dn-ask">🔦 Вы ведущий — разгадка ${this.showSecret ? '' : '(нажмите, чтобы открыть)'}</div>
        ${this.showSecret ? `<div class="dn-answer">${esc(v.secret.answer)}</div><div class="dn-hints-all">${v.secret.hints.map((t, i) => `<div>${i < v.hints.length ? '✓' : '·'} Подсказка ${i + 1}: ${esc(t)}</div>`).join('')}</div>` : ''}</div>`);
      sec.onclick = () => {
        this.showSecret = !this.showSecret;
        this.renderPanel();
      };
      this.panel.appendChild(sec);
      if (v.pending != null && this.can(v.host!)) {
        const e = v.log[v.pending];
        if (e.guess) {
          add(`<div class="dn-ask">${esc(this.plain(e.seat))} предлагает разгадку: «${esc(e.text || 'голосом')}»</div>`);
          const row = h('<div class="dn-row"></div>');
          for (const right of [true, false]) {
            const b = h<HTMLButtonElement>(`<button class="btn ${right ? 'dn-b-y' : 'dn-b-n'}">${right ? 'Верно!' : 'Не то'}</button>`);
            b.onclick = () => this.send(v.host!, { type: 'judge', right });
            row.appendChild(b);
          }
          this.panel.appendChild(row);
        } else {
          const hint = e.q != null ? ` <small>(по сценарию: ${ANS[v.secret.answers[e.q]].toLowerCase()})</small>` : '';
          add(`<div class="dn-ask">${esc(this.plain(e.seat))}: «${esc(e.text || 'вопрос голосом')}»${hint}</div>`);
          const row = h('<div class="dn-row"></div>');
          for (const a of ['y', 'n', 'i'] as const) {
            const b = h<HTMLButtonElement>(`<button class="btn dn-b-${a}">${ANS[a]}</button>`);
            b.onclick = () => this.send(v.host!, { type: 'answer', a });
            row.appendChild(b);
          }
          this.panel.appendChild(row);
        }
      } else if (!v.rules && this.can(v.host!)) {
        if (v.hints.length < v.totalHints) btn('🔎 Дать подсказку', () => this.send(v.host!, { type: 'hint' }));
        btn('Сдаёмся — рассказать ответ', () => confirm('Рассказать разгадку?') && this.send(v.host!, { type: 'giveup' }));
      } else if (v.pending == null) add(`<div class="dn-wait">Спрашивает ${esc(this.plain(v.turn))}…</div>`);
    }

    // ход игрока
    const me = v.turn;
    if (mine.includes(me) && this.can(me) && v.pending == null && me !== v.host) {
      add(`<div class="dn-ask">${mine.length > 1 ? esc(this.plain(me)) + ', ваш' : 'Ваш'} вопрос${v.rules ? ` (круг ${v.circle} из ${v.circles})` : ''}</div>`);
      if (live(v)) {
        this.panel.appendChild(this.textRow('Вопрос, на который можно ответить «да» или «нет»…', 'Спросить', (text) => this.send(me, { type: 'ask', text }), 'Спросил голосом', () => this.send(me, { type: 'ask', text: '' })));
        const guess = () => this.textRow('Что случилось?', 'Сказать', (text) => this.send(me, { type: 'guess', text }), 'Сказал голосом', () => this.send(me, { type: 'guess', text: '' }));
        if (this.guessOpen === me) this.panel.appendChild(guess());
        else {
          const g = btn('💡 Знаю разгадку!', () => {
            this.guessOpen = me;
            const row = guess();
            g.replaceWith(row);
            (row.querySelector('textarea') as HTMLTextAreaElement).focus();
          }, 'btn dn-guess');
        }
      } else {
        const asked = new Set(v.log.filter((e) => e.q != null).map((e) => e.q!));
        const qs = h('<div class="dn-qs"></div>');
        // порядок вопросов перемешан (свой у каждой данетки) — иначе сценарий читается как пересказ разгадки
        const order = v.questions.map((_, i) => i).sort((a, b) => mix(v.id * 131 + a) - mix(v.id * 131 + b));
        order.forEach((i) => {
          const q = v.questions[i];
          if (asked.has(i)) return;
          const b = h<HTMLButtonElement>(`<button class="btn dn-qbtn">${esc(q)}</button>`);
          b.onclick = () => this.send(me, { type: 'ask', q: i });
          qs.appendChild(b);
        });
        if (qs.children.length) this.panel.appendChild(qs);
        else add('<div class="dn-wait">Вопросы кончились — пора разгадывать!</div>');
        btn('💡 Знаю разгадку!', () => this.openOptions(v, me), 'btn dn-guess');
        if (!v.rules && v.hints.length < v.totalHints) btn(`🔎 Подсказка (${v.hints.length + 1} из ${v.totalHints})`, () => this.send(me, { type: 'hint' }));
      }
      if (!v.rules && !live(v)) btn('Сдаюсь — покажи ответ', () => confirm('Показать разгадку?') && this.send(me, { type: 'giveup' }));
    } else if (!amHost && v.phase === 'play') {
      add(`<div class="dn-wait">${v.pending != null ? `Ведущий ${v.host != null ? esc(this.plain(v.host)) + ' ' : ''}думает…` : `Спрашивает ${esc(this.plain(v.turn))}…`}</div>`);
    }
    add(this.notebook(v) || '<div class="dn-note dn-empty">Здесь соберётся всё, что ответили «да».</div>');
  }

  private textRow(ph: string, label: string, fn: (t: string) => void, voiceLabel: string, voice: () => void): HTMLElement {
    const el = h(`<div class="dn-own"><textarea rows="2" maxlength="300" placeholder="${esc(ph)}"></textarea><div class="dn-row"></div></div>`);
    const ta = el.querySelector('textarea') as HTMLTextAreaElement;
    const row = el.querySelector('.dn-row') as HTMLElement;
    const b = h<HTMLButtonElement>(`<button class="btn primary">${esc(label)}</button>`);
    b.onclick = () => ta.value.trim() && fn(ta.value.trim());
    ta.onkeydown = (e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), b.click());
    const vb = h<HTMLButtonElement>(`<button class="btn">${esc(voiceLabel)}</button>`);
    vb.onclick = voice;
    row.append(b, vb);
    return el;
  }

  /** Четыре варианта разгадки (с ботом-ведущим). */
  private openOptions(v: View, me: number) {
    this.sheet.innerHTML = `<div class="dn-sheet-box"><div class="dn-sheet-head"><b>Что случилось?</b><button class="btn dn-x">✕</button></div>
      <div class="dn-opts">${v.options.map((o, i) => `<button class="dn-opt" data-i="${i}"${v.wrongOpts.includes(i) ? ' disabled' : ''}>${esc(o)}</button>`).join('')}</div>
      <div class="dn-sub">${v.rules ? 'Не угадаете — ход перейдёт.' : 'Не угадаете — вариант вычеркнут.'}</div></div>`;
    (this.sheet.querySelector('.dn-x') as HTMLElement).onclick = () => (this.sheet.hidden = true);
    this.sheet.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => (b.onclick = () => this.send(me, { type: 'guess', opt: +b.dataset.i! })));
    this.sheet.hidden = false;
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.v = v;
    this.draw();
    this.renderPanel();
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'start') {
        this.showSecret = false;
        this.guessOpen = -1;
        Sound.card();
      } else if (ev.type === 'entry') {
        Sound.chat();
        if (v.host != null && this.ctx.mySeats.includes(v.host) && v.pending != null) Sound.turn();
      } else if (ev.type === 'answer' || ev.type === 'judge') Sound.step();
      else if (ev.type === 'hint') {
        Sound.ui();
        await sleep(400 / speed);
      } else if (ev.type === 'end') {
        this.v = v;
        this.draw();
        if (ev.result.solver != null) Sound.win();
        else Sound.nomove();
        await sleep(600 / speed);
      }
    }
    this.v = v;
    this.draw();
    this.renderPanel();
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.interactive = interactive;
    if (this.v?.phase !== 'play') this.sheet.hidden = true;
    this.draw();
    this.renderPanel();
  }

  status(v: View, _toAct: number[], interactive: number[]) {
    const nm = (p: number) => this.ctx.name(p);
    if (v.phase === 'over') return 'Игра окончена';
    if (v.phase === 'reveal') return v.last?.solver != null ? `Разгадал ${nm(v.last.solver)}` : 'Никто не разгадал';
    if (v.pending != null) return interactive.includes(v.host!) ? 'Ответьте игроку' : 'Ведущий отвечает…';
    return interactive.includes(v.turn) ? 'Ваш вопрос' : `Спрашивает ${nm(v.turn)}…`;
  }

  playerStats(v: View, seat: number) {
    if (v.host === seat) return 'ведущий';
    return v.rules ? `${v.scores[seat] ?? 0} очк.` : '';
  }
}

export function createView(): GameView<View, Event> {
  return new DanetkiView();
}

/* «Детективы» — отрисовка: картонная папка «Дело №», лист с машинописным текстом, четыре версии на карточках,
 * наводки — на скрепке, разгадка — под штампом «РАСКРЫТО». Тексты дел грузятся из public/detektiv/cases/<книга>.json. */
import { Sound } from '../../core/audio';
import { esc, h } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { markSeen, seenList } from '../../core/seen';
import { fmtSec } from './def';
import { bookOf, canSwap, PAR, PTS, rank, SHARED, type BoardView, type Event, type View } from './engine';
import './detektiv.css';

const BASE = `${import.meta.env.BASE_URL}detektiv/`;

export interface CaseText {
  title: string;
  text: string;
  question: string;
  options: string[];
  img: string[];
}

const books = new Map<string, Promise<Record<string, CaseText>>>();
export function loadBook(book: string): Promise<Record<string, CaseText>> {
  let p = books.get(book);
  if (!p) {
    p = fetch(`${BASE}cases/${book}.json`).then((r) => (r.ok ? r.json() : {}));
    p.catch(() => books.delete(book));
    books.set(book, p);
  }
  return p;
}

const LV = ['', 'лёгкое', 'среднее', 'трудное'];
const ABC = 'АБВГ';

/** Текст дела в HTML: абзацы через пустую строку, реплики — с новой строки. */
function prose(t: string): string {
  return t
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.split('\n').map(esc).join('<br>')}</p>`)
    .join('');
}

class DetektivView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private sheet!: HTMLElement;
  private ctl!: HTMLElement;
  private v: View | null = null;
  private seat = -1;
  private key = '';
  private txt: CaseText | null = null;
  private clockEl: HTMLElement | null = null;
  private tick: ReturnType<typeof setInterval> | undefined;
  private msgEl: HTMLElement | null = null;
  private draft = '';
  private rkey = '';
  private free: HTMLElement | null = null;
  private freeKey = '';
  /** Список прочитанного столу уже отдали. */
  private told = false;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="dk-wrap"><div class="dk-folder"><div class="dk-sheet"></div></div></div>`);
    this.sheet = this.root.querySelector('.dk-sheet')!;
    root.appendChild(this.root);
    this.ctl = h(`<div class="dk-ctl"></div>`);
    ctx.controls.appendChild(this.ctl);
    this.tick = setInterval(() => this.clock(), 500);
  }

  destroy() {
    clearInterval(this.tick);
  }

  private pickSeat(v: View): number {
    const mine = this.ctx.demo ? v.seats : this.ctx.mySeats.filter((s) => v.seats.includes(s));
    if (!mine.length) return v.seats[0];
    if (v.shared) return mine.includes(this.seat) ? this.seat : mine[0];
    if (mine.includes(this.seat) && v.boards[this.seat].i < v.total) return this.seat;
    return mine.find((s) => v.boards[s].i < v.total) ?? mine[0];
  }

  private board(v: View, seat: number): BoardView {
    return v.boards[v.shared ? SHARED : seat];
  }

  setView(v: View) {
    this.v = v;
    const seat = this.pickSeat(v);
    this.seat = seat;
    const b = this.board(v, seat);
    this.seen(v, b);
    const key = `${seat}:${b.i}:${b.cur?.id}:${v.total}`;
    if (key !== this.key) {
      this.key = key;
      this.draft = '';
      this.txt = null;
      this.root.scrollTop = 0;
      if (b.cur) {
        const id = b.cur.id;
        this.ctx.hold?.(8000);
        loadBook(b.cur.book)
          .then((m) => {
            if (this.key !== key) return;
            this.txt = m[String(id)] ?? null;
            this.render();
          })
          .catch(() => this.render())
          .finally(() => this.ctx.hold?.(0));
      }
    }
    this.render();
  }

  /** Своё прочитанное — столу (один раз); открытую разгадку — себе в список. */
  private seen(v: View, b: BoardView) {
    if (this.ctx.demo) return;
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    if (!mine.length) return;
    if (!this.told) {
      this.told = true;
      void seenList('detektiv').then((ids) => ids.length && this.ctx.act(mine[0], { t: 'seen', ids }));
    }
    if (b.cur?.sol) markSeen('detektiv', [b.cur.id]);
  }

  async play(events: Event[], v: View) {
    for (const e of events) {
      const mine = v.shared || e.seat === this.seat;
      if (!mine) continue;
      if (e.type === 'wrong') {
        if (e.seat === this.seat || v.cfg.mode === 'team') Sound.nomove();
      } else if (e.type === 'solved') Sound.win();
      else if (e.type === 'hint') Sound.pen();
    }
    this.setView(v);
  }

  setTurn() {
    if (this.v) this.controls(this.v);
  }

  status(v: View): string {
    const b = this.board(v, this.seat);
    if (!b) return '';
    if (b.i >= v.total) return 'Все дела закрыты';
    if (b.phase === 'done') return 'Дело закрыто — дальше!';
    if (b.phase === 'check') return 'Сверьте свою версию с разгадкой';
    if ((b.out ?? []).includes(this.seat)) return 'Вы выбыли из этого дела — ждём остальных';
    return `Дело ${b.i + 1} из ${v.total}`;
  }

  playerStats(v: View, seat: number): string {
    const sc = v.scores[seat] ?? 0;
    const b = this.board(v, seat);
    const out = v.cfg.mode === 'race' && (b?.out ?? []).includes(seat) ? ' · выбыл' : '';
    return `<b>${sc}</b> очк.${out}`;
  }

  // ---------------------------------------------------------------- лист

  private render() {
    const v = this.v;
    if (!v) return;
    const b = this.board(v, this.seat);
    // «думаю» ботов шлёт снимки постоянно — лист перестраиваем, только когда в деле что-то изменилось (иначе слетает ввод и прокрутка)
    const rk = `${this.key}:${b.phase}:${b.hints}:${b.wrongs.join()}:${(b.out ?? []).join()}:${b.marks.length}:${!!this.txt}:${b.i >= v.total ? Object.values(v.scores).join() : ''}`;
    if (rk === this.rkey) {
      this.controls(v);
      return;
    }
    this.rkey = rk;
    const top = this.root.scrollTop;
    const same = this.sheet.childElementCount > 1;
    this.sheet.innerHTML = '';
    this.clockEl = null;
    this.msgEl = null;
    if (b.i >= v.total || !b.cur) {
      this.sheet.appendChild(this.final(v));
      this.controls(v);
      return;
    }
    const c = b.cur;
    const bk = bookOf(c.book);
    const head = h(`<header class="dk-head">
      <span class="dk-no">ДЕЛО № ${b.i + 1}<small> из ${v.total}</small></span>
      <span class="dk-book">${esc(bk.title)}</span>
      <span class="dk-lv dk-lv${c.lv}">${LV[c.lv]} · до ${PTS[c.lv as 1 | 2 | 3]} очк.</span>
      <span class="dk-par" title="раскрыть в срок — +1">⏱ ${fmtSec(PAR[c.lv as 1 | 2 | 3])}</span>
      <span class="dk-clock"></span>
    </header>`);
    this.clockEl = head.querySelector('.dk-clock');
    this.sheet.appendChild(head);
    const t = this.txt;
    if (!t) {
      this.sheet.appendChild(h(`<p class="dk-wait">Достаём дело из архива…</p>`));
      this.controls(v);
      return;
    }
    this.sheet.appendChild(h(`<h2 class="dk-title">${esc(t.title)}</h2>`));
    if (t.img.length) {
      const g = h(`<div class="dk-pics${t.img.length > 2 ? ' many' : ''}"></div>`);
      t.img.forEach((src, k) => {
        const im = h<HTMLImageElement>(`<img src="${BASE}img/${encodeURIComponent(src)}" alt="картинка ${k + 1}" loading="lazy">`);
        im.onclick = () => im.classList.toggle('zoom');
        g.appendChild(im);
      });
      this.sheet.appendChild(g);
    }
    this.sheet.appendChild(h(`<div class="dk-text">${prose(t.text)}</div>`));
    this.sheet.appendChild(h(`<p class="dk-q">${esc(t.question)}</p>`));

    if (c.hints.length) this.sheet.appendChild(h(`<ul class="dk-hints">${c.hints.map((x, k) => `<li><b>Наводка ${k + 1}.</b> ${esc(x)}</li>`).join('')}</ul>`));

    const sol = c.sol;
    const mineNow = this.ctx.mySeats.includes(this.seat) && !this.ctx.demo;
    const out = (b.out ?? []).includes(this.seat);
    if (v.cfg.answer === 'choice') {
      const box = h(`<div class="dk-opts"></div>`);
      t.options.forEach((o, k) => {
        const crossed = b.wrongs.includes(k);
        const right = sol && sol.ok === k;
        const btn = h<HTMLButtonElement>(`<button class="dk-opt${crossed ? ' wrong' : ''}${right ? ' right' : ''}"><span class="dk-abc">${ABC[k]}</span><span>${esc(o)}</span></button>`);
        btn.disabled = !mineNow || b.phase !== 'solve' || crossed || out;
        btn.onclick = () => this.ctx.act(this.seat, { t: 'pick', k });
        box.appendChild(btn);
      });
      this.sheet.appendChild(box);
    } else if (b.phase === 'solve') {
      // поле ввода одно на дело: перестройка листа (наводка, ход соперника) не сбивает набор и фокус
      if (!this.free || this.freeKey !== this.key) {
        this.free = h(`<div class="dk-free"><textarea rows="3" placeholder="Ваша версия: что произошло и какая улика это выдаёт?"></textarea></div>`);
        this.freeKey = this.key;
        const ta = this.free.querySelector('textarea')!;
        ta.oninput = () => (this.draft = ta.value);
      }
      const ta = this.free.querySelector('textarea')!;
      const focused = document.activeElement === ta;
      ta.disabled = !mineNow;
      this.sheet.appendChild(this.free);
      if (focused) ta.focus();
    } else if (b.text) {
      this.sheet.appendChild(h(`<div class="dk-mine"><b>Версия${v.shared && b.by != null ? ` (${this.ctx.name(b.by)})` : ''}:</b> ${esc(b.text)}</div>`));
    }
    this.msgEl = h(`<div class="dk-msg"></div>`);
    this.sheet.appendChild(this.msgEl);
    if (out && b.phase === 'solve') this.flash('Вы выбыли из этого дела — ждём, раскроют ли его остальные.', 'warn');

    if (sol) {
      const m = b.phase === 'done' ? b.marks[b.marks.length - 1] : null;
      const verdict = m
        ? m.ok
          ? `<div class="dk-stamp ok">РАСКРЫТО</div><div class="dk-pts">+${m.pts} · ${fmtSec(m.sec)}${m.hints ? ` · наводок ${m.hints}` : ''}${m.wrong ? ` · ошибок ${m.wrong}` : ''}${m.par ? ' · в срок +1' : ''}${v.shared && b.by != null ? ` · ${this.ctx.name(b.by)}` : ''}</div>`
          : `<div class="dk-stamp fail">НЕ РАСКРЫТО</div>`
        : '';
      this.sheet.appendChild(
        h(`<section class="dk-sol">${verdict}<h3>Разгадка</h3><p class="dk-short">${esc(sol.short)}</p>${prose(sol.answer)}</section>`),
      );
    }
    this.controls(v);
    this.clock();
    if (same) this.root.scrollTop = top;
    if (sol && b.phase === 'done') {
      const s = this.sheet.querySelector('.dk-sol');
      requestAnimationFrame(() => s?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  }

  private final(v: View): HTMLElement {
    const rows = v.seats
      .map((s) => ({ s, sc: v.scores[s] ?? 0 }))
      .sort((x, y) => y.sc - x.sc)
      .map((x) => `<tr${x.s === this.seat ? ' class="me"' : ''}><td>${this.ctx.name(x.s)}</td><td>${x.sc}</td><td>${rank(x.sc, v.max).title}</td></tr>`)
      .join('');
    const b = this.board(v, this.seat);
    const my = v.scores[this.seat] ?? 0;
    const r = rank(my, v.max);
    const solved = b.marks.filter((m) => m.ok).length;
    const who = v.cfg.mode === 'team' ? 'Бригада' : this.ctx.name(this.seat);
    return h(`<div class="dk-final">
      <div class="dk-cert"><div class="dk-medal">${r.icon}</div><div class="dk-cert-t">УДОСТОВЕРЕНИЕ</div><h2>${r.title}</h2>
      <p>${who} — ${my} очков из ${v.max}, раскрыто дел: ${solved} из ${v.total}.</p></div>
      ${v.seats.length > 1 && v.cfg.mode !== 'team' ? `<table class="dk-rank"><tr><th>Кто</th><th>Очки</th><th>Звание</th></tr>${rows}</table>` : ''}
    </div>`);
  }

  // ---------------------------------------------------------------- кнопки

  private ctlKey = '';

  private controls(v: View) {
    const b = this.board(v, this.seat);
    const key = `${this.seat}:${b?.i}:${b?.cur?.id}:${b?.phase}:${b?.hints}:${(b?.out ?? []).join()}:${(b?.ready ?? []).join()}:${!!this.txt}:${this.ctx.mySeats.join(',')}`;
    if (key === this.ctlKey) return;
    this.ctlKey = key;
    this.ctl.innerHTML = '';
    if (this.ctx.demo || !b) return;
    const seat = this.seat;
    if (!this.ctx.mySeats.includes(seat) || b.i >= v.total) return;
    if (b.phase === 'done') {
      const waiting = v.cfg.mode === 'race' && (b.ready ?? []).includes(seat);
      const next = h<HTMLButtonElement>(`<button class="btn primary" data-tap>${waiting ? 'Ждём остальных…' : b.i + 1 >= v.total ? 'К итогам' : 'Следующее дело →'}</button>`);
      next.disabled = waiting;
      next.onclick = () => this.ctx.act(seat, { t: 'next' });
      this.ctl.appendChild(next);
      return;
    }
    if (b.phase === 'check') {
      if (v.cfg.mode === 'team' || b.by === seat) {
        this.ctl.appendChild(h(`<div class="dk-ctl-t">Сверьте с разгадкой:</div>`));
        for (const [val, label] of [
          [2, 'Угадал'],
          [1, 'Частично'],
          [0, 'Не угадал'],
        ] as const) {
          const bt = h<HTMLButtonElement>(`<button class="btn${val === 2 ? ' primary' : ''}">${label}</button>`);
          bt.onclick = () => this.ctx.act(seat, { t: 'self', v: val });
          this.ctl.appendChild(bt);
        }
      }
      return;
    }
    if ((b.out ?? []).includes(seat)) return;
    if (v.cfg.answer === 'free') {
      const send = h<HTMLButtonElement>(`<button class="btn primary">Записать версию</button>`);
      send.onclick = () => {
        const text = this.draft.trim();
        if (!text) {
          this.flash('Сначала запишите свою версию.', 'warn');
          return;
        }
        this.ctx.act(seat, { t: 'free', text });
      };
      this.ctl.appendChild(send);
    }
    const hint = h<HTMLButtonElement>(`<button class="btn" title="Наводка стоит очко">🔎 Наводка ${b.hints}/2</button>`);
    hint.disabled = b.hints >= 2;
    hint.onclick = () => this.ctx.act(seat, { t: 'hint' });
    const skip = h<HTMLButtonElement>(`<button class="btn">${v.cfg.mode === 'race' ? 'Пас' : 'Сдаться'}</button>`);
    skip.onclick = () => {
      const q = v.cfg.mode === 'race' ? 'Выбыть из этого дела?' : 'Сдаться? Покажут разгадку, очков за дело не будет.';
      if (confirm(q)) this.ctx.act(seat, { t: 'skip' });
    };
    this.ctl.append(hint, skip);
    if (b.cur && canSwap(v, b.i)) {
      const id = b.cur.id;
      const swap = h<HTMLButtonElement>(`<button class="btn dk-swap" title="Это дело уже знакомо — взять другое">🔄 Уже читал — другое дело</button>`);
      swap.onclick = () => {
        if (!confirm(v.shared || v.seats.length > 1 ? 'Заменить дело? Возьмём другое такой же трудности — для всех за столом.' : 'Заменить дело? Возьмём другое такой же трудности.')) return;
        markSeen('detektiv', [id]);
        this.ctx.act(seat, { t: 'swap' });
      };
      this.ctl.appendChild(swap);
    }
  }

  private flash(text: string, cls = '') {
    if (!this.msgEl) return;
    this.msgEl.textContent = text;
    this.msgEl.className = 'dk-msg' + (cls ? ' ' + cls : '');
  }

  private clock() {
    if (!this.clockEl || !this.v) return;
    const b = this.board(this.v, this.seat);
    if (!b || b.phase !== 'solve') {
      const m = b?.phase === 'done' ? b.marks[b.marks.length - 1] : null;
      this.clockEl.textContent = m ? fmtSec(m.sec) : '';
      return;
    }
    const sec = Math.max(0, Math.floor((Date.now() - b.t0) / 1000));
    this.clockEl.textContent = fmtSec(sec);
    this.clockEl.classList.toggle('over', !!b.cur && sec > PAR[b.cur.lv as 1 | 2 | 3]);
  }
}

export function createView(): GameView<View, Event> {
  return new DetektivView();
}

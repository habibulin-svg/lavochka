/* Балда — отрисовка: тетрадный лист в клеточку, поле синей ручкой, буквы от руки, по бокам — столбики слов игроков.
 * Ход: нажать пустую клетку рядом с буквами → набрать букву (клавиатура или экранная) → провести слово по клеткам
 * (нажимать по очереди или вести пальцем) → «Слово!». Под полем — какое слово выходит и годится ли оно. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { ALPHABET, norm } from '../../words/dict';
import { check, neighbors, openCells, type Action, type Event, type State } from './engine';
import './balda.css';

const KEYS = ['йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю'];

class BaldaView implements GameView<State, Event> {
  private ctx!: ViewCtx<Action>;
  private wrap!: HTMLElement;
  private board!: HTMLElement;
  private lists: HTMLElement[] = [];
  private say!: HTMLElement;
  private ctl!: HTMLElement;
  private s: State | null = null;
  private actSeat: number | null = null;
  // черновик хода
  private cell: number | null = null;
  private letter = '';
  private path: number[] = [];
  private dragging = false;
  private flash: number[] = [];

  mount(root: HTMLElement, ctx: ViewCtx<Action>) {
    this.ctx = ctx;
    this.wrap = h(`<div class="bd-wrap"><div class="bd-sheet">
        <div class="bd-col bd-left"></div>
        <div class="bd-mid"><div class="bd-board"></div><div class="bd-say"></div></div>
        <div class="bd-col bd-right"></div>
      </div></div>`);
    root.appendChild(this.wrap);
    this.board = this.wrap.querySelector('.bd-board') as HTMLElement;
    this.say = this.wrap.querySelector('.bd-say') as HTMLElement;
    this.ctl = h(`<div class="bd-controls"></div>`);
    ctx.controls.appendChild(this.ctl);
    this.board.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', this.onKey);
  }

  destroy() {
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
  }

  // ---------------------------------------------------------------- ввод

  private canAct() {
    return this.actSeat != null && !!this.s && !this.s.over && !this.ctx.demo;
  }

  private cellOf(el: Element | null): number | null {
    const c = (el as HTMLElement | null)?.closest?.('.bd-cell') as HTMLElement | null;
    return c ? Number(c.dataset.c) : null;
  }

  private letterAt(c: number) {
    return this.s!.grid[c] || (c === this.cell ? this.letter : '');
  }

  private adj(a: number, b: number) {
    return neighbors(this.s!.cfg, a).includes(b);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.canAct()) return;
    const c = this.cellOf(e.target as Element);
    if (c == null) return;
    e.preventDefault();
    Sound.unlock();
    const s = this.s!;
    if (!s.grid[c] && (c !== this.cell || !this.letter)) {
      if (openCells(s).includes(c)) {
        this.cell = c;
        this.letter = '';
        this.path = [];
      }
      this.render();
      return;
    }
    if (!this.letterAt(c)) return;
    const p = this.path;
    if (p.length && p[p.length - 1] === c) p.pop();
    else if (p.length && !p.includes(c) && this.adj(p[p.length - 1], c)) p.push(c);
    else this.path = [c];
    this.dragging = true;
    this.render();
  };

  private onMove = (e: PointerEvent) => {
    if (!this.dragging || !this.canAct()) return;
    const c = this.cellOf(document.elementFromPoint(e.clientX, e.clientY));
    if (c == null || !this.letterAt(c)) return;
    const p = this.path;
    const end = p[p.length - 1];
    if (c === end) return;
    if (p.length >= 2 && p[p.length - 2] === c) p.pop();
    else if (!p.includes(c) && this.adj(end, c)) p.push(c);
    else return;
    this.render();
  };

  private onUp = () => {
    this.dragging = false;
  };

  private onKey = (e: KeyboardEvent) => {
    if (!this.canAct() || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
    const k = norm(e.key);
    if (k.length === 1 && ALPHABET.includes(k)) {
      if (this.cell == null) return;
      this.typeLetter(k);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      this.submit();
      e.preventDefault();
    } else if (e.key === 'Backspace') {
      if (this.path.length) this.path.pop();
      else this.letter = '';
      this.render();
      e.preventDefault();
    } else if (e.key === 'Escape') this.reset();
  };

  private typeLetter(k: string) {
    this.letter = k;
    // новая буква — убрать из пути, если её там уже не может быть
    this.path = this.path.filter((c) => c !== this.cell);
    Sound.place();
    this.render();
  }

  private reset() {
    this.cell = null;
    this.letter = '';
    this.path = [];
    this.render();
  }

  private verdict() {
    if (this.cell == null) return { ok: false as const, why: 'Нажмите пустую клетку рядом с буквами.' };
    if (!this.letter) return { ok: false as const, why: 'Наберите букву.' };
    if (!this.path.length) return { ok: false as const, why: 'Проведите слово по клеткам — новая буква должна в него войти.' };
    return check(this.s!, { cell: this.cell, letter: this.letter, path: this.path });
  }

  private submit() {
    if (!this.canAct()) return;
    const v = this.verdict();
    if (!v.ok || this.cell == null) return;
    const seat = this.actSeat!;
    const a: Action = { type: 'word', cell: this.cell, letter: this.letter, path: this.path.slice() };
    this.actSeat = null;
    this.ctx.act(seat, a);
  }

  // ---------------------------------------------------------------- рисунок

  private render() {
    const s = this.s;
    if (!s) return;
    const n = s.cfg.size;
    this.board.style.setProperty('--n', String(n));
    const lastNew = s.last?.cell;
    const lastPath = new Set(s.last?.path ?? []);
    const open = this.canAct() ? new Set(openCells(s)) : new Set<number>();
    const pathIdx = new Map(this.path.map((c, i) => [c, i]));
    let html = '';
    for (let c = 0; c < n * n; c++) {
      const ch = this.letterAt(c);
      const cls = ['bd-cell'];
      if (s.grid[c]) cls.push('full');
      if (c === this.cell) cls.push('draft');
      else if (open.has(c) && this.cell == null) cls.push('open');
      if (pathIdx.has(c)) cls.push('path');
      else if (this.flash.includes(c)) cls.push('flash');
      else if (lastPath.has(c) && !this.path.length) cls.push('last');
      if (c === lastNew && !pathIdx.has(c)) cls.push('new');
      const idx = pathIdx.has(c) ? `<i>${pathIdx.get(c)! + 1}</i>` : '';
      html += `<div class="${cls.join(' ')}" data-c="${c}"><span>${ch ? ch.toUpperCase() : ''}</span>${idx}</div>`;
    }
    this.board.innerHTML = html;
    this.renderLists();
    this.renderSay();
    this.renderControls();
  }

  private renderLists() {
    const s = this.s!;
    const left = this.wrap.querySelector('.bd-left') as HTMLElement;
    const right = this.wrap.querySelector('.bd-right') as HTMLElement;
    left.innerHTML = '';
    right.innerHTML = '';
    this.lists = [];
    s.players.forEach((p, i) => {
      const cur = !s.over && s.players[s.cur].seat === p.seat;
      const el = h(`<div class="bd-list${cur ? ' cur' : ''}${p.out ? ' out' : ''}">
          <div class="bd-who">${this.ctx.name(p.seat)}</div>
          <ol>${p.words.map((w) => `<li>${esc(w)}<b>${w.length}</b></li>`).join('')}</ol>
          <div class="bd-sum">${p.score}</div>
        </div>`);
      (i % 2 ? right : left).appendChild(el);
      this.lists.push(el);
    });
  }

  private renderSay() {
    const s = this.s!;
    if (!this.canAct()) {
      this.say.innerHTML = s.over ? '' : `<span class="bd-start">Начальное слово: <b>${esc(s.start.toUpperCase())}</b></span>`;
      return;
    }
    const word = this.path.map((c) => this.letterAt(c)).join('');
    const v = this.verdict();
    this.say.innerHTML = word
      ? `<b class="bd-word ${v.ok ? 'ok' : 'bad'}">${esc(word.toUpperCase())}</b> <span>${v.ok ? `+${word.length}` : esc(v.why)}</span>`
      : `<span>${esc(v.ok ? '' : v.why)}</span>`;
  }

  private renderControls() {
    this.ctl.innerHTML = '';
    if (!this.canAct()) return;
    const v = this.verdict();
    const kb = this.cell != null
      ? `<div class="bd-kb">${KEYS.map((row) => `<div>${[...row].map((k) => `<button class="bd-key${k === this.letter ? ' on' : ''}" data-k="${k}">${k.toUpperCase()}</button>`).join('')}</div>`).join('')}</div>`
      : '';
    const el = h(`<div class="bd-ctl">${kb}
        <button class="btn primary bd-go"${v.ok ? '' : ' disabled'}>Слово!</button>
        <div class="bd-row"><button class="btn bd-reset">Стереть</button><button class="btn bd-pass">Пропустить ход</button></div>
        <button class="btn bd-resign">Сдаться</button>
      </div>`);
    el.querySelectorAll<HTMLButtonElement>('.bd-key').forEach((b) => (b.onclick = () => this.typeLetter(b.dataset.k!)));
    (el.querySelector('.bd-go') as HTMLButtonElement).onclick = () => this.submit();
    (el.querySelector('.bd-reset') as HTMLButtonElement).onclick = () => this.reset();
    (el.querySelector('.bd-pass') as HTMLButtonElement).onclick = () => {
      const seat = this.actSeat!;
      this.actSeat = null;
      this.ctx.act(seat, { type: 'pass' });
    };
    (el.querySelector('.bd-resign') as HTMLButtonElement).onclick = () => {
      if (!confirm('Сдаться?')) return;
      const seat = this.actSeat!;
      this.actSeat = null;
      this.ctx.act(seat, { type: 'resign' });
    };
    this.ctl.appendChild(el);
  }

  setView(v: State) {
    this.s = v;
    this.render();
  }

  async play(events: Event[], v: State) {
    const speed = this.ctx.speed();
    for (const ev of events) {
      if (ev.type !== 'word' || !this.s) continue;
      // буква появляется, потом слово подсвечивается по буквам
      const s = { ...this.s, grid: this.s.grid.slice(), last: null };
      s.grid[ev.cell] = ev.letter;
      this.s = s;
      this.cell = null;
      this.letter = '';
      this.path = [];
      this.flash = [];
      this.render();
      Sound.place();
      await sleep(250 / speed);
      for (const c of ev.path) {
        this.flash.push(c);
        this.render();
        Sound.step();
        await sleep(140 / speed);
      }
      await sleep(350 / speed);
      this.flash = [];
    }
    this.s = v;
    this.render();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const seat = interactive.find((x) => toAct.includes(x)) ?? null;
    if (seat !== this.actSeat) {
      this.cell = null;
      this.letter = '';
      this.path = [];
    }
    this.actSeat = seat;
    if (seat != null) Sound.turn();
    this.render();
  }

  status(s: State, toAct: number[], interactive: number[]) {
    if (s.over) return 'Партия окончена';
    const who = toAct[0];
    return interactive.includes(who) ? `Ваш ход: ${this.ctx.name(who)}` : `Думает ${this.ctx.name(who)}…`;
  }

  playerStats(s: State, seat: number) {
    const p = s.players.find((x) => x.seat === seat);
    return p ? `<span title="Очки — буквы во всех словах">очков: ${p.score}, слов: ${p.words.length}</span>` : '';
  }
}

export function createView(): GameView<State, Event> {
  return new BaldaView();
}

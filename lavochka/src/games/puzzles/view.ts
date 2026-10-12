/* «Головоломки» — отрисовка: газетная страница с сеткой. Судоку — цифры, карандашные пометки, подсветка строки/столбца/квадрата;
 * пикросс — числа над столбцами и слева от строк, закраска протягиванием. Чужие курсоры — рамкой цвета игрока.
 * Недорешённое сохраняется на каждом ходу (saves.ts). */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import { fillOf, progress, type Event, type State } from './engine';
import { addSolved, dropSave, fmtTime, getSave, keyOf, optsOf, putSave, titleOf } from './saves';
import { cluesOf } from './picross';
import './puzzles.css';

class PuzzlesView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private board!: HTMLElement;
  private info!: HTMLElement;
  private clock!: HTMLElement;
  private ctl!: HTMLElement;
  private s: State | null = null;
  private built = '';
  private cellsEl: HTMLElement[] = [];
  private rowClues: HTMLElement[] = [];
  private colClues: HTMLElement[] = [];
  private sel = -1;
  private pencil = false;
  /** Пикросс: режим «✕» вместо закраски (для телефона). */
  private crossMode = false;
  private drag: { v: string; start: number; cells: number[]; axis: 'r' | 'c' | null } | null = null;
  private seat: number | null = null;
  private curTimer: ReturnType<typeof setTimeout> | undefined;
  private elapsed = 0;
  private tick: ReturnType<typeof setInterval> | undefined;
  private saveKey = '';
  private onKey = (e: KeyboardEvent) => this.key(e);

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="pz-wrap"><div class="pz-paper">
      <header class="pz-head"><span class="pz-mast">Головоломки</span><span class="pz-info"></span><span class="pz-clock"></span></header>
      <div class="pz-board"></div>
    </div></div>`);
    root.appendChild(this.root);
    this.board = this.root.querySelector('.pz-board') as HTMLElement;
    this.info = this.root.querySelector('.pz-info') as HTMLElement;
    this.clock = this.root.querySelector('.pz-clock') as HTMLElement;
    this.ctl = h(`<div class="pz-ctl"></div>`);
    ctx.controls.appendChild(this.ctl);
    if (!ctx.demo) {
      document.addEventListener('keydown', this.onKey);
      this.tick = setInterval(() => {
        if (!this.s || this.s.done || document.hidden) return;
        this.elapsed++;
        this.clock.textContent = fmtTime(this.elapsed);
        if (this.elapsed % 15 === 0) this.save();
      }, 1000);
    }
    this.board.addEventListener('contextmenu', (e) => e.preventDefault());
    this.board.addEventListener('pointerdown', (e) => this.down(e));
    this.board.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', this.up);
  }

  destroy() {
    document.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pointerup', this.up);
    clearInterval(this.tick);
    clearTimeout(this.curTimer);
    this.save();
  }

  // ---------------------------------------------------------------- состояние

  setView(v: State) {
    const first = !this.s;
    this.s = v;
    const sig = `${v.kind}:${v.size}:${v.seed}`;
    if (sig !== this.built) this.build(v);
    if (first && !this.ctx.demo) {
      this.saveKey = keyOf(v);
      this.elapsed = getSave(this.saveKey)?.elapsed ?? 0;
      this.clock.textContent = fmtTime(this.elapsed);
    }
    this.draw();
    this.save();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'set' && !this.ctx.mySeats.includes(ev.seat)) Sound.place();
      if (ev.type === 'hint') Sound.ui();
      if (ev.type === 'solved') Sound.win();
    }
    const wasDone = this.s?.done;
    this.setView(v);
    if (v.done && !wasDone && !this.ctx.demo) {
      addSolved({ title: titleOf(v), elapsed: this.elapsed, hints: v.hints, at: Date.now() });
      dropSave(this.saveKey);
    }
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.seat = interactive[0] ?? null;
    this.root.classList.toggle('pz-locked', this.seat == null);
  }

  status(v: State) {
    if (v.done) return `Решено! Время ${fmtTime(this.elapsed)}${v.hints ? `, подсказок: ${v.hints}` : ''}.`;
    return `${titleOf(v)} — решено ${Math.round(progress(v) * 100)}%`;
  }

  playerStats(v: State, seat: number) {
    return `${v.credit[seat] ?? 0} кл.`;
  }

  private save() {
    const v = this.s;
    if (!v || this.ctx.demo || !this.saveKey || v.done) return;
    const p = progress(v);
    const fill = fillOf(v);
    // нетронутую головоломку не сохраняем
    if (!v.cells.some((c, i) => c && !v.fixed[i]) && !getSave(this.saveKey)) return;
    putSave({ key: this.saveKey, title: titleOf(v), opts: optsOf(v), fill, progress: p, elapsed: this.elapsed, at: Date.now() });
  }

  // ---------------------------------------------------------------- построение

  private build(v: State) {
    this.built = `${v.kind}:${v.size}:${v.seed}`;
    this.info.textContent = titleOf(v);
    this.board.innerHTML = '';
    this.cellsEl = [];
    this.rowClues = [];
    this.colClues = [];
    this.board.className = `pz-board pz-${v.kind}`;
    if (v.kind === 'sudoku') {
      this.board.style.setProperty('--cols', '9');
      this.board.style.setProperty('--rows', '9');
      for (let i = 0; i < 81; i++) {
        const r = Math.floor(i / 9);
        const c = i % 9;
        const el = h(`<div class="pz-c${c % 3 === 2 && c < 8 ? ' br' : ''}${r % 3 === 2 && r < 8 ? ' bb' : ''}" data-i="${i}"></div>`);
        this.board.appendChild(el);
        this.cellsEl.push(el);
      }
    } else {
      const d = v.data!;
      const rc = Math.max(1, ...d.rows.map((r) => r.length));
      const cc = Math.max(1, ...d.cols.map((r) => r.length));
      this.board.style.setProperty('--cols', String(rc + v.w));
      this.board.style.setProperty('--rows', String(cc + v.h));
      this.board.style.setProperty('--rc', String(rc));
      this.board.style.setProperty('--cc', String(cc));
      this.board.appendChild(h(`<div class="pz-corner" style="grid-column:1 / span ${rc};grid-row:1 / span ${cc}"></div>`));
      d.cols.forEach((clue, x) => {
        const el = h(`<div class="pz-cc${x % 5 === 4 && x < v.w - 1 ? ' br' : ''}" style="grid-column:${rc + x + 1};grid-row:1 / span ${cc}">${clue.map((n) => `<span>${n}</span>`).join('') || '<span>0</span>'}</div>`);
        this.board.appendChild(el);
        this.colClues.push(el);
      });
      d.rows.forEach((clue, y) => {
        const el = h(`<div class="pz-rc${y % 5 === 4 && y < v.h - 1 ? ' bb' : ''}" style="grid-column:1 / span ${rc};grid-row:${cc + y + 1}">${clue.map((n) => `<span>${n}</span>`).join('') || '<span>0</span>'}</div>`);
        this.board.appendChild(el);
        this.rowClues.push(el);
      });
      for (let i = 0; i < v.w * v.h; i++) {
        const x = i % v.w;
        const y = Math.floor(i / v.w);
        const el = h(`<div class="pz-c${x % 5 === 4 && x < v.w - 1 ? ' br' : ''}${y % 5 === 4 && y < v.h - 1 ? ' bb' : ''}" data-i="${i}" style="grid-column:${rc + x + 1};grid-row:${cc + y + 1}"></div>`);
        this.board.appendChild(el);
        this.cellsEl.push(el);
      }
    }
    this.buildControls(v);
  }

  private buildControls(v: State) {
    if (this.ctx.demo) {
      this.ctl.innerHTML = '';
      return;
    }
    const tools = `<div class="pz-tools"><button class="btn" data-a="hint">Подсказка</button><button class="btn" data-a="check">Проверить</button></div>`;
    if (v.kind === 'sudoku') {
      this.ctl.innerHTML = `<div class="pz-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button class="pz-key" data-d="${d}">${d}</button>`).join('')}
        <button class="pz-key pz-pencil" data-a="pencil" title="Карандаш: пометки (клавиша N)">✎</button><button class="pz-key" data-a="erase" title="Стереть (Backspace)">⌫</button></div>${tools}
        <p class="hint small-hint">Клавиши: цифры, стрелки, N — карандаш, Backspace — стереть.</p>`;
    } else {
      this.ctl.innerHTML = `<div class="seg pz-mode"><button data-m="fill" class="on">■ Закрасить</button><button data-m="cross">✕ Пусто</button></div>${tools}
        <p class="hint small-hint">Нажатие — закрасить, правая кнопка — крестик. Ведите, не отпуская, — вдоль строки или столбца.</p>`;
    }
    this.ctl.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => (b.onclick = () => this.digit(+b.dataset.d!)));
    this.ctl.querySelectorAll<HTMLButtonElement>('[data-m]').forEach(
      (b) =>
        (b.onclick = () => {
          this.crossMode = b.dataset.m === 'cross';
          this.ctl.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b));
        }),
    );
    const on = (a: string, f: () => void) => {
      const b = this.ctl.querySelector<HTMLButtonElement>(`[data-a=${a}]`);
      if (b) b.onclick = f;
    };
    on('pencil', () => this.togglePencil());
    on('erase', () => this.erase());
    on('hint', () => this.act({ type: 'hint', i: this.sel >= 0 ? this.sel : undefined }));
    on('check', () => this.act({ type: 'check' }));
  }

  private togglePencil() {
    this.pencil = !this.pencil;
    this.ctl.querySelector('[data-a=pencil]')?.classList.toggle('on', this.pencil);
  }

  // ---------------------------------------------------------------- отрисовка

  private draw() {
    const v = this.s!;
    const me = this.seat;
    const selD = this.sel >= 0 && v.kind === 'sudoku' ? v.cells[this.sel] : '';
    const others = new Map<number, number>();
    v.seats.forEach((st) => {
      if (st !== me && v.cur[st] >= 0) others.set(v.cur[st], st);
    });
    const wrong = new Set(v.wrong);
    for (let i = 0; i < this.cellsEl.length; i++) {
      const el = this.cellsEl[i];
      const c = v.cells[i];
      const fixed = v.fixed[i];
      const who = v.who[i];
      let cls = el.className.replace(/ (fx|on|peer|same|bad|fill|cross|oc|done)\b/g, '');
      if (fixed) cls += ' fx';
      if (wrong.has(i)) cls += ' bad';
      if (i === this.sel && !v.done) cls += ' on';
      if (others.has(i)) cls += ' oc';
      if (v.kind === 'sudoku') {
        if (this.sel >= 0 && !v.done && i !== this.sel && peers(this.sel, i)) cls += ' peer';
        if (selD && c === selD) cls += ' same';
        if (c) el.textContent = c;
        else if (v.notes[i]) el.innerHTML = `<div class="pz-notes">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<i>${v.notes[i] & (1 << (d - 1)) ? d : ''}</i>`).join('')}</div>`;
        else el.textContent = '';
        el.style.color = !fixed && who >= 0 ? SEATS[who].dark : '';
      } else {
        const pending = this.drag && this.drag.cells.includes(i) ? this.drag.v : null;
        const show = pending ?? c;
        if (show === '#') cls += ' fill';
        if (show === 'x') cls += ' cross';
        el.style.background = '';
      }
      if (v.done) cls += ' done';
      el.className = cls;
      el.style.setProperty('--oc', others.has(i) ? SEATS[others.get(i)!].color : 'transparent');
    }
    if (v.kind === 'picross') this.drawClues(v);
  }

  /** Пикросс: линия, где закрашенное совпало с числами, — числа бледнеют. */
  private drawClues(v: State) {
    const d = v.data!;
    for (let y = 0; y < v.h; y++) {
      const line = v.cells.slice(y * v.w, y * v.w + v.w).map((c) => (c === '#' ? 1 : 0));
      this.rowClues[y].classList.toggle('ok', same(cluesOf(line), d.rows[y]));
    }
    for (let x = 0; x < v.w; x++) {
      const line = Array.from({ length: v.h }, (_, y) => (v.cells[y * v.w + x] === '#' ? 1 : 0));
      this.colClues[x].classList.toggle('ok', same(cluesOf(line), d.cols[x]));
    }
  }

  // ---------------------------------------------------------------- ввод

  private act(a: any) {
    if (this.seat == null || !this.s || this.s.done) return;
    Sound.unlock();
    this.ctx.act(this.seat, a);
  }

  private cellAt(e: PointerEvent): number {
    const t = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('.pz-c');
    return t && this.board.contains(t) ? Number(t.dataset.i) : -1;
  }

  private select(i: number) {
    this.sel = i;
    this.draw();
    clearTimeout(this.curTimer);
    // свой курсор показываем остальным с небольшой задержкой — не шлём каждое движение
    if (this.ctx.online || (this.s && this.s.seats.length > 1))
      this.curTimer = setTimeout(() => {
        if (this.s && this.seat != null && this.s.cur[this.seat] !== this.sel) this.act({ type: 'cur', i: this.sel });
      }, 250);
  }

  private down(e: PointerEvent) {
    const v = this.s;
    if (!v || v.done || this.seat == null || this.ctx.demo) return;
    const i = this.cellAt(e);
    if (i < 0) return;
    if (v.kind === 'sudoku') {
      this.select(i);
      return;
    }
    if (v.fixed[i]) return;
    e.preventDefault();
    const cross = e.button === 2 || this.crossMode;
    const target = cross ? 'x' : '#';
    const vv = v.cells[i] === target ? '' : target;
    this.drag = { v: vv, start: i, cells: [i], axis: null };
    this.sel = i;
    this.draw();
  }

  private move(e: PointerEvent) {
    const d = this.drag;
    const v = this.s;
    if (!d || !v) return;
    const i = this.cellAt(e);
    if (i < 0 || d.cells.includes(i)) return;
    const w = v.w;
    const sx = d.start % w;
    const sy = Math.floor(d.start / w);
    const x = i % w;
    const y = Math.floor(i / w);
    d.axis ??= y === sy ? 'r' : x === sx ? 'c' : null;
    if (!d.axis) return;
    // вся линия от начала до текущей клетки
    const cells: number[] = [];
    if (d.axis === 'r') for (let k = Math.min(sx, x); k <= Math.max(sx, x); k++) cells.push(sy * w + k);
    else for (let k = Math.min(sy, y); k <= Math.max(sy, y); k++) cells.push(k * w + sx);
    d.cells = cells.filter((c) => !v.fixed[c]);
    this.draw();
  }

  private up = () => {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const v = this.s!;
    const is = d.cells.filter((i) => v.cells[i] !== d.v);
    if (is.length) {
      Sound.place();
      this.act({ type: 'set', is, v: d.v });
    } else this.draw();
  };

  private digit(d: number, pencil = this.pencil) {
    const v = this.s;
    if (!v || this.sel < 0 || v.fixed[this.sel]) return;
    if (pencil) {
      if (!v.cells[this.sel]) this.act({ type: 'note', i: this.sel, d });
      return;
    }
    Sound.place();
    this.act({ type: 'set', is: [this.sel], v: v.cells[this.sel] === String(d) ? '' : String(d) });
  }

  private erase() {
    const v = this.s;
    if (!v || this.sel < 0 || v.fixed[this.sel] || !v.cells[this.sel]) return;
    this.act({ type: 'set', is: [this.sel], v: '' });
  }

  private key(e: KeyboardEvent) {
    const v = this.s;
    if (!v || v.done || this.seat == null) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key]) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      const cur = this.sel >= 0 ? this.sel : 0;
      const x = (cur % v.w + dx + v.w) % v.w;
      const y = (Math.floor(cur / v.w) + dy + v.h) % v.h;
      this.select(y * v.w + x);
      return;
    }
    if (v.kind === 'sudoku') {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (m) {
        e.preventDefault();
        const d = +m[1];
        this.digit(d, e.shiftKey !== this.pencil);
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        e.preventDefault();
        this.erase();
      } else if (e.key === 'n' || e.key === 'N' || e.key === 'т' || e.key === 'Т') this.togglePencil();
    } else if (this.sel >= 0 && !v.fixed[this.sel] && (e.key === ' ' || e.key === 'x' || e.key === 'X' || e.key === 'ч' || e.key === 'Ч')) {
      e.preventDefault();
      const target = e.key === ' ' ? '#' : 'x';
      this.act({ type: 'set', is: [this.sel], v: v.cells[this.sel] === target ? '' : target });
    }
  }
}

function peers(a: number, b: number) {
  const ra = Math.floor(a / 9);
  const ca = a % 9;
  const rb = Math.floor(b / 9);
  const cb = b % 9;
  return ra === rb || ca === cb || (Math.floor(ra / 3) === Math.floor(rb / 3) && Math.floor(ca / 3) === Math.floor(cb / 3));
}

const same = (a: number[], b: number[]) => (a.length === b.length && a.every((x, i) => x === b[i])) || (!a.length && b.length === 0);

export function createView(): GameView {
  return new PuzzlesView();
}


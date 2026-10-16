/* «Головоломки» — отрисовка: газетная страница с сеткой. Судоку — цифры, карандашные пометки, подсветка строки/столбца/квадрата;
 * пикросс — числа над столбцами и слева от строк, закраска протягиванием; кроссворд — номера и списки вопросов;
 * сканворд — вопросы в клетках со стрелками. Чужие курсоры — рамкой цвета игрока.
 * Недорешённое сохраняется на каждом ходу (saves.ts). */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import { fillOf, isWords, progress, type Event, type PicrossData, type State, type WordData } from './engine';
import { addSolved, dropSave, fmtTime, getSave, keyOf, optsOf, putSave, titleOf } from './saves';
import { cluesOf } from './picross';
import { store } from '../../core/settings';
import './puzzles.css';

/** Подсветка в судоку: одинаковые цифры, строка/столбец/квадрат выбранной клетки. */
export const PREF_SAME = 'puzzles.highlight';
/** Служебный символ в скрытом поле ввода (см. обработчик input). */
const IME_PAD = ' ';

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
  /** Кроссворд/сканворд: направление ввода, строка текущего вопроса, список вопросов, поле для клавиатуры телефона. */
  private dir: 0 | 1 = 0;
  private q!: HTMLElement;
  private list!: HTMLElement;
  private ime!: HTMLInputElement;
  private listItems: HTMLElement[] = [];
  private credits!: HTMLElement;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="pz-wrap"><div class="pz-paper">
      <header class="pz-head"><span class="pz-mast">Головоломки</span><span class="pz-info"></span><span class="pz-clock"></span></header>
      <div class="pz-q" hidden></div>
      <div class="pz-body"><div class="pz-board" lang="ru"></div><div class="pz-list" hidden></div></div>
      <div class="pz-credits"></div>
      <input class="pz-ime" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text" aria-label="ввод букв">
    </div></div>`);
    root.appendChild(this.root);
    this.board = this.root.querySelector('.pz-board') as HTMLElement;
    this.q = this.root.querySelector('.pz-q') as HTMLElement;
    this.list = this.root.querySelector('.pz-list') as HTMLElement;
    this.ime = this.root.querySelector('.pz-ime') as HTMLInputElement;
    this.credits = this.root.querySelector('.pz-credits') as HTMLElement;
    // телефон: буквы приходят в скрытое поле (keydown там без буквы)
    // в поле всегда лежит служебный пробел: экранная клавиатура стирает его — это Backspace (в пустом поле он не приходит)
    this.ime.addEventListener('input', () => {
      const t = this.ime.value;
      this.resetIme();
      if (!t) this.backspace();
      for (const ch of t.startsWith(IME_PAD) ? t.slice(IME_PAD.length) : t) this.letter(ch);
    });
    this.ime.addEventListener('focus', () => this.resetIme());
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
    this.list.hidden = true;
    this.q.hidden = !isWords(v.kind);
    this.listItems = [];
    this.credits.innerHTML = '';
    if (isWords(v.kind)) this.buildWords(v);
    else if (v.kind === 'sudoku') {
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
      const d = v.data as PicrossData;
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

  private buildWords(v: State) {
    const d = v.data as WordData;
    this.board.style.setProperty('--cols', String(v.w));
    this.board.style.setProperty('--rows', String(v.h));
    const nums = new Map<number, number>();
    for (const wd of d.words) if (wd.num) nums.set(wd.cells[0], wd.num);
    const inPic = new Set<number>();
    for (const p of d.pics ?? []) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) inPic.add(y * v.w + x);
    for (let i = 0; i < v.w * v.h; i++) {
      let el: HTMLElement;
      if (inPic.has(i)) {
        // клетки под картинкой — пустышки (индексы клеток должны совпадать), саму картинку кладём поверх
        el = h(`<div class="pz-c pz-pc" data-i="${i}" hidden></div>`);
        this.board.appendChild(el);
        this.cellsEl.push(el);
        continue;
      }
      if (!d.block[i]) {
        // сканворд: стрелки — в первой клетке ответа, у края со стороны вопроса (как в газете)
        const arrows = v.kind === 'scanword' ? d.words.filter((wd) => wd.cells[0] === i && wd.at >= 0).map((wd) => ARROW[arrow(wd.at, i, wd.dir, v.w)]) : [];
        el = h(
          `<div class="pz-c" data-i="${i}">${nums.has(i) ? `<span class="n">${nums.get(i)}</span>` : ''}${
            arrows.length ? `<svg class="pz-ar" viewBox="0 0 20 20">${arrows.join('')}</svg>` : ''
          }<b></b></div>`,
        );
      }
      else if (v.kind === 'scanword') {
        const qs = cluesAt(d, i);
        el = h(`<div class="pz-c pz-qc${qs.length ? '' : ' dead'}" data-i="${i}">${qs
          .map(({ wd, k }) => `<div class="qt" data-w="${k}" title="${esc(wd.clue)}"><span>${hyph(esc(wd.clue))}</span></div>`)
          .join('')}</div>`);
      } else el = h(`<div class="pz-c blk" data-i="${i}"></div>`);
      el.style.gridColumn = String((i % v.w) + 1);
      el.style.gridRow = String(Math.floor(i / v.w) + 1);
      this.board.appendChild(el);
      this.cellsEl.push(el);
    }
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    for (const p of d.pics ?? [])
      this.board.appendChild(
        h(`<figure class="pz-pic" style="grid-column:${p.x + 1} / span ${p.w};grid-row:${p.y + 1} / span ${p.h}">
          <img src="${base}scan/${p.file}.webp" alt="" draggable="false"><b>${p.num}</b></figure>`),
      );
    this.credits.innerHTML = (d.pics ?? []).length
      ? `Фото: ${(d.pics ?? []).map((p) => `${p.num} — <a href="${esc(p.src)}" target="_blank" rel="noopener">${esc(p.credit)}</a>`).join('; ')} (Викисклад).`
      : '';
    if (v.kind === 'crossword') {
      this.list.hidden = false;
      this.list.innerHTML = '';
      for (const dir of [0, 1] as const) {
        const col = h(`<div class="pz-col"><h4>${dir === 0 ? 'По горизонтали' : 'По вертикали'}</h4></div>`);
        d.words.forEach((wd, k) => {
          if (wd.dir !== dir) return;
          const li = h(`<div class="pz-li" data-w="${k}"><b>${wd.num}.</b> ${esc(wd.clue)} <small>(${wd.cells.length})</small></div>`);
          li.onclick = () => this.pickWord(k);
          col.appendChild(li);
          this.listItems[k] = li;
        });
        this.list.appendChild(col);
      }
    }
    // начать с первого слова
    if (this.sel < 0 && d.words.length) {
      this.sel = d.words[0].cells[0];
      this.dir = d.words[0].dir;
    }
  }

  /** Слово (индекс), в которое входит клетка в направлении dir; -1 — нет. */
  private wordAt(i: number, dir: 0 | 1): number {
    const d = this.s?.data as WordData | null;
    if (!d || !('words' in d)) return -1;
    return d.words.findIndex((wd) => wd.dir === dir && wd.cells.includes(i));
  }

  private activeWord(): number {
    if (this.sel < 0) return -1;
    const k = this.wordAt(this.sel, this.dir);
    return k >= 0 ? k : this.wordAt(this.sel, this.dir === 0 ? 1 : 0);
  }

  private pickWord(k: number) {
    const v = this.s;
    if (!v) return;
    const wd = (v.data as WordData).words[k];
    this.dir = wd.dir;
    const empty = wd.cells.find((c) => !v.cells[c] && !v.fixed[c]);
    this.select(empty ?? wd.cells[0]);
    this.focusIme();
  }

  private resetIme() {
    this.ime.value = IME_PAD;
    try {
      this.ime.setSelectionRange(IME_PAD.length, IME_PAD.length);
    } catch {
      /* поле не в фокусе */
    }
  }

  private focusIme() {
    if (this.ctx.demo || this.seat == null) return;
    this.resetIme();
    try {
      this.ime.focus({ preventScroll: true });
    } catch {
      /* старые браузеры */
    }
  }

  /** Вписать букву и шагнуть дальше по слову. */
  private letter(raw: string) {
    const v = this.s;
    if (!v || v.done || this.sel < 0 || !isWords(v.kind)) return;
    const ch = raw.toLowerCase().replace('ё', 'е');
    if (!/^[а-я]$/.test(ch)) return;
    if (!v.fixed[this.sel] && v.cells[this.sel] !== ch) {
      Sound.place();
      this.act({ type: 'set', is: [this.sel], v: ch });
    }
    const k = this.activeWord();
    if (k < 0) return;
    const cells = (v.data as WordData).words[k].cells;
    const at = cells.indexOf(this.sel);
    if (at >= 0 && at < cells.length - 1) {
      this.dir = (v.data as WordData).words[k].dir;
      this.select(cells[at + 1]);
    }
  }

  private backspace() {
    const v = this.s;
    if (!v || this.sel < 0) return;
    if (v.cells[this.sel] && !v.fixed[this.sel]) {
      this.act({ type: 'set', is: [this.sel], v: '' });
      return;
    }
    const k = this.activeWord();
    if (k < 0) return;
    const cells = (v.data as WordData).words[k].cells;
    const at = cells.indexOf(this.sel);
    if (at > 0) {
      this.select(cells[at - 1]);
      const p = cells[at - 1];
      if (v.cells[p] && !v.fixed[p]) this.act({ type: 'set', is: [p], v: '' });
    }
  }

  /** Стереть всё слово, на котором курсор (кроме открытых подсказкой). */
  private eraseWord() {
    const v = this.s;
    const k = this.activeWord();
    if (!v || v.done || k < 0) return;
    const is = (v.data as WordData).words[k].cells.filter((c) => v.cells[c] && !v.fixed[c]);
    if (is.length) this.act({ type: 'set', is, v: '' });
  }

  private buildControls(v: State) {
    if (this.ctx.demo) {
      this.ctl.innerHTML = '';
      return;
    }
    const tools = `<div class="pz-tools"><button class="btn" data-a="hint">Подсказка</button><button class="btn" data-a="check">Проверить</button></div>`;
    if (isWords(v.kind)) {
      this.ctl.innerHTML = `<div class="pz-tools"><button class="btn" data-a="bs" title="Backspace">⌫ Стереть букву</button><button class="btn" data-a="word">Стереть слово</button></div>${tools}
        <p class="hint small-hint">Нажмите клетку и печатайте; Backspace — стереть. Повторное нажатие — сменить направление; Tab — следующее слово.
        ${v.kind === 'crossword' ? 'Вопрос из списка — сразу к слову.' : 'Нажатие на вопрос — к его слову.'}</p>`;
    } else if (v.kind === 'sudoku') {
      this.ctl.innerHTML = `<div class="pz-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button class="pz-key" data-d="${d}">${d}</button>`).join('')}
        <button class="pz-key pz-pencil" data-a="pencil" title="Карандаш: пометки (клавиша N)">✎</button><button class="pz-key" data-a="erase" title="Стереть (Backspace)">⌫</button></div>${tools}
        <label class="opt opt-toggle"><input type="checkbox" data-a="hl"> <span>Подсвечивать одинаковые цифры</span></label>
        <p class="hint small-hint">Клавиши: цифры, стрелки, N — карандаш, Backspace — стереть.</p>`;
      const hl = this.ctl.querySelector<HTMLInputElement>('[data-a=hl]')!;
      hl.checked = store.get<string>(PREF_SAME, 'off') === 'on';
      hl.onchange = () => {
        store.set(PREF_SAME, hl.checked ? 'on' : 'off');
        this.draw();
      };
    } else {
      this.ctl.innerHTML = `<div class="seg pz-mode"><button data-m="fill" class="on">■ Закрасить</button><button data-m="cross">✕ Пусто</button></div>${tools}
        <p class="hint small-hint">Нажатие — закрасить, правая кнопка — крестик, нажатие по закрашенному — стереть. Ведите, не отпуская, — вдоль строки или столбца.</p>`;
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
    on('bs', () => {
      this.backspace();
      this.focusIme();
    });
    on('word', () => {
      this.eraseWord();
      this.focusIme();
    });
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
    if (isWords(v.kind)) return this.drawWords(v);
    const me = this.seat;
    const hl = store.get<string>(PREF_SAME, 'off') === 'on';
    const selD = hl && this.sel >= 0 && v.kind === 'sudoku' ? v.cells[this.sel] : '';
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
        if (hl && this.sel >= 0 && !v.done && i !== this.sel && peers(this.sel, i)) cls += ' peer';
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

  private drawWords(v: State) {
    const d = v.data as WordData;
    const me = this.seat;
    const others = new Map<number, number>();
    v.seats.forEach((st) => {
      if (st !== me && v.cur[st] >= 0) others.set(v.cur[st], st);
    });
    const k = this.activeWord();
    const act = new Set(k >= 0 && !v.done ? d.words[k].cells : []);
    const wrong = new Set(v.wrong);
    for (let i = 0; i < this.cellsEl.length; i++) {
      const el = this.cellsEl[i];
      if (d.block[i]) {
        if (v.kind === 'scanword' && !el.hidden) el.classList.toggle('peer', k >= 0 && d.words[k].at === i && !v.done);
        continue;
      }
      const c = v.cells[i];
      let cls = 'pz-c';
      if (v.fixed[i]) cls += ' fx';
      if (act.has(i)) cls += ' peer';
      if (i === this.sel && !v.done) cls += ' on';
      if (wrong.has(i)) cls += ' bad';
      if (others.has(i)) cls += ' oc';
      if (v.done) cls += ' done';
      el.className = cls;
      (el.querySelector('b') as HTMLElement).textContent = c ? c.toUpperCase() : '';
      el.style.color = !v.fixed[i] && v.who[i] >= 0 ? SEATS[v.who[i]].dark : '';
      el.style.setProperty('--oc', others.has(i) ? SEATS[others.get(i)!].color : 'transparent');
    }
    this.listItems.forEach((li, j) => {
      if (!li) return;
      li.classList.toggle('on', j === k);
      const full = d.words[j].cells.every((c) => v.cells[c]);
      li.classList.toggle('full', full);
    });
    if (k >= 0) {
      const wd = d.words[k];
      const where = v.kind === 'crossword' ? `${wd.num} ${wd.dir === 0 ? 'по горизонтали' : 'по вертикали'}` : wd.dir === 0 ? '→' : '↓';
      this.q.innerHTML = `<b>${where}:</b> ${esc(wd.clue)} <small>(${wd.cells.length})</small>`;
      this.listItems[k]?.scrollIntoView({ block: 'nearest' });
    } else this.q.textContent = '';
  }

  /** Пикросс: линия, где закрашенное совпало с числами, — числа бледнеют. */
  private drawClues(v: State) {
    const d = v.data as PicrossData;
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
    if (isWords(v.kind)) {
      e.preventDefault();
      const d = v.data as WordData;
      if (d.block[i]) {
        // сканворд: вопрос — к его слову (второе нажатие — ко второму вопросу клетки)
        const qs = cluesAt(d, i);
        if (!qs.length) return;
        const cur = this.activeWord();
        const n = qs.findIndex(({ k }) => k === cur);
        this.pickWord(qs[(n + 1) % qs.length].k);
        return;
      }
      if (i === this.sel && this.wordAt(i, this.dir === 0 ? 1 : 0) >= 0) this.dir = this.dir === 0 ? 1 : 0;
      else if (this.wordAt(i, this.dir) < 0) this.dir = this.dir === 0 ? 1 : 0;
      this.select(i);
      this.focusIme();
      return;
    }
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

  private keyWords(e: KeyboardEvent, v: State, arrows: Record<string, [number, number]>) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const d = v.data as WordData;
    if (arrows[e.key]) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      const nd: 0 | 1 = dx ? 0 : 1;
      if (this.sel >= 0 && nd !== this.dir && this.wordAt(this.sel, nd) >= 0) {
        this.dir = nd;
        this.draw();
        return;
      }
      let x = this.sel >= 0 ? this.sel % v.w : 0;
      let y = this.sel >= 0 ? Math.floor(this.sel / v.w) : 0;
      for (let t = 0; t < Math.max(v.w, v.h); t++) {
        x += dx;
        y += dy;
        if (x < 0 || y < 0 || x >= v.w || y >= v.h) return;
        if (!d.block[y * v.w + x]) {
          if (this.wordAt(y * v.w + x, nd) >= 0) this.dir = nd;
          this.select(y * v.w + x);
          return;
        }
      }
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      this.backspace();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const n = d.words.length;
      const k = this.activeWord();
      this.pickWord((((k < 0 ? -1 : k) + (e.shiftKey ? -1 : 1)) % n + n) % n);
      return;
    }
    const ch = /^[а-яёА-ЯЁ]$/.test(e.key) ? e.key : LAYOUT[e.code];
    if (ch) {
      e.preventDefault();
      this.letter(ch);
    }
  }

  private key(e: KeyboardEvent) {
    const v = this.s;
    if (!v || v.done || this.seat == null) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (isWords(v.kind)) return this.keyWords(e, v, arrows);
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

/** Буква по клавише: русская раскладка или латинская (по положению клавиши — ЙЦУКЕН). */
const LAYOUT: Record<string, string> = {
  KeyQ: 'й', KeyW: 'ц', KeyE: 'у', KeyR: 'к', KeyT: 'е', KeyY: 'н', KeyU: 'г', KeyI: 'ш', KeyO: 'щ', KeyP: 'з', BracketLeft: 'х', BracketRight: 'ъ',
  KeyA: 'ф', KeyS: 'ы', KeyD: 'в', KeyF: 'а', KeyG: 'п', KeyH: 'р', KeyJ: 'о', KeyK: 'л', KeyL: 'д', Semicolon: 'ж', Quote: 'э',
  KeyZ: 'я', KeyX: 'ч', KeyC: 'с', KeyV: 'м', KeyB: 'и', KeyN: 'т', KeyM: 'ь', Comma: 'б', Period: 'ю', Backquote: 'е',
};

/** Какая стрелка: r — вопрос слева, слово вправо; d — вопрос сверху, слово вниз; rd — вопрос слева, слово вниз; dr — вопрос сверху, слово вправо. */
function arrow(at: number, start: number, dir: 0 | 1, _w: number): 'r' | 'd' | 'rd' | 'dr' {
  const fromLeft = start === at + 1;
  if (dir === 0) return fromLeft ? 'r' : 'dr';
  return fromLeft ? 'rd' : 'd';
}

/** Вопросы клетки сканворда сверху вниз, как в газете: сначала тот, чья стрелка выходит вправо (загнутая вниз — у верхнего края, выше прямой), потом выходящий вниз. */
function cluesAt(d: WordData, i: number): { wd: WordData['words'][number]; k: number }[] {
  const rank = (wd: WordData['words'][number]) => ({ rd: 0, r: 1, dr: 2, d: 3 } as const)[arrow(wd.at, wd.cells[0], wd.dir, 0)];
  return d.words
    .map((wd, k) => ({ wd, k }))
    .filter(({ wd }) => wd.at === i)
    .sort((a, b) => rank(a.wd) - rank(b.wd));
}

/** Газетные стрелки в первой клетке ответа (клетка — 20×20). */
const ARROW: Record<'r' | 'd' | 'rd' | 'dr', string> = {
  r: '<path d="M0 10H5"/><path class="hd" d="M4.5 7.6L7.6 10L4.5 12.4Z"/>',
  d: '<path d="M10 0V5"/><path class="hd" d="M7.6 4.5L10 7.6L12.4 4.5Z"/>',
  rd: '<path d="M0 4H5V8"/><path class="hd" d="M2.6 7.5L5 10.6L7.4 7.5Z"/>',
  dr: '<path d="M4 0V5H8"/><path class="hd" d="M7.5 2.6L10.6 5L7.5 7.4Z"/>',
};

/** Мягкие переносы по слогам (браузеры русские переносы ставят не везде): гласная-согласная+гласная, между согласными;
 * й, ь, ъ остаются с предыдущей буквой; с краю слова — не меньше двух букв. */
const VOW = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ';
function hyph(text: string): string {
  return text.replace(/[а-яёА-ЯЁ]{6,}/g, (w) => {
    let out = '';
    let last = 0;
    for (let i = 2; i <= w.length - 2; i++) {
      const a = w[i - 1];
      const b = w[i];
      const c = w[i + 1] ?? '';
      if ('йьъЙЬЪ'.includes(b)) continue;
      const cut = (VOW.includes(a) && !VOW.includes(b) && VOW.includes(c)) || (!VOW.includes(a) && !'йьъЙЬЪ'.includes(a) && !VOW.includes(b) && w.slice(0, i).split('').some((x) => VOW.includes(x)) && w.slice(i).split('').some((x) => VOW.includes(x))) || (VOW.includes(a) && VOW.includes(b)) || ('йьъЙЬЪ'.includes(a) && w.slice(i).split('').some((x) => VOW.includes(x)));
      if (cut && w.slice(0, i).split('').some((x) => VOW.includes(x))) {
        out += w.slice(last, i) + '­';
        last = i;
      }
    }
    return out + w.slice(last);
  });
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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


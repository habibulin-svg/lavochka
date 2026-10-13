/* Кинь-двинь — отрисовка: оригинальное поле, пуговицы игроков на клетках (несколько на одной — веером).
 * Ход как за столом: бросил кубик (кнопка, пробел или тап по полю), нашёл свою пуговицу, взял её (нажатие или перетаскивание),
 * посмотрел, куда идти (подсвечены шаги и клетка), поставил. По знаку пуговица перелетает сама.
 * Поле — пирамида тайлов из исходного скана (tools/hodilki/tiles.py): сразу проявляется размытая миниатюра, потом общая карта,
 * при зуме подгружаются только видимые куски нужного уровня. Камера плавная: колесо/щипок/кнопки, перелёт с отъездом на дальних
 * переходах, «следить за ходом»; при зуме в углу — миникарта. */
import { Sound } from '../../core/audio';
import { DiceTray } from '../../core/dice';
import { h, sleep, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { finishOf, itemIcon, pathFor, signGood, signText, skipsOf, target, trackOf, type Action, type Board, type Event, type State } from './core';
import { loadClues } from '../../words/clues';
import { randomRiddle } from '../../words/riddles';
import { boardOf, scoreText } from './def';
import './hodilki.css';

const NS = 'http://www.w3.org/2000/svg';
const FOLLOW_KEY = 'hodilki.follow';
const TILE = 512;
/** Ширина общей карты view.webp — до неё тайлы не нужны. */
const VIEW_W = 1600;

interface Cam {
  z: number;
  fx: number;
  fy: number;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, '');
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

class HodilkiView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  /** Поле партии — из состояния (настройка «Поле»). */
  private b: Board | null = null;
  private wrap!: HTMLElement;
  private board!: HTMLElement;
  private tiny!: HTMLImageElement;
  private base!: HTMLImageElement;
  private layers: HTMLElement[] = [];
  private tiles = new Map<string, HTMLImageElement>();
  private marks!: SVGSVGElement;
  private note!: HTMLElement;
  private mini!: HTMLElement;
  private miniVp!: HTMLElement;
  private miniDots = new Map<number, HTMLElement>();
  private tokens = new Map<number, HTMLElement>();
  private panel!: HTMLElement;
  private hint!: HTMLElement | null;
  private rollBtn!: HTMLButtonElement;
  private quizBox!: HTMLElement;
  private qText!: HTMLElement;
  private answers!: HTMLElement;
  private rBox!: HTMLElement;
  private rText!: HTMLElement;
  private rReplies!: HTMLElement;
  private rAnswerBox!: HTMLElement;
  private rInput!: HTMLInputElement;
  private rAskerBox!: HTMLElement;
  private rOwn!: HTMLInputElement;
  private rKey!: HTMLInputElement;
  private rJudgeBox!: HTMLElement;
  private followBtn!: HTMLButtonElement;
  private tray!: DiceTray;
  /** «Шайба»: вместо лотка с кубиком — грань настоящего кубика и вытянутый квадратик. */
  private cubeBox!: HTMLElement;
  private cubeHint!: HTMLElement;
  private face!: HTMLImageElement;
  private cardImg!: HTMLImageElement;
  /** «Шайба»: заранее загруженные грани кубика и квадратики. */
  private artFaces: HTMLImageElement[] = [];
  private artCards: HTMLImageElement[] = [];
  private v: State | null = null;
  /** Где пуговица сейчас нарисована (во время анимации — не там, где в состоянии). */
  private shown: number[] = [];
  /** Чьё действие ждём от этого экрана и какое. */
  private actSeat: number | null = null;
  private phase: 'roll' | 'move' | 'pick' | 'ask' | 'answer' | 'judge' = 'roll';
  /** Пуговица взята (нажатием) — видны шаги и клетка. */
  private picked = false;
  private busy = false;
  private ro!: ResizeObserver;

  // ---- камера: поле «целиком» bw×bh, зум и центр кадра в долях поля ----
  private bw = 0;
  private bh = 0;
  private cam: Cam = { z: 1, fx: 0.5, fy: 0.5 };
  /** Плавная доводка (колесо, кнопки): к цели, точка anchor экрана остаётся под пальцем. */
  private goal: (Cam & { ax?: number; ay?: number; bx?: number; by?: number }) | null = null;
  /** Перелёт по кривой (следить за ходом, миникарта). */
  private tween: { from: Cam; to: Cam; t0: number; ms: number; bump: number; done: () => void } | null = null;
  private raf = 0;
  private follow = true;
  /** Игрок сам двигал камеру — не мешать ему до его следующего хода. */
  private manual = false;
  /** Масштаб, который держит слежение: выбранный игроком или первый кадр (0 — ещё не было). */
  private pz = 0;
  private ptrs = new Map<number, { x: number; y: number }>();
  private gesture: { kind: 'pan' | 'token'; x0: number; y0: number; moved: boolean; dist?: number } | null = null;
  private eatClick = false;
  private tilesQueued = false;
  /** Сдвиг общей карты вверх (под ней панель кнопок вида). */
  private oy = 0;
  /** Угол миникарты: обычно внизу слева, уходит, если там пуговицы. */
  private corner: 'bl' | 'tl' | 'tr' = 'bl';

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.code === 'Space') {
      if (this.actSeat == null || this.phase !== 'roll' || this.rollBtn.hidden) return;
      e.preventDefault();
      this.roll();
    } else if (e.key === '+' || e.key === '=') this.zoomBy(1.6);
    else if (e.key === '-') this.zoomBy(1 / 1.6);
    else if (e.key === '0') this.overview();
  };

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    try {
      this.follow = localStorage.getItem(FOLLOW_KEY) !== '0';
    } catch {
      /* по умолчанию — следить */
    }
    const wrap = h(`<div class="ks-wrap">
        <div class="ks-board">
          <img class="ks-tiny" alt="" draggable="false"><img class="ks-base" alt="поле" draggable="false">
          <svg class="ks-marks" xmlns="${NS}" preserveAspectRatio="none"></svg>
        </div>
        <div class="ks-note" hidden></div>
        <div class="ks-mini" hidden><img alt="" draggable="false"><div class="ks-mini-vp"></div></div>
        <div class="ks-cam">
          <button class="ks-cb" data-z="all" title="Вся карта (0)"><b>⤢</b><span>Вся карта</span></button>
          <button class="ks-cb" data-z="turn" title="Показать, где ход"><b>◎</b><span>Где ход</span></button>
          <button class="ks-cb ks-follow" data-z="follow" title="Камера сама следит за ходом"><b>●</b><span>Следить</span></button>
          <span class="ks-zoom"><button class="ks-cb" data-z="out" title="Отдалить (−)"><b>−</b></button><button class="ks-cb" data-z="in" title="Приблизить (+)"><b>+</b></button></span>
        </div>
      </div>`);
    root.appendChild(wrap);
    this.wrap = wrap;
    this.board = wrap.querySelector('.ks-board') as HTMLElement;
    this.tiny = wrap.querySelector('.ks-tiny') as HTMLImageElement;
    this.base = wrap.querySelector('.ks-base') as HTMLImageElement;
    this.marks = wrap.querySelector('.ks-marks') as SVGSVGElement;
    this.note = wrap.querySelector('.ks-note') as HTMLElement;
    this.mini = wrap.querySelector('.ks-mini') as HTMLElement;
    this.miniVp = wrap.querySelector('.ks-mini-vp') as HTMLElement;
    this.followBtn = wrap.querySelector('.ks-follow') as HTMLButtonElement;
    this.followBtn.classList.toggle('on', this.follow);
    (wrap.querySelector('.ks-cam') as HTMLElement).hidden = ctx.demo;
    // карта проявляется: размытая миниатюра → общая карта (тогда же — пуговицы)
    this.tiny.onload = () => this.board.classList.add('seen');
    this.base.onload = () => {
      this.board.classList.add('ready');
      this.ctx.hold?.(0);
      if (!this.ctx.demo) void this.frameTurn();
    };
    wrap.querySelector('.ks-cam')!.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const z = ((e.target as HTMLElement).closest('[data-z]') as HTMLElement | null)?.dataset.z;
      if (z === 'in') this.zoomBy(1.6);
      else if (z === 'out') this.zoomBy(1 / 1.6);
      else if (z === 'all') this.overview();
      else if (z === 'turn') {
        this.manual = false;
        void this.frameTurn(true);
      } else if (z === 'follow') {
        this.follow = !this.follow;
        this.manual = false;
        this.followBtn.classList.toggle('on', this.follow);
        try {
          localStorage.setItem(FOLLOW_KEY, this.follow ? '1' : '0');
        } catch {
          /* без сохранения */
        }
        if (this.follow) void this.frameTurn(true);
      }
    });
    this.mini.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const r = this.mini.getBoundingClientRect();
      this.manual = true;
      void this.fly({ z: this.cam.z, fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height });
    });
    this.mini.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(wrap);

    this.panel = h(`<div class="ks-panel">
        <div class="ks-tray"></div>
        <div class="ks-cube dice-tray" hidden>
          <span class="ks-cube-hint">Кубик «Шайбы»: 1–4 — очки, красная клюшка — назад, зелёная — вперёд (тянут квадратик)</span>
          <img class="ks-face" alt="кубик" draggable="false" hidden>
          <img class="ks-card" alt="квадратик" draggable="false" hidden>
        </div>
        <button class="btn primary ks-roll" data-tap hidden>Бросить кубик</button>
        <div class="ks-quiz" hidden>
          <div class="ks-q"></div>
          <div class="ks-answers"></div>
        </div>
        <div class="ks-riddle" hidden>
          <div class="ks-rq"></div>
          <div class="ks-rreplies"></div>
          <div class="ks-ranswer" hidden>
            <input class="ks-rin" type="text" maxlength="60" placeholder="Ваш ответ…" autocomplete="off">
            <div class="ks-rbtns">
              <button class="btn primary ks-rsend">Ответить</button>
              <button class="btn ks-rskip">Не знаю</button>
            </div>
          </div>
          <div class="ks-rasker" hidden>
            <input class="ks-rown" type="text" maxlength="300" placeholder="Своя загадка…" autocomplete="off">
            <input class="ks-rkey" type="text" maxlength="120" placeholder="Ответ — чтобы игра проверила сама (можно пусто)" autocomplete="off">
            <div class="ks-rbtns">
              <button class="btn primary ks-rgo">Загадать свою</button>
              <button class="btn ks-rbase" data-diff="1">Из базы: простая</button>
              <button class="btn ks-rbase" data-diff="2">средняя</button>
              <button class="btn ks-rbase" data-diff="3">трудная</button>
            </div>
          </div>
          <div class="ks-rjudge" hidden>
            <div class="ks-rbtns">
              <button class="btn ks-yes">Кто-то отгадал</button>
              <button class="btn primary ks-no">Никто не отгадал</button>
            </div>
          </div>
        </div>
        ${ctx.demo ? '' : `<div class="hint small-hint ks-hint"><span class="ks-hint-text">Потом возьмите свою пуговицу и поставьте на подсвеченную клетку.</span> ${touchScreen() ? 'Бросок — кнопкой или тапом по полю.' : 'Пробел — бросок.'} Карту можно приближать ${touchScreen() ? 'двумя пальцами' : 'колесом'} и двигать.</div>`}
      </div>`);
    ctx.controls.appendChild(this.panel);
    this.hint = this.panel.querySelector('.ks-hint');
    this.tray = new DiceTray(this.panel.querySelector('.ks-tray') as HTMLElement, 1);
    this.cubeBox = this.panel.querySelector('.ks-cube') as HTMLElement;
    this.cubeHint = this.panel.querySelector('.ks-cube-hint') as HTMLElement;
    this.face = this.panel.querySelector('.ks-face') as HTMLImageElement;
    this.cardImg = this.panel.querySelector('.ks-card') as HTMLImageElement;
    this.rollBtn = this.panel.querySelector('.ks-roll') as HTMLButtonElement;
    this.rollBtn.onclick = () => this.roll();
    this.quizBox = this.panel.querySelector('.ks-quiz') as HTMLElement;
    this.qText = this.panel.querySelector('.ks-q') as HTMLElement;
    this.answers = this.panel.querySelector('.ks-answers') as HTMLElement;
    // «Лукоморье», поле 4: загадка остальным — загадать (свою или из базы), ответить, судить
    this.rBox = this.panel.querySelector('.ks-riddle') as HTMLElement;
    this.rText = this.panel.querySelector('.ks-rq') as HTMLElement;
    this.rReplies = this.panel.querySelector('.ks-rreplies') as HTMLElement;
    this.rAnswerBox = this.panel.querySelector('.ks-ranswer') as HTMLElement;
    this.rInput = this.panel.querySelector('.ks-rin') as HTMLInputElement;
    this.rAskerBox = this.panel.querySelector('.ks-rasker') as HTMLElement;
    this.rOwn = this.panel.querySelector('.ks-rown') as HTMLInputElement;
    this.rKey = this.panel.querySelector('.ks-rkey') as HTMLInputElement;
    this.rJudgeBox = this.panel.querySelector('.ks-rjudge') as HTMLElement;
    const send = (a: Action) => {
      const seat = this.actSeat;
      if (seat == null) return;
      Sound.ui();
      this.ctx.act(seat, a);
    };
    (this.panel.querySelector('.ks-rsend') as HTMLButtonElement).onclick = () => {
      const text = this.rInput.value.trim();
      if (!text) return;
      send({ type: 'answer', text });
      this.rInput.value = '';
    };
    (this.panel.querySelector('.ks-rskip') as HTMLButtonElement).onclick = () => send({ type: 'answer' });
    (this.panel.querySelector('.ks-rgo') as HTMLButtonElement).onclick = () => {
      const text = this.rOwn.value.trim();
      if (!text) return;
      send({ type: 'ask', text, answer: this.rKey.value.trim() || undefined });
      this.rOwn.value = '';
      this.rKey.value = '';
    };
    // «из базы»: вопросы кроссвордов по сложности (база грузится лениво, пока её нет — свой набор загадок)
    this.panel.querySelectorAll('.ks-rbase').forEach((el) => {
      const diff = Number((el as HTMLElement).dataset.diff ?? 1);
      (el as HTMLButtonElement).onclick = async () => {
        (el as HTMLButtonElement).disabled = true;
        await loadClues().catch(() => undefined);
        (el as HTMLButtonElement).disabled = false;
        const r = randomRiddle(diff, { int: (n: number) => Math.floor(Math.random() * n) });
        send({ type: 'ask', text: r.q, answer: r.a });
      };
    });
    (this.panel.querySelector('.ks-yes') as HTMLButtonElement).onclick = () => send({ type: 'judge', ok: true });
    (this.panel.querySelector('.ks-no') as HTMLButtonElement).onclick = () => send({ type: 'judge', ok: false });
    this.rInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (this.panel.querySelector('.ks-rsend') as HTMLButtonElement).click();
      e.stopPropagation();
    });
    [this.rOwn, this.rKey].forEach((inp) =>
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') (this.panel.querySelector('.ks-rgo') as HTMLButtonElement).click();
        e.stopPropagation();
      })
    );
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);

    wrap.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    wrap.addEventListener('pointerdown', (e) => this.onDown(e));
    wrap.addEventListener('pointermove', (e) => this.onMove(e));
    wrap.addEventListener('pointerup', (e) => this.onUp(e));
    wrap.addEventListener('pointercancel', (e) => this.onUp(e, true));
    wrap.addEventListener('click', (e) => this.onClick(e));
    wrap.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch' || !this.canMove() || this.picked) return;
      if ((e.target as HTMLElement).closest('.ks-token.mine')) this.showMarks(true);
    });
    wrap.addEventListener('pointerout', (e) => {
      if (e.pointerType === 'touch' || this.picked || this.gesture) return;
      if ((e.target as HTMLElement).closest('.ks-token.mine')) this.showMarks(false);
    });
  }

  // ---------- ход ----------

  private roll() {
    if (this.actSeat == null || this.phase !== 'roll' || this.busy) return;
    const seat = this.actSeat;
    this.actSeat = null;
    this.rollBtn.hidden = true;
    Sound.unlock();
    this.ctx.act(seat, { type: 'roll' });
  }

  private canMove() {
    return this.actSeat != null && this.phase === 'move' && !this.busy && !!this.v;
  }

  /** Место, за которым нарисована шайба дорожки: в гонке с голами напарники ходят одной шайбой. */
  private puckSeat(seat: number): number {
    const b = this.b;
    const v = this.v;
    if (!b?.race || !v) return seat;
    const track = trackOf(b, seat);
    return v.seats.find((s) => trackOf(b, s) === track) ?? seat;
  }

  /** Своя пуговица: у «Шайбы» — шайба своей дорожки. */
  private myToken(): HTMLElement | null {
    return this.actSeat == null ? null : (this.tokens.get(this.puckSeat(this.actSeat)) ?? null);
  }

  /** Поставить пуговицу: dropped — уже стоит на клетке (перетащили), шагать не надо. */
  private commit(dropped: boolean) {
    if (!this.canMove() || !this.v || !this.b) return;
    const seat = this.actSeat!;
    const to = target(this.v, this.b, seat);
    this.actSeat = null;
    this.picked = false;
    this.showMarks(false);
    if (dropped) {
      this.shown[seat] = to;
      this.place();
      Sound.place();
    }
    this.syncTokens();
    Sound.unlock();
    this.ctx.act(seat, { type: 'move' });
  }

  private pick(on: boolean) {
    if (on && !this.canMove()) return;
    this.picked = on;
    const el = this.myToken();
    el?.classList.toggle('lifted', on);
    this.showMarks(on);
    if (on) Sound.ui();
  }

  /** Шаги и клетка назначения своей пуговицы. */
  private showMarks(on: boolean) {
    this.marks.replaceChildren();
    if (!on || !this.canMove() || !this.v || !this.b) return;
    const b = this.b;
    const seat = this.actSeat!;
    const from = this.v.pos[seat];
    const path = pathFor(this.v, b, seat);
    if (!path.length) return;
    const to = path[path.length - 1];
    const r = b.token * b.img.w * 0.62;
    const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const el = document.createElementNS(NS, tag);
      for (const [k, val] of Object.entries(attrs)) el.setAttribute(k, String(val));
      if (text) el.textContent = text;
      this.marks.appendChild(el);
    };
    const pts: number[] = [from, ...path];
    add('polyline', { class: 'ks-trail', points: pts.map((i) => `${b.cells[i].x},${b.cells[i].y}`).join(' '), 'stroke-width': r * 0.22 });
    path.slice(0, -1).forEach((i, k) => {
      const c = b.cells[i];
      add('circle', { class: 'ks-stepdot', cx: c.x, cy: c.y, r: r * 0.42 });
      add('text', { class: 'ks-stepnum', x: c.x, y: c.y, 'font-size': r * 0.5 }, String(k + 1));
    });
    const c = b.cells[to];
    add('circle', { class: 'ks-goal', cx: c.x, cy: c.y, r: r * 1.15, 'stroke-width': r * 0.2 });
    add('text', { class: 'ks-goalnum', x: c.x, y: c.y < r * 3 ? c.y + r * 1.6 : c.y - r * 1.6, 'font-size': r * 0.8 }, String(path.length));
  }

  // ---------- пуговицы ----------

  private place() {
    const v = this.v;
    const b = this.b;
    if (!v || !b) return;
    // сколько пуговиц на клетке — раздвинуть веером (в гонке с голами одна шайба на дорожку)
    const ids = b.race ? v.seats.filter((s) => this.puckSeat(s) === s) : v.seats;
    const at = new Map<number, number[]>();
    for (const s of ids) at.set(this.shown[s], [...(at.get(this.shown[s]) ?? []), s]);
    for (const s of ids) {
      let el = this.tokens.get(s);
      if (!el) {
        const puck = b.race?.pucks?.[trackOf(b, s)];
        el = h(
          puck && b.race
            ? `<div class="ks-token ks-puck" data-seat="${s}"><div class="ks-btn" style="background-image:url(${puck})"></div></div>`
            : `<div class="ks-token" data-seat="${s}"><div class="ks-btn" style="background-image:url(/hodilki/buttons/${s}.webp)"></div></div>`,
        );
        this.board.appendChild(el);
        this.tokens.set(s, el);
      }
      if (el.classList.contains('drag')) continue;
      const cell = b.cells[this.shown[s]];
      const group = at.get(this.shown[s])!;
      const i = group.indexOf(s);
      const off = group.length > 1 ? (i - (group.length - 1) / 2) * b.token * 70 : 0;
      el.style.left = `${(cell.x / b.img.w) * 100 + off}%`;
      el.style.top = `${(cell.y / b.img.h) * 100 + (group.length > 1 ? (i % 2) * b.token * 30 * (b.img.w / b.img.h) : 0)}%`;
    }
    this.syncTokens();
    this.drawMini();
  }

  /** Подсветка: чей ход, своя пуговица (можно взять). */
  private syncTokens() {
    const v = this.v;
    const b = this.b;
    if (!v) return;
    // в гонке с голами подсвечиваем дорожку того, чей ход (шайба одна на команду)
    const turnSeat = b?.race ? this.puckSeat(v.turn) : v.turn;
    const mineSeat = this.actSeat != null ? this.puckSeat(this.actSeat) : null;
    for (const [s, el] of this.tokens) {
      el.classList.toggle('on', turnSeat === s && v.winner == null);
      el.classList.toggle('mine', s === mineSeat && this.canMove());
      if (s === mineSeat && !this.picked && !el.classList.contains('drag') && !this.busy) el.classList.remove('lifted');
    }
  }

  /** Поставить карту поля (при первом показе и если поле другое). */
  private useBoard(map: string) {
    const b = boardOf(map);
    if (this.b === b) return;
    this.b = b;
    for (const el of this.tokens.values()) el.remove();
    this.tokens.clear();
    for (const el of this.miniDots.values()) el.remove();
    this.miniDots.clear();
    for (const l of this.layers) l.remove();
    this.tiles.clear();
    this.board.classList.remove('seen', 'ready');
    this.ctx.hold?.(20000);
    this.tiny.src = `${b.img.dir}/tiny.webp`;
    this.base.src = `${b.img.dir}/view.webp`;
    this.base.alt = b.title;
    (this.mini.querySelector('img') as HTMLImageElement).src = `${b.img.dir}/view.webp`;
    if (b.race) this.preloadRace();
    // слои тайлов: более подробный — выше
    this.layers = Array.from({ length: b.img.levels }, (_, lv) => {
      const l = document.createElement('div');
      l.className = 'ks-lv';
      l.style.zIndex = String(10 - lv);
      this.board.insertBefore(l, this.marks);
      return l;
    });
    this.marks.setAttribute('viewBox', `0 0 ${b.img.w} ${b.img.h}`);
    this.board.style.setProperty('--tk', `${b.token * 100}%`);
    this.mini.style.aspectRatio = `${b.img.w} / ${b.img.h}`;
    // «Шайба»: вместо лотка с кубиком — грань кубика и квадратик
    (this.tray.el as HTMLElement).hidden = !!b.race;
    this.cubeBox.hidden = !b.race;
    // у «Шайбы» ходят шайбой, а не пуговицей
    // в показе правил подсказки нет — её и не ищем
    const hintText = this.hint?.querySelector('.ks-hint-text');
    if (hintText) hintText.textContent = b.race ? 'Потом возьмите свою шайбу и поставьте на подсвеченную клетку.' : 'Потом возьмите свою пуговицу и поставьте на подсвеченную клетку.';
    if (!b.race) {
      this.cardImg.hidden = true;
      this.face.removeAttribute('src');
    } else if (!this.face.getAttribute('src')) {
      // до первого броска в панели — подсказка, а не пустая рамка
      this.face.hidden = true;
      this.cardImg.hidden = true;
      this.cubeHint.hidden = false;
    }
    this.cam = { z: 1, fx: 0.5, fy: 0.5 };
    this.pz = 0;
    this.fit();
  }

  // ---------- камера ----------

  private vp() {
    return { w: this.wrap.clientWidth, h: this.wrap.clientHeight };
  }

  private maxZ() {
    if (!this.b || !this.bw) return 4;
    // до полного разрешения скана (с запасом на плотные экраны), но не меньше 3
    return Math.max(3, Math.min(8, (this.b.img.src[0] * 1.3) / this.bw));
  }

  private fit() {
    if (!this.b) return;
    const r = this.vp();
    // снизу — кнопки вида: общая карта их не перекрывает
    const k = Math.min(Math.max(0, r.w - 16) / this.b.img.w, Math.max(0, r.h - (this.ctx.demo ? 16 : 62)) / this.b.img.h);
    this.bw = this.b.img.w * k;
    this.bh = this.b.img.h * k;
    this.board.style.width = `${this.bw}px`;
    this.board.style.height = `${this.bh}px`;
    this.apply(this.cam);
    // первый крупный кадр — как только у стола появился размер и карта видна (до броска, а не под пальцем после него)
    if (!this.pz && this.bw && this.v && !this.ctx.demo && this.board.classList.contains('ready')) void this.frameTurn();
  }

  /** Кадр без выхода краёв поля внутрь экрана. */
  private clamp(c: Cam): Cam {
    const r = this.vp();
    const z = Math.max(1, Math.min(this.maxZ(), c.z));
    const cl = (f: number, size: number, view: number) => {
      const half = view / (2 * z * size);
      return half >= 0.5 ? 0.5 : Math.max(half, Math.min(1 - half, f));
    };
    return { z, fx: cl(c.fx, this.bw || 1, r.w), fy: cl(c.fy, this.bh || 1, r.h) };
  }

  private apply(c: Cam) {
    if (!this.bw) return;
    const r = this.vp();
    this.cam = this.clamp(c);
    const { z, fx, fy } = this.cam;
    // общая карта чуть выше центра — под ней панель кнопок вида
    const oy = this.ctx.demo ? 0 : 23 * Math.max(0, Math.min(1, 2 - z));
    this.oy = oy;
    this.board.style.transform = `translate(${r.w / 2 - fx * this.bw * z}px, ${r.h / 2 - oy - fy * this.bh * z}px) scale(${z})`;
    this.wrap.classList.toggle('zoomed', z > 1.02);
    this.mini.hidden = z < 1.15 || this.ctx.demo;
    this.drawMini();
    this.queueTiles();
  }

  /** Один кадр движка: перелёт по кривой или плавная доводка к цели. */
  private frame = (now: number) => {
    this.raf = 0;
    const tw = this.tween;
    if (tw) {
      const t = Math.min(1, (now - tw.t0) / tw.ms);
      const e = ease(t);
      const lz = Math.log(tw.from.z) + (Math.log(tw.to.z) - Math.log(tw.from.z)) * e - tw.bump * Math.sin(Math.PI * t);
      // сдвиг идёт, пока камера отъехала (центр кадра — по той же кривой)
      this.apply({ z: Math.exp(lz), fx: tw.from.fx + (tw.to.fx - tw.from.fx) * e, fy: tw.from.fy + (tw.to.fy - tw.from.fy) * e });
      if (t >= 1) {
        this.tween = null;
        this.board.classList.remove('moving');
        tw.done();
      } else this.raf = requestAnimationFrame(this.frame);
      return;
    }
    const g = this.goal;
    if (!g) return;
    const lz = Math.log(this.cam.z) + (Math.log(g.z) - Math.log(this.cam.z)) * 0.25;
    let z = Math.exp(lz);
    if (Math.abs(Math.log(g.z / z)) < 0.002) z = g.z;
    let fx: number;
    let fy: number;
    if (g.ax != null) {
      // точка поля (bx, by) остаётся под экранной (ax, ay)
      const r = this.vp();
      fx = (r.w / 2 - g.ax + g.bx! * z) / z / this.bw;
      fy = (r.h / 2 - g.ay! + g.by! * z) / z / this.bh;
    } else {
      fx = this.cam.fx + (g.fx - this.cam.fx) * 0.25;
      fy = this.cam.fy + (g.fy - this.cam.fy) * 0.25;
    }
    this.apply({ z, fx, fy });
    if (z === g.z && (g.ax != null || (Math.abs(fx - g.fx) < 1e-4 && Math.abs(fy - g.fy) < 1e-4))) {
      this.goal = null;
      this.board.classList.remove('moving');
    } else this.raf = requestAnimationFrame(this.frame);
  };

  private kick() {
    this.board.classList.add('moving');
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private stopCam() {
    if (this.tween) {
      const d = this.tween.done;
      this.tween = null;
      d();
    }
    this.goal = null;
    this.board.classList.remove('moving');
  }

  /** Приблизить в k раз (плавно), точка экрана (px, py) остаётся на месте. */
  private zoomAt(px: number, py: number, z: number) {
    if (this.tween) this.stopCam();
    const cur = this.cam;
    const r = this.vp();
    const tz = this.clamp({ ...cur, z: z }).z;
    const base = this.goal?.ax != null && Math.abs(this.goal.ax - px) < 2 && Math.abs(this.goal.ay! - py) < 2 ? this.goal : null;
    const bx = base ? base.bx! : (px - (r.w / 2 - cur.fx * this.bw * cur.z)) / cur.z;
    const by = base ? base.by! : (py - (r.h / 2 - cur.fy * this.bh * cur.z)) / cur.z;
    this.goal = { z: tz, fx: cur.fx, fy: cur.fy, ax: px, ay: py, bx, by };
    this.prefetch({ z: tz, fx: (r.w / 2 - px + bx * tz) / tz / this.bw, fy: (r.h / 2 - py + by * tz) / tz / this.bh });
    this.kick();
  }

  private zoomBy(k: number) {
    const r = this.vp();
    this.manual = true;
    this.zoomAt(r.w / 2, r.h / 2, (this.goal?.z ?? this.cam.z) * k);
    this.pz = this.goal?.z ?? this.cam.z;
  }

  private overview() {
    this.manual = true;
    this.pz = 1;
    void this.fly({ z: 1, fx: 0.5, fy: 0.5 });
  }

  /** Перелёт: на дальних переходах камера отъезжает, чтобы было видно, откуда и куда. */
  private fly(to: Cam, ms?: number): Promise<void> {
    this.stopCam();
    const from = { ...this.cam };
    to = this.clamp(to);
    const r = this.vp();
    // насколько надо отъехать, чтобы в кадре были обе точки
    const dx = Math.abs(to.fx - from.fx) * this.bw;
    const dy = Math.abs(to.fy - from.fy) * this.bh;
    const zBoth = Math.max(1, Math.min(r.w / (dx + r.w / Math.max(from.z, to.z)), r.h / (dy + r.h / Math.max(from.z, to.z))));
    const mid = (Math.log(from.z) + Math.log(to.z)) / 2;
    const bump = Math.max(0, mid - Math.log(zBoth));
    const far = Math.hypot(dx * from.z, dy * from.z) / Math.max(1, Math.hypot(r.w, r.h));
    const dur = ms ?? Math.min(1500, 450 + 380 * bump + 250 * Math.min(1, far));
    if (Math.abs(Math.log(to.z / from.z)) < 0.01 && dx < 1 && dy < 1) {
      this.apply(to);
      return Promise.resolve();
    }
    this.prefetch(to);
    return new Promise((done) => {
      this.tween = { from, to, t0: performance.now(), ms: dur / Math.max(0.5, this.ctx.speed()), bump, done };
      this.kick();
    });
  }

  /** Показать клетки (камера следит за ходом). force — по кнопке «Где ход», даже если слежение выключено. */
  private frameCells(cells: number[], force = false): Promise<void> {
    const b = this.b;
    if (!b || !this.bw || !cells.length || (!force && (!this.follow || this.manual))) return Promise.resolve();
    // пуговицу держат пальцем — не уводить карту из-под него
    if (!force && this.gesture?.kind === 'token') return Promise.resolve();
    const xs = cells.map((i) => b.cells[i].x / b.img.w);
    const ys = cells.map((i) => b.cells[i].y / b.img.h);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const r = this.vp();
    const pad = b.token * 3;
    const w = (x1 - x0 + pad * 2) * this.bw;
    const hh = (y1 - y0) * this.bh + pad * 2 * this.bw;
    // крупно: пуговица на экране — около 46 px; дальше держим масштаб игрока, отъезжая, только если нужное не влезает
    const first = !this.pz;
    if (force || first) this.pz = Math.max(1.6, Math.min(this.maxZ() * 0.7, 46 / (b.token * this.bw)));
    if (force || first) return this.fly({ z: Math.max(1, Math.min(this.pz, r.w / w, r.h / hh)), fx: (x0 + x1) / 2, fy: (y0 + y1) / 2 });
    // мёртвая зона: пока нужное в средней части кадра, камера стоит. Масштаб тоже держится: отъезд — только если
    // нужное не влезает, приближение — только когда влезет заметно крупнее.
    const c = this.cam;
    const p = b.token * 1.5;
    const py = (p * this.bw) / this.bh;
    const box = (ids: number[]) => {
      const bx = ids.map((i) => b.cells[i].x / b.img.w);
      const by = ids.map((i) => b.cells[i].y / b.img.h);
      const [x0, x1, y0, y1] = [Math.min(...bx), Math.max(...bx), Math.min(...by), Math.max(...by)];
      return { x0, x1, y0, y1, fit: Math.min((r.w * 0.8) / ((x1 - x0 + 2 * p) * this.bw), (r.h * 0.8) / ((y1 - y0 + 2 * py) * this.bh)) };
    };
    // в кадре все пуговицы (и куда идёт ход), а не только того, кто ходит: чужие ходы внутри кадра камеру не двигают.
    // Разбежались — камера отъезжает, вплоть до всей карты; собрались — снова ближе.
    const t = box([...cells, ...(this.v?.seats.map((s) => this.shown[s]) ?? [])]);
    const bz = Math.min(this.pz, t.fit);
    const z = this.clamp({ ...c, z: c.z > t.fit ? t.fit : c.z < bz * 0.75 ? bz : c.z }).z;
    // вышло к краю — сдвиг ровно настолько, чтобы нужное оказалось ближе к середине (с запасом на следующий ход)
    const axis = (f: number, lo: number, hi: number, view: number, size: number, p: number) => {
      const half = view / (2 * z * size);
      if (lo - p >= f - half * 0.8 && hi + p <= f + half * 0.8) return f;
      const aim = Math.min(half * 0.8, Math.max(half * 0.5, (hi - lo) / 2 + p));
      return Math.max(hi + p - aim, Math.min(lo - p + aim, f));
    };
    const to = this.clamp({ z, fx: axis(c.fx, t.x0, t.x1, r.w, this.bw, p), fy: axis(c.fy, t.y0, t.y1, r.h, this.bh, py) });
    const still = Math.abs(Math.log(to.z / c.z)) < 0.03 && Math.abs(to.fx - c.fx) * this.bw * z < 2 && Math.abs(to.fy - c.fy) * this.bh * z < 2;
    return still ? Promise.resolve() : this.fly(to);
  }

  /** Кадр на ход: пуговица того, кто ходит, и куда она пойдёт. */
  private frameTurn(force = false) {
    const v = this.v;
    const b = this.b;
    if (!v || !b || v.winner != null) return Promise.resolve();
    const s = v.turn;
    const cells = [this.shown[s] ?? v.pos[s]];
    if ((v.phase ?? 'roll') === 'move') cells.push(target(v, b, s));
    return this.frameCells(cells, force);
  }

  // ---------- тайлы ----------

  private queueTiles() {
    if (this.tilesQueued) return;
    this.tilesQueued = true;
    requestAnimationFrame(() => {
      this.tilesQueued = false;
      this.updateTiles(this.cam, true);
    });
  }

  /** Тайлы кадра c заранее — пока камера летит туда. */
  private prefetch(c: Cam) {
    this.updateTiles(this.clamp(c), false);
  }

  /** Нужный уровень и видимые тайлы кадра c; show — переключить видимость слоёв под этот кадр. */
  private updateTiles(c: Cam, show: boolean) {
    const b = this.b;
    if (!b || !this.bw || !b.img.levels) return;
    const need = this.bw * c.z * (window.devicePixelRatio || 1);
    let lv = -1;
    if (need > VIEW_W * 1.1) {
      lv = 0;
      for (let l = b.img.levels - 1; l >= 0; l--) {
        if (b.img.src[0] / 2 ** l >= need * 0.85) {
          lv = l;
          break;
        }
      }
    }
    if (show) this.layers.forEach((el, l) => (el.style.display = lv >= 0 && l >= lv ? '' : 'none'));
    if (lv < 0) return;
    const lw = Math.ceil(b.img.src[0] / 2 ** lv);
    const lh = Math.ceil(b.img.src[1] / 2 ** lv);
    const r = this.vp();
    const hw = r.w / (2 * c.z * this.bw) + 0.02;
    const hv = r.h / (2 * c.z * this.bh) + 0.02;
    const c0 = Math.max(0, Math.floor(((c.fx - hw) * lw) / TILE));
    const c1 = Math.min(Math.ceil(lw / TILE) - 1, Math.floor(((c.fx + hw) * lw) / TILE));
    const r0 = Math.max(0, Math.floor(((c.fy - hv) * lh) / TILE));
    const r1 = Math.min(Math.ceil(lh / TILE) - 1, Math.floor(((c.fy + hv) * lh) / TILE));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const key = `${lv}/${col}_${row}`;
        if (this.tiles.has(key)) continue;
        const img = document.createElement('img');
        img.className = 'ks-tile';
        img.alt = '';
        img.draggable = false;
        img.decoding = 'async';
        img.onload = () => img.classList.add('ok');
        const tw = Math.min(TILE + 1, lw - col * TILE);
        const th = Math.min(TILE + 1, lh - row * TILE);
        img.style.cssText = `left:${((col * TILE) / lw) * 100}%;top:${((row * TILE) / lh) * 100}%;width:${(tw / lw) * 100}%;height:${(th / lh) * 100}%`;
        img.src = `${b.img.dir}/${key}.webp`;
        this.layers[lv].appendChild(img);
        this.tiles.set(key, img);
      }
    }
  }

  // ---------- миникарта ----------

  private drawMini() {
    if (this.mini.hidden || !this.b || !this.v) return;
    const r = this.vp();
    const { z, fx, fy } = this.cam;
    const w = Math.min(1, r.w / (z * this.bw));
    const hh = Math.min(1, r.h / (z * this.bh));
    Object.assign(this.miniVp.style, { left: `${(fx - w / 2) * 100}%`, top: `${(fy - hh / 2) * 100}%`, width: `${w * 100}%`, height: `${hh * 100}%` });
    for (const s of this.v.seats) {
      if (this.b?.race && this.puckSeat(s) !== s) continue;
      let d = this.miniDots.get(s);
      if (!d) {
        const puck = this.b?.race?.pucks?.[trackOf(this.b, s)];
        d = h(`<i class="ks-mini-dot" style="background-image:url(${puck ?? `/hodilki/buttons/${s}.webp`})"></i>`);
        this.mini.appendChild(d);
        this.miniDots.set(s, d);
      }
      const cell = this.b.cells[this.shown[s] ?? 0];
      d.style.left = `${(cell.x / this.b.img.w) * 100}%`;
      d.style.top = `${(cell.y / this.b.img.h) * 100}%`;
      d.classList.toggle('on', this.v.turn === s);
    }
    this.placeMini();
  }

  /** Экранные точки, которые миникарта не должна закрывать: пуговицы и клетка хода. */
  private hotPoints() {
    const b = this.b!;
    const v = this.v!;
    const r = this.vp();
    const { z, fx, fy } = this.cam;
    const ids = (b.race ? v.seats.filter((s) => this.puckSeat(s) === s) : v.seats).map((s) => this.shown[s] ?? 0);
    if (v.winner == null && (v.phase ?? 'roll') === 'move') ids.push(target(v, b, v.turn));
    return ids.map((i) => ({
      x: r.w / 2 - fx * this.bw * z + (b.cells[i].x / b.img.w) * this.bw * z,
      y: r.h / 2 - this.oy - fy * this.bh * z + (b.cells[i].y / b.img.h) * this.bh * z,
    }));
  }

  private placeMini() {
    const r = this.vp();
    const mw = this.mini.offsetWidth;
    const mh = this.mini.offsetHeight;
    if (!mw || !mh) return;
    const pts = this.hotPoints();
    const pad = 28;
    const box = (c: 'bl' | 'tl' | 'tr') => {
      const x0 = c === 'tr' ? r.w - 10 - mw : 10;
      const y0 = c === 'bl' ? r.h - 10 - mh : 10;
      return { x0: x0 - pad, x1: x0 + mw + pad, y0: y0 - pad, y1: y0 + mh + pad };
    };
    const free = (c: 'bl' | 'tl' | 'tr') => {
      const q = box(c);
      return !pts.some((p) => p.x > q.x0 && p.x < q.x1 && p.y > q.y0 && p.y < q.y1);
    };
    if (!free(this.corner)) {
      const next = (['bl', 'tl', 'tr'] as const).find(free);
      if (next) this.corner = next;
    } else if (this.corner !== 'bl' && free('bl')) this.corner = 'bl';
    this.mini.dataset.corner = this.corner;
  }

  // ---------- жесты ----------

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = this.wrap.getBoundingClientRect();
    this.manual = true;
    // колесо в строках или страницах — в пиксели
    const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    const k = Math.exp(-Math.max(-120, Math.min(120, dy)) * 0.0035);
    this.zoomAt(e.clientX - r.left, e.clientY - r.top, (this.goal?.z ?? this.cam.z) * k);
    this.pz = this.goal?.z ?? this.cam.z;
  }

  /** Точка экрана → координаты на картинке поля. */
  private toImg(clientX: number, clientY: number) {
    const r = this.board.getBoundingClientRect();
    const b = this.b!;
    return { x: ((clientX - r.left) / r.width) * b.img.w, y: ((clientY - r.top) / r.height) * b.img.h };
  }

  private nearest(x: number, y: number) {
    const b = this.b!;
    let best = -1;
    let bd = Infinity;
    b.cells.forEach((c, i) => {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return { i: best, d: bd };
  }

  private onDown(e: PointerEvent) {
    if (this.ctx.demo || (e.target as HTMLElement).closest('.ks-cam, .ks-mini')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const tok = ((e.target as HTMLElement).closest('.ks-token') as HTMLElement | null) ?? this.nearMine(e.clientX, e.clientY);
    if (this.ptrs.size === 2) {
      // щипок: отпустить пуговицу, если тащили
      if (this.gesture?.kind === 'token') this.dropToken(null);
      this.stopCam();
      const [a, b] = [...this.ptrs.values()];
      this.gesture = { kind: 'pan', x0: (a.x + b.x) / 2, y0: (a.y + b.y) / 2, moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    } else if (tok && this.canMove() && +tok.dataset.seat! === this.puckSeat(this.actSeat!)) {
      this.stopCam();
      this.gesture = { kind: 'token', x0: e.clientX, y0: e.clientY, moved: false };
    } else {
      this.gesture = { kind: 'pan', x0: e.clientX, y0: e.clientY, moved: false };
    }
    this.wrap.setPointerCapture(e.pointerId);
  }

  /** Своя пуговица рядом с точкой нажатия (палец крупнее пуговицы, а рядом — чужие). */
  private nearMine(x: number, y: number): HTMLElement | null {
    if (!this.canMove()) return null;
    const el = this.myToken();
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const reach = Math.max(26, r.width * 0.9);
    return Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) < reach ? el : null;
  }

  private onMove(e: PointerEvent) {
    const p = this.ptrs.get(e.pointerId);
    const g = this.gesture;
    if (!p || !g) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const r = this.wrap.getBoundingClientRect();
    if (this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      this.manual = true;
      this.panBy(mx - g.x0, my - g.y0);
      if (g.dist) this.pinch(mx - r.left, my - r.top, dist / g.dist);
      g.x0 = mx;
      g.y0 = my;
      g.dist = dist;
      return;
    }
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.moved && Math.hypot(dx, dy) < 6) return;
    if (g.kind === 'token') {
      const el = this.myToken();
      if (!el || !this.canMove()) return;
      if (!g.moved) {
        g.moved = true;
        el.classList.add('drag', 'lifted');
        this.picked = true;
        this.showMarks(true);
      }
      const q = this.toImg(e.clientX, e.clientY);
      el.style.left = `${(q.x / this.b!.img.w) * 100}%`;
      el.style.top = `${(q.y / this.b!.img.h) * 100}%`;
      return;
    }
    if (this.cam.z <= 1.02) return;
    if (!g.moved) this.stopCam();
    g.moved = true;
    this.manual = true;
    this.panBy(dx, dy);
    g.x0 = e.clientX;
    g.y0 = e.clientY;
  }

  private panBy(dx: number, dy: number) {
    const c = this.cam;
    this.apply({ z: c.z, fx: c.fx - dx / (this.bw * c.z), fy: c.fy - dy / (this.bh * c.z) });
  }

  /** Щипок — сразу, без доводки (за пальцами). */
  private pinch(px: number, py: number, k: number) {
    const c = this.cam;
    const r = this.vp();
    const z = Math.max(1, Math.min(this.maxZ(), c.z * k));
    const bx = (px - (r.w / 2 - c.fx * this.bw * c.z)) / c.z;
    const by = (py - (r.h / 2 - c.fy * this.bh * c.z)) / c.z;
    this.apply({ z, fx: (r.w / 2 - px + bx * z) / z / this.bw, fy: (r.h / 2 - py + by * z) / z / this.bh });
    this.pz = this.cam.z;
  }

  private onUp(e: PointerEvent, cancel = false) {
    if (!this.ptrs.delete(e.pointerId)) return;
    const g = this.gesture;
    if (this.ptrs.size) {
      // после щипка остался один палец — дальше просто сдвиг
      const [a] = [...this.ptrs.values()];
      this.gesture = { kind: 'pan', x0: a.x, y0: a.y, moved: true };
      this.eatClick = true;
      return;
    }
    this.gesture = null;
    if (!g) return;
    if (g.moved) this.eatClick = true;
    if (g.kind === 'token') {
      if (g.moved) this.dropToken(cancel ? null : e);
      else {
        // нажали на свою пуговицу — взять / положить обратно
        this.eatClick = true;
        this.pick(!this.picked);
      }
    }
  }

  /** Отпустили перетаскиваемую пуговицу: на нужной клетке — ход, иначе вернуть на место. */
  private dropToken(e: PointerEvent | null) {
    const seat = this.actSeat;
    const el = this.myToken();
    if (!el || seat == null || !this.v || !this.b) return;
    el.classList.remove('drag');
    if (e && this.canMove()) {
      const q = this.toImg(e.clientX, e.clientY);
      const n = this.nearest(q.x, q.y);
      if (n.i === target(this.v, this.b, seat) && n.d < this.b.token * this.b.img.w * 1.6) return this.commit(true);
    }
    this.picked = false;
    el.classList.remove('lifted');
    this.showMarks(false);
    this.place();
    Sound.nomove();
  }

  private onClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.ks-cam, .ks-mini')) return;
    if (this.eatClick) {
      this.eatClick = false;
      e.preventDefault();
      return;
    }
    if (!this.canMove() || !this.v || !this.b) return;
    e.preventDefault();
    // пуговица взята: щелчок по клетке назначения — ход, мимо — положить обратно
    if (!this.picked) return;
    const q = this.toImg(e.clientX, e.clientY);
    const n = this.nearest(q.x, q.y);
    if (n.i === target(this.v, this.b, this.actSeat!) && n.d < this.b.token * this.b.img.w * 1.4) this.commit(false);
    else this.pick(false);
  }

  // ---------- состояние и анимации ----------

  private die(n: number | null) {
    const b = this.b;
    const v = this.v;
    if (!n || !v) return;
    // «Шайба»: показываем грань кубика, а на клюшке — ещё и вытянутый квадратик
    if (b?.race) {
      const face = v.kind === 'red' ? b.race.die.stick : v.kind === 'green' ? b.race.die.stick + 1 : n;
      this.showFace(face, v.card ?? null, v.cardSlot ?? null);
      return;
    }
    this.tray.show([n]);
  }

  /** Грань кубика «Шайбы» (очки или клюшка) и квадратик, если выпала клюшка. */
  private showFace(face: number, card: number | null, slot: number | null) {
    const dir = '/hodilki/shayba';
    this.face.src = face === 5 ? `${dir}/cube-stick-red.webp` : face === 6 ? `${dir}/cube-stick-green.webp` : `${dir}/cube-pips-${face}.webp`;
    this.face.hidden = false;
    this.cubeHint.hidden = true;
    const stick = (face === 5 || face === 6) && card != null;
    this.cardImg.hidden = !stick;
    if (stick) this.cardImg.src = `${dir}/cards/ochko${card}-0${((slot ?? 0) % 5) + 1}.webp`;
  }

  /** Бросок кубика «Шайбы»: как обычные кубики — стук костей и кувыркание.
   * Грань с очками кувыркается, а клюшку не крутим (её не «бросают», а показывают) — вместо этого
   * из мешочка вынимается квадратик. */
  private async rollRaceDie(face: number, card: number | null, slot: number | null, speed: number) {
    const dir = '/hodilki/shayba';
    const dur = Math.round(1000 / Math.max(0.5, speed));
    const stick = face >= 5;
    this.cubeHint.hidden = true;
    this.cardImg.hidden = true;
    this.face.src = face === 5 ? `${dir}/cube-stick-red.webp` : face === 6 ? `${dir}/cube-stick-green.webp` : `${dir}/cube-pips-${face}.webp`;
    this.face.hidden = false;
    Sound.diceRoll(dur / 1000);
    if (stick) {
      // клюшка: грань просто ложится, а квадратик вытягивается из мешочка
      await this.face.animate([{ opacity: 0, transform: 'scale(0.72)' }, { opacity: 1, transform: 'scale(1)' }], { duration: Math.round(260 / speed), easing: 'ease-out' }).finished;
      if (card != null) {
        this.cardImg.src = `${dir}/cards/ochko${card}-0${((slot ?? 0) % 5) + 1}.webp`;
        this.cardImg.hidden = false;
        Sound.ui();
        await this.cardImg.animate([{ opacity: 0, transform: 'translateY(-18px) scale(0.8)' }, { opacity: 1, transform: 'none' }], { duration: Math.round(280 / speed), easing: 'ease-out' }).finished;
      }
    } else {
      const spin = (Math.random() < 0.5 ? -1 : 1) * 360 * (2 + Math.floor(Math.random() * 2));
      await this.face.animate(
        [
          { transform: 'translate(-16px, -12px) rotate(-40deg) scale(0.86)', opacity: 0.85, offset: 0 },
          { transform: `translate(8px, 5px) rotate(${spin * 0.7}deg) scale(1.04)`, opacity: 1, offset: 0.62 },
          { transform: `translate(0, 0) rotate(${spin}deg) scale(1)`, offset: 1 },
        ],
        { duration: dur, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' }
      ).finished;
    }
    await sleep(140 / speed);
  }

  /** Заранее загрузить и раскодировать картинки «Шайбы» (грани кубика, квадратики, шайбы) —
   * тогда после броска они показываются сразу, вместе с полем. */
  private preloadRace() {
    if (this.artFaces.length) return;
    const dir = '/hodilki/shayba';
    const load = (url: string) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      img.decode?.().catch(() => {});
      return img;
    };
    this.artFaces = [1, 2, 3, 4].map((n) => load(`${dir}/cube-pips-${n}.webp`));
    this.artFaces.push(load(`${dir}/cube-stick-red.webp`), load(`${dir}/cube-stick-green.webp`));
    for (let pips = 1; pips <= 3; pips++) for (let v = 1; v <= 5; v++) this.artCards.push(load(`${dir}/cards/ochko${pips}-0${v}.webp`));
    for (const p of this.b?.race?.pucks ?? []) load(p);
  }

  private say(text: string, good: boolean) {
    this.note.textContent = text;
    this.note.className = `ks-note ${good ? 'good' : 'bad'}`;
    this.note.hidden = false;
    this.note.animate([{ opacity: 0, transform: 'translate(-50%, -8px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 220 });
  }

  setView(v: State) {
    this.useBoard(v.map);
    this.v = v;
    this.shown = v.pos.slice();
    this.die(v.last);
    this.note.hidden = true;
    this.place();
  }

  async play(events: Event[], v: State) {
    const speed = this.ctx.speed();
    this.busy = true;
    this.picked = false;
    this.showMarks(false);
    for (const ev of events) {
      if (ev.type === 'roll') {
        this.note.hidden = true;
        // кадр «откуда и куда» — пока катится кубик: к ходу камера уже стоит и не уезжает из-под пальца
        const b = this.b;
        const to = b && v.turn === ev.seat && (v.phase ?? 'roll') === 'move' ? target(v, b, ev.seat) : null;
        void this.frameCells(to != null ? [this.shown[ev.seat], to] : [this.shown[ev.seat]]);
        if (this.b?.race) await this.rollRaceDie(ev.die, ev.card ?? null, ev.slot ?? null, speed);
        else await this.tray.roll([ev.die], speed);
      } else if (ev.type === 'move') {
        const last = ev.path[ev.path.length - 1];
        if (last == null || this.shown[ev.seat] === last) continue; // пуговицу уже поставили руками
        await this.frameCells([this.shown[ev.seat], last]);
        const el = this.tokens.get(ev.seat);
        el?.classList.add('lifted');
        await sleep(160 / speed);
        for (const p of ev.path) {
          this.shown[ev.seat] = p;
          this.place();
          Sound.step();
          await sleep(200 / speed);
        }
        el?.classList.remove('lifted');
        Sound.place();
        await sleep(120 / speed);
      } else if (ev.type === 'sign') {
        const good = signGood(ev.sign);
        const story = ev.text ?? this.b?.cells[this.shown[ev.seat]]?.text;
        this.say(`${story ? story + ' ' : ''}${strip(this.ctx.name(ev.seat))} ${signText(ev.sign)}${good ? '!' : '.'}`, good);
        // дать прочитать: за экраном человек — ждём касания, иначе пауза
        await (this.ctx.read ? this.ctx.read(story ? 1600 : 700) : sleep(500 / speed));
        if (ev.to !== this.shown[ev.seat]) {
          // перелёт: камера показывает и откуда, и куда; место назначения подгружается заранее
          await this.frameCells([this.shown[ev.seat], ev.to]);
          const el = this.tokens.get(ev.seat);
          el?.classList.add('fly', 'lifted');
          await sleep(140 / speed);
          this.shown[ev.seat] = ev.to;
          this.place();
          if (good) Sound.jump();
          else Sound.nomove();
          await sleep(850 / speed);
          el?.classList.remove('fly', 'lifted');
          Sound.place();
          void this.frameCells([ev.to]);
        } else if (good) Sound.jump();
        else Sound.nomove();
        await sleep(400 / speed);
      } else if (ev.type === 'skip') {
        this.say(`${strip(this.ctx.name(ev.seat))} пропускает ход.`, false);
        await sleep(650 / speed);
      } else if (ev.type === 'goal') {
        // шайба в воротах: показываем гол и возвращаем её в центр
        const trail = this.b?.race?.tracks[ev.track];
        if (trail) {
          this.say(`🥅 Гол! ${strip(this.ctx.name(ev.seat))} — ${ev.goals} (до ${ev.target}).`, true);
          Sound.win();
          await this.frameCells([trail[trail.length - 1], trail[0]]);
          const el = this.tokens.get(this.puckSeat(ev.seat));
          el?.classList.add('fly', 'lifted');
          await (this.ctx.read ? this.ctx.read(1500) : sleep(900 / speed));
          this.shown[ev.seat] = trail[0];
          this.place();
          await sleep(700 / speed);
          el?.classList.remove('fly', 'lifted');
          Sound.place();
        }
      } else if (ev.type === 'win') Sound.win();
    }
    this.useBoard(v.map);
    this.v = v;
    this.shown = v.pos.slice();
    this.busy = false;
    this.place();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    this.phase = (v?.phase ?? 'roll') as 'roll' | 'move' | 'pick' | 'ask' | 'answer' | 'judge';
    this.actSeat = v && v.winner == null ? (interactive.find((x) => x === v.turn) ?? null) : null;
    if (this.actSeat == null) this.picked = false;
    // загадка («Лукоморье»): показываем вопрос и ответы тому, кто ходит
    const sign = v ? boardOf(v.map).cells[v.pos[v.turn]]?.sign : null;
    const quiz = this.phase === 'pick' && sign?.k === 'pick' ? sign : null;
    const ask = quiz && this.actSeat != null;
    this.quizBox.hidden = !ask;
    if (ask && quiz) {
      this.qText.textContent = quiz.question;
      this.answers.replaceChildren(
        ...quiz.options.map((label, i) => {
          const btn = document.createElement('button');
          btn.className = 'btn ks-answer';
          btn.textContent = label;
          btn.onclick = () => {
            const seat = this.actSeat;
            this.actSeat = null;
            this.quizBox.hidden = true;
            Sound.ui();
            if (seat != null) this.ctx.act(seat, { type: 'pick', pick: i });
          };
          return btn;
        })
      );
    }
    this.rollBtn.hidden = this.actSeat == null || this.phase !== 'roll';
    // загадка остальным («Лукоморье», поле 4): загадать, ответить или судить
    const r = v?.riddle ?? null;
    const rOn = (this.phase === 'ask' || this.phase === 'answer' || this.phase === 'judge') && !!r;
    this.rBox.hidden = !rOn;
    if (rOn && r) {
      this.rText.textContent = r.text ? `Загадка: «${r.text}»` : `${this.ctx.name(r.by)} загадывает загадку…`;
      this.rReplies.textContent = r.replies.length
        ? r.replies.map((x) => `${this.ctx.name(x.seat)}: «${x.text}»`).join(' · ')
        : '';
      this.rReplies.hidden = !r.replies.length;
      const iAmAsker = this.actSeat != null && r.by === this.actSeat;
      this.rAskerBox.hidden = !(iAmAsker && this.phase === 'ask');
      this.rAnswerBox.hidden = !(this.actSeat != null && this.phase === 'answer');
      this.rJudgeBox.hidden = !(iAmAsker && this.phase === 'judge');
      if (this.phase === 'ask' && iAmAsker) void loadClues().catch(() => undefined);
    }
    this.showMarks(this.picked);
    this.syncTokens();
    // свой ход: камера снова следит (даже если до этого карту двигали) — показать свою пуговицу и куда идти
    if (this.actSeat != null) {
      if (this.phase === 'roll') this.manual = false;
      void this.frameTurn();
    }
  }

  status(v: State, toAct: number[], interactive: number[]) {
    const b = boardOf(v.map);
    const me = interactive.includes(toAct[0]);
    if (b.race) {
      const score = `Счёт ${scoreText(v, b)}${v.target ? ` (до ${v.target})` : ''}.`;
      if (v.winner != null) return `${this.ctx.name(v.winner)}: ${b.winText} — ${scoreText(v, b)}!`;
      if ((v.phase ?? 'roll') === 'move') {
        const what =
          v.kind === 'red'
            ? `🔴 красная клюшка: квадратик на ${v.card} — шайба назад на ${Math.abs(v.last ?? 0)}`
            : v.kind === 'green'
              ? `🟢 зелёная клюшка: квадратик на ${v.card} — шайба вперёд на ${v.last}`
              : `Выпало ${v.last}`;
        return me ? `${what} — возьмите свою шайбу и переставьте. ${score}` : `Ходит ${this.ctx.name(toAct[0])}… ${score}`;
      }
      return me ? `Бросайте кубик. ${score}` : `Бросает ${this.ctx.name(toAct[0])}… ${score}`;
    }
    if (v.winner != null) return `${this.ctx.name(v.winner)}: ${b.winText}!`;
    const ph = v.phase ?? 'roll';
    if (ph === 'ask') {
      return me ? 'Загадайте загадку остальным: свою или из базы вопросов.' : `${this.ctx.name(toAct[0])} загадывает загадку…`;
    }
    if (ph === 'answer') {
      const r = v.riddle;
      return me ? `Загадка: «${r?.text ?? ''}» — назовите ответ.` : `${this.ctx.name(toAct[0])} думает над загадкой…`;
    }
    if (ph === 'judge') {
      return me ? 'Кто-нибудь отгадал загадку?' : `${this.ctx.name(toAct[0])} решает, отгадали ли загадку…`;
    }
    if (ph === 'pick') {
      const q = b.cells[v.pos[v.turn]]?.sign;
      const ask = q?.k === 'pick' ? `Загадка: «${q.question}»` : 'Загадка';
      return me ? `${ask} — выберите ответ` : `${this.ctx.name(toAct[0])} отвечает на загадку…`;
    }
    if ((v.phase ?? 'roll') === 'move') return me ? `Выпало ${v.last} — возьмите свою пуговицу и переставьте` : `Ходит ${this.ctx.name(toAct[0])}…`;
    return me ? 'Бросайте кубик' : `Бросает ${this.ctx.name(toAct[0])}…`;
  }

  playerStats(v: State, seat: number) {
    const b = boardOf(v.map);
    if (b.race) {
      const trail = b.race.tracks[trackOf(b, seat)];
      const at = Math.max(0, trail.indexOf(v.pos[seat]));
      // командой играют вчетвером и вшестером: у команды одна шайба, напарники через одного
      const team = v.seats.length > 2 ? `${trackOf(b, seat) ? 'Б' : 'А'} · ` : '';
      return `${team}шайба ${at + 1}/${trail.length} · голы ${v.goals?.[trackOf(b, seat)] ?? 0}`;
    }
    const n = skipsOf(v, seat);
    // на полях с нумерацией делений (советские настолки) показываем номер с поля, а не индекс клетки
    const here = b.cells[v.pos[seat]];
    const at = here?.off ? '↪' : (here?.label ?? v.pos[seat]);
    const last = b.cells[finishOf(b)]?.label ?? finishOf(b);
    // «Лукоморье»: боны (деньги), предметы и накопленные дополнительные ходы
    const coins = b.coins ? ` · ${b.coins} ${v.coins?.[seat] ?? 0}` : '';
    const extra = v.extra?.[seat] ? ` · +${v.extra[seat]} ход` : '';
    const items = (v.items?.[seat] ?? []).map(itemIcon).join('');
    const bag = items ? ` · ${items}` : '';
    return `${at} / ${last}${coins}${extra}${bag}${n ? ` · пропуск${n > 1 ? ' ×' + n : ''}` : ''}`;
  }

  destroy() {
    this.ro.disconnect();
    this.stopCam();
    if (this.raf) cancelAnimationFrame(this.raf);
    document.removeEventListener('keydown', this.onKey);
  }
}

export function createView(): GameView<State, Event> {
  return new HodilkiView();
}

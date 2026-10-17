/* Вид «Астронавтов»: карта звёздного неба под камерой, корабли-пуговицы, кубик и оригинальные двусторонние карточки:
 * встал корабль на красную точку — карточка появляется рисунком вверх и сама переворачивается текстом; касанием её можно
 * переворачивать туда и обратно. Во втором варианте карточка рисунком вверх — это вопрос, ответ открывается переворотом. */
import { BoardCam, type CamPoint } from '../../core/boardcam';
import { DiceTray } from '../../core/dice';
import { Sound } from '../../core/audio';
import { sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import { H, HOME, TALL, W, at, cardImg, cardOf } from './data';
import { describe, ptsText, type Action, type Event as Ev, type State } from './engine';
import './astro.css';

const PIECE_R = 26;
const nameOf = (seat: number) => SEATS[seat]?.name ?? String(seat);

type CardMode = 'event' | 'quiz' | 'peek';

export function createView(): GameView<State, Ev> {
  let ctx: ViewCtx<Action> | null = null;
  let wrap: HTMLElement | null = null;
  let board: HTMLElement | null = null;
  let over: SVGSVGElement | null = null;
  let panel: HTMLElement | null = null;
  let btns: HTMLElement | null = null;
  let quizBox: HTMLElement | null = null;
  let lastBox: HTMLElement | null = null;
  let note: HTMLElement | null = null;
  let cardEl: HTMLElement | null = null;
  let tray: DiceTray | null = null;
  let cam: BoardCam | null = null;
  let v: State | null = null;
  let actSeat: number | null = null;
  let shown: number[] = [];
  let busy = false;
  /** Какая карточка на экране и можно ли её переворачивать. */
  let card: { n: number; mode: CardMode; flipped: boolean } | null = null;
  /** Последняя карточка партии — открыть ещё раз из панели. */
  let last: number | null = null;
  let resize: ResizeObserver | null = null;
  /** Игрок взял свой корабль (фаза move) — шаги подсвечены ярче. */
  let picked = false;

  /** Ход за этим экраном: кубик брошен, корабль надо переставить самому. */
  const canMove = () => !!v && !busy && v.winner == null && v.phase === 'move' && v.target != null && actSeat === v.turn;

  const speed = () => ctx?.speed?.() ?? 1;
  const wait = (ms: number) => (ctx?.read ? ctx.read(ms) : sleep(ms / speed()));

  const svg = (tag: string, attrs: Record<string, string | number>) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, String(val));
    return e;
  };

  // ------------------------------------------------------------------ карточка

  function showCard(n: number, mode: CardMode, flipped = false) {
    if (!cardEl) return;
    card = { n, mode, flipped };
    cardEl.classList.toggle('as-tall', TALL.has(n));
    cardEl.classList.toggle('as-locked', mode === 'quiz');
    cardEl.classList.toggle('as-peek', mode === 'peek');
    cardEl.classList.remove('as-flipped');
    const [front, back] = Array.from(cardEl.querySelectorAll('img')) as HTMLImageElement[];
    front.src = cardImg(n, 'a');
    back.src = cardImg(n, 'b');
    const c = cardOf(n);
    front.alt = mode === 'quiz' ? 'Карточка: рисунок' : `${c.planet ? 'Планета' : 'Созвездие'} ${c.name}`;
    // в вопросе ответ не подсказываем даже подписью картинки
    back.alt = mode === 'quiz' ? '' : `${n ? `${n}. ` : ''}${c.planet ? 'Планета' : 'Созвездие'} ${c.name}`;
    (cardEl.querySelector('.as-card-cap') as HTMLElement).textContent =
      mode === 'quiz' ? 'Что это? Ответ — в панели. Карточка перевернётся, когда ответите.' : 'Нажмите на карточку, чтобы перевернуть';
    cardEl.hidden = false;
    fitCard();
    if (flipped) requestAnimationFrame(() => flip(true));
    if (mode !== 'quiz') last = n;
  }

  /** Карточка целиком помещается в окно поля: по ширине и по высоте (место под подписью). */
  function fitCard() {
    if (!cardEl || !wrap || !card) return;
    const tall = TALL.has(card.n);
    const ratio = tall ? 552 / 720 : 720 / 552;
    const w = Math.min(tall ? 340 : 460, wrap.clientWidth * 0.88, (wrap.clientHeight - 64) * ratio);
    cardEl.style.width = `${Math.max(120, Math.round(w))}px`;
  }

  function flip(to?: boolean) {
    if (!card || !cardEl) return;
    card.flipped = to ?? !card.flipped;
    cardEl.classList.toggle('as-flipped', card.flipped);
  }

  function hideCard() {
    card = null;
    if (cardEl) cardEl.hidden = true;
    renderLast();
  }

  /** Касания карточки ловим раньше стола: иначе «нажмите, чтобы продолжить» закроет её, а тап по доске бросит кубик. */
  const onCardPointer = (e: globalThis.Event) => {
    if (!cardEl || cardEl.hidden) return;
    const t = e.target as HTMLElement | null;
    if (!t || !cardEl.contains(t)) return;
    e.stopPropagation();
    if (e.type !== 'click') return;
    e.preventDefault();
    if (t.closest('.as-card-x')) {
      hideCard();
      return;
    }
    if (card && card.mode !== 'quiz') {
      flip();
      Sound.place?.();
    }
  };

  // ------------------------------------------------------------------ поле

  function pieces() {
    const st = v!;
    const groups = new Map<number, number[]>();
    for (const seat of st.seats) {
      const p = Math.min(shown[seat] ?? st.pos[seat], HOME);
      const key = p >= HOME ? 0 : p;
      groups.set(key, [...(groups.get(key) ?? []), seat]);
    }
    for (const [cell, list] of groups) {
      const c = at(cell);
      list.forEach((seat, i) => {
        // на Земле корабли стоят рядком, на точках — веером
        const off = list.length > 1 ? (i - (list.length - 1) / 2) * (cell === 0 ? 46 : 30) : 0;
        const dy = cell === 0 ? 40 : list.length > 1 ? -Math.abs(off) * 0.3 : 0;
        const x = c.x + off;
        const y = c.y + dy;
        if (st.winner == null && seat === st.turn) over!.append(svg('circle', { cx: x, cy: y, r: PIECE_R + 9, class: 'as-turn' }));
        const mine = seat === st.turn && canMove();
        const lift = mine && picked ? 10 : 0;
        over!.append(
          svg('image', {
            x: x - PIECE_R, y: y - PIECE_R - lift, width: PIECE_R * 2, height: PIECE_R * 2,
            href: `/hodilki/buttons/${seat}.webp`, class: `as-piece${mine ? ' as-mine' : ''}${lift ? ' as-lifted' : ''}`,
          })
        );
      });
    }
  }

  function turnPoints(): CamPoint[] {
    const st = v;
    if (!st || st.winner != null) return [];
    const seat = st.turn;
    const p = shown[seat] ?? st.pos[seat];
    const pts = [at(p)];
    const end = st.phase === 'move' && st.target != null ? st.target : p + 6;
    for (let k = p + 1; k <= end; k++) if (k <= HOME) pts.push(at(k));
    return pts;
  }

  /** Фаза move: шаги до точки назначения и сама точка (как в кинь-двинь). */
  function marks() {
    const st = v!;
    if (busy || st.phase !== 'move' || st.target == null) return;
    const from = st.pos[st.turn];
    const mine = canMove();
    for (let k = from + 1; k < st.target; k++) {
      const c = at(k);
      over!.append(svg('circle', { cx: c.x, cy: c.y, r: picked ? 11 : 8, class: 'as-step' }));
    }
    const t = at(st.target);
    over!.append(svg('circle', { cx: t.x, cy: t.y, r: PIECE_R + 6, class: `as-target${mine ? ' as-go' : ''}` }));
  }

  /** Касание поля: свой корабль — взять, подсвеченная точка — поставить. */
  function onBoardClick(e: MouseEvent) {
    if (!canMove() || !cam || !v) return;
    if (cardEl && !cardEl.hidden && cardEl.contains(e.target as Node)) return;
    // попадание — по экранному прямоугольнику подсвеченной точки и своего корабля, с запасом под палец
    const near = (el: Element | null) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const pad = Math.max(0, (44 - Math.min(r.width, r.height)) / 2);
      return e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
    };
    const t = over?.querySelector('.as-target') ?? null;
    const me = over?.querySelector('.as-mine') ?? null;
    if (near(t)) {
      picked = false;
      Sound.place?.();
      ctx?.act(v.turn, { type: 'move' });
      return;
    }
    if (near(me)) {
      picked = !picked;
      Sound.step();
      render();
    }
  }

  const others = (): CamPoint[] => (v ? v.seats.map((s) => at(shown[s] ?? v!.pos[s])) : []);

  function frame() {
    if (cam && v) void cam.frame(turnPoints(), others());
  }

  // ------------------------------------------------------------------ панель

  function renderLast() {
    if (!lastBox) return;
    lastBox.replaceChildren();
    if (last == null || (card && card.mode !== 'peek')) return;
    const c = cardOf(last);
    const b = document.createElement('button');
    b.className = 'btn as-last';
    b.innerHTML = `<img src="${cardImg(last, 'a')}" alt=""><span>Карточка ${last ? `${last}. ` : ''}${c.name}</span>`;
    b.onclick = () => (card?.mode === 'peek' ? hideCard() : showCard(last!, 'peek'));
    lastBox.append(b);
  }

  function render() {
    if (!v || !over || !btns || !quizBox) return;
    const st = v;
    over.replaceChildren();
    marks();
    pieces();
    btns.replaceChildren();
    quizBox.replaceChildren();
    quizBox.hidden = true;
    // вопрос второго варианта: карточка рисунком вверх, варианты ответа — в панели
    if (!busy && st.phase === 'quiz' && st.quiz) {
      const q = st.quiz;
      if (!card || card.mode !== 'quiz' || card.n !== q.n) showCard(q.n, 'quiz');
      quizBox.hidden = false;
      const c = cardOf(q.n);
      const head = document.createElement('div');
      head.className = 'as-q';
      head.innerHTML =
        q.step === 'name'
          ? `Точка ${q.n}: ${c.planet ? 'какая это планета' : 'какое это созвездие'}?`
          : `Созвездие ${c.name}: по каким звёздам находят Полярную?`;
      quizBox.append(head);
      const mine = actSeat === q.seat;
      if (!mine) {
        const w = document.createElement('div');
        w.className = 'as-q-wait';
        w.innerHTML = `${ctx?.name(q.seat) ?? nameOf(q.seat)} вспоминает…`;
        quizBox.append(w);
      }
      for (const o of q.options) {
        const b = document.createElement('button');
        b.className = 'btn as-opt';
        b.textContent = o;
        b.disabled = !mine;
        b.onclick = () => ctx?.act(q.seat, { type: 'answer', pick: o });
        quizBox.append(b);
      }
    } else if (card?.mode === 'quiz' && !busy) hideCard();
    if (actSeat != null && !busy && st.phase === 'roll') {
      const b = document.createElement('button');
      b.className = 'btn primary';
      b.dataset.tap = '';
      b.textContent = 'Бросить кубик';
      const seat = actSeat;
      b.onclick = () => ctx?.act(seat, { type: 'roll' });
      btns.append(b);
    }
    if (canMove()) {
      const tip = document.createElement('div');
      tip.className = 'as-q-wait';
      tip.textContent = `Переставьте корабль на точку ${v.target! >= HOME ? '«Земля»' : v.target}: нажмите на свой корабль и на подсвеченную точку.`;
      btns.append(tip);
    }
    renderLast();
  }

  // ------------------------------------------------------------------ события

  async function walk(seat: number, path: number[]) {
    const sp = speed();
    void cam?.frame([at(shown[seat] ?? 0), at(path[path.length - 1])], others());
    for (const p of path) {
      shown[seat] = p;
      render();
      Sound.step();
      await sleep(150 / sp);
    }
  }

  return {
    mount(root, c) {
      ctx = c;
      wrap = document.createElement('div');
      wrap.className = 'as-wrap';
      wrap.innerHTML = `<div class="as-board"><img class="as-map as-map-mini" src="/astro/field-small.webp" alt="" draggable="false"><img class="as-map as-map-full" src="/astro/field.webp" alt="Карта звёздного неба" draggable="false"></div>`;
      root.append(wrap);
      board = wrap.querySelector('.as-board') as HTMLElement;
      over = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      over.setAttribute('class', 'as-over');
      over.setAttribute('viewBox', `0 0 ${W} ${H}`);
      board.append(over);
      cam = new BoardCam(wrap, board, {
        w: W,
        h: H,
        mini: '/astro/field.webp',
        src: 4135,
        token: (PIECE_R * 2) / W,
        followKey: 'astro.follow',
        demo: c.demo,
        speed: () => ctx!.speed(),
        dots: () => (v ? v.seats.map((s) => ({ key: s, ...at(shown[s] ?? v!.pos[s]), color: SEATS[s]?.color ?? '#888', on: s === v!.turn })) : []),
        turn: turnPoints,
      });
      const img = wrap.querySelector('.as-map-full') as HTMLImageElement;
      c.hold?.(9000);
      const ready = () => {
        board!.classList.add('ready');
        ctx?.hold?.(0);
        cam!.shown();
      };
      if (img.complete && img.naturalWidth) ready();
      else img.onload = ready;

      panel = document.createElement('div');
      panel.className = 'as-panel';
      panel.innerHTML = `<div class="as-tray"></div><div class="as-btns"></div><div class="as-quiz" hidden></div><div class="as-lastbox"></div>
        <div class="hint small-hint">Кубик бросают пробелом или тапом по карте. Очки с карточек и маршрута прибавляются или снимаются
        в следующем ходе; на взлёте с Земли — минус 2.</div>`;
      c.controls.append(panel);
      tray = new DiceTray(panel.querySelector('.as-tray') as HTMLElement, 1);
      btns = panel.querySelector('.as-btns') as HTMLElement;
      quizBox = panel.querySelector('.as-quiz') as HTMLElement;
      lastBox = panel.querySelector('.as-lastbox') as HTMLElement;

      note = document.createElement('div');
      note.className = 'as-note bc-ui';
      note.hidden = true;
      cardEl = document.createElement('div');
      cardEl.className = 'as-card bc-ui';
      cardEl.hidden = true;
      cardEl.innerHTML = `<div class="as-flip"><img class="as-face as-front" alt="" draggable="false"><img class="as-face as-back" alt="" draggable="false"></div>
        <div class="as-card-cap"></div><button class="as-card-x" aria-label="Закрыть">✕</button>`;
      wrap.append(note, cardEl);
      wrap.addEventListener('click', onBoardClick);
      resize = new ResizeObserver(() => fitCard());
      resize.observe(wrap);
      document.addEventListener('pointerdown', onCardPointer, true);
      document.addEventListener('click', onCardPointer, true);
    },
    setView(view) {
      v = view;
      shown = view.pos.slice();
      if (view.die) tray?.show([view.die]);
      render();
    },
    async play(events, view) {
      const sp = speed();
      busy = true;
      picked = false;
      if (card && card.mode !== 'quiz') hideCard();
      // вопрос и кнопки прошлого состояния убрать: пока идут события, отвечать и бросать нечего
      render();
      for (const ev of events) {
        const text = describe(ev, (s) => ctx?.name(s) ?? nameOf(s));
        if (text && note) {
          note.innerHTML = text;
          note.hidden = false;
        }
        if (ev.type === 'roll') {
          // первый бросок партии: карточка «Планета Земля» — старт, минус 2 очка с первого хода
          if (ev.first) {
            showCard(0, 'event');
            setTimeout(() => card?.n === 0 && flip(true), 700 / sp);
            await wait(2600);
            hideCard();
            if (note && text) note.innerHTML = text;
          }
          await tray?.roll([ev.die], sp);
          await sleep(350 / sp);
        } else if (ev.type === 'move') {
          await walk(ev.seat, ev.path);
        } else if (ev.type === 'stay') {
          Sound.nomove();
          await sleep(900 / sp);
        } else if (ev.type === 'card') {
          Sound.place?.();
          showCard(ev.n, 'event');
          // карточку берут рисунком вверх и переворачивают — там написано, что дальше
          setTimeout(() => card?.n === ev.n && card.mode === 'event' && flip(true), 800 / sp);
          await wait(3200);
          hideCard();
        } else if (ev.type === 'stop') {
          if (ev.pts > 0) Sound.jump();
          else Sound.nomove();
          await wait(2000);
        } else if (ev.type === 'quiz') {
          await sleep(500 / sp);
        } else if (ev.type === 'answer') {
          if (ev.ok) Sound.jump();
          else Sound.nomove();
          if (ev.done) {
            // ответ открывается переворотом карточки
            showCard(ev.n, 'event');
            setTimeout(() => card?.n === ev.n && card.mode === 'event' && flip(true), 500 / sp);
            await wait(3000);
            hideCard();
          } else await wait(1400);
        } else if (ev.type === 'skip') {
          Sound.nomove();
          await sleep(800 / sp);
        } else if (ev.type === 'win') {
          Sound.win();
          await wait(2500);
        }
      }
      v = view;
      shown = view.pos.slice();
      busy = false;
      if (note) note.hidden = true;
      render();
      frame();
    },
    setTurn(_toAct, interactive) {
      actSeat = v && v.winner == null && interactive.includes(v.turn) ? v.turn : null;
      if (actSeat != null) cam?.release();
      render();
      frame();
    },
    status(view, act) {
      if (view.winner != null) return `${nameOf(view.winner)} вернулся на Землю — победа!`;
      const me = act.includes(view.turn);
      if (view.phase === 'quiz') return me ? 'Назовите, что на карточке.' : 'Отвечает на вопрос…';
      if (view.phase === 'move') return me ? `Выпало ${view.die}. Переставьте свой корабль на подсвеченную точку.` : 'Переставляет корабль…';
      const b = view.bonus[view.turn];
      const add = b ? ` (${ptsText(b)} к броску)` : '';
      return me ? `Бросайте кубик${add}.` : `Бросает кубик${add}…`;
    },
    playerStats(view, seat) {
      const p = view.pos[seat];
      const where = p === 0 ? 'на Земле' : p >= HOME ? 'дома' : `точка ${p}`;
      const b = view.bonus[seat] ? ` · ${ptsText(view.bonus[seat])}` : '';
      const s = view.skip[seat] ? ' · пропуск' : '';
      return `${where}${b}${s}`;
    },
    destroy() {
      document.removeEventListener('pointerdown', onCardPointer, true);
      document.removeEventListener('click', onCardPointer, true);
      resize?.disconnect();
      resize = null;
      cam?.destroy();
      wrap?.remove();
      panel?.remove();
      wrap = board = over = panel = note = cardEl = btns = quizBox = lastBox = null;
      cam = null;
      tray = null;
      v = null;
      card = null;
      shown = [];
    },
  };
}

/* Вид «Звезды Африки»: карта под камерой (приближение колесом и щипком, перетаскивание, миникарта,
 * кнопки «Вся карта» / «Где ход» / «Следить») плюс панель хода (кубик, подковы, перелёты, выбор города).
 * Слои поверх карты: жетоны и подсветки (перерисовываются), след хода, фишки (живут постоянно и едут
 * с клетки на клетку — так видно каждый шаг). */
import { Sound } from '../../core/audio';
import { BoardCam, type CamPoint } from '../../core/boardcam';
import { DiceTray } from '../../core/dice';
import { sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from '../hodilki/core';
import {
  AIR, AIR_FEE, CELLS, FINISH, H, HORSE_MONEY, IDX, NEIGH, OPEN_FEE, TOK_FILE, TOK_NAME, TOKEN_AT, W,
  canStep, describe, openable, placeName, robberOpen,
  type Action, type Event, type State,
} from './engine';
import './star.css';

const money = (n: number) => `${n.toLocaleString('ru-RU')} $`;
const nameOf = (seat: number) => SEATS[seat]?.name ?? String(seat);
/** Пуговица места — картинка из public/hodilki/buttons, как во всех ходилках сборника.
 *  Точки маршрута на карте ~40 px, квадраты жетонов ~156 px; пуговица — 92 px, чтобы её было видно издалека. */
const PIECE_R = 46;
const PIECE_GAP = 62;
/** Квадрат жетона на карте — как напечатан (около 156 px). */
const TOK_HALF = 76;
/** Сколько держать событие на экране (мс), если за экраном не человек. */
const PACE: { [k: string]: number } = {
  token: 2200, win: 2200, catch: 1800, island: 1600, skip: 1000, halt: 1400, drop: 1800, pickup: 1600,
  bandit: 1600, cape: 1400, robfee: 1100, ferry: 1200, extra: 900, horse: 900, start: 700,
};
const NS = 'http://www.w3.org/2000/svg';

export function createView(): GameView<State, Event> {
  let ctx: ViewCtx<Action> | null = null;
  let wrap: HTMLElement | null = null;
  let board: HTMLElement | null = null;
  let over: SVGSVGElement | null = null;
  /** Слои: жетоны и подсветки / след хода / фишки. */
  let gBoard: SVGGElement | null = null;
  let gTrail: SVGGElement | null = null;
  let gPieces: SVGGElement | null = null;
  let panel: HTMLElement | null = null;
  let btns: HTMLElement | null = null;
  let tray: DiceTray | null = null;
  let note: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  let strip: HTMLElement | null = null;
  let cam: BoardCam | null = null;
  let v: State | null = null;
  let actSeat: number | null = null;
  /** Где фишки нарисованы сейчас (по ходу показа событий они идут шаг за шагом). */
  let shown: number[] = [];
  /** Какие жетоны уже открыты на карте: переворачиваем ровно в тот момент, когда показываем карточку. */
  let shownOpen: boolean[] = [];
  /** След текущего хода: клетки, по которым прошла фишка. */
  let trail: { seat: number; cells: number[] } | null = null;
  /** Идёт показ событий: подсказки шагов не показываем, пока не дошли до конца. */
  let busy = false;
  const pieceEls = new Map<number, SVGGElement>();
  /** Где пуговица стоит на экране карты (с учётом разведения на одной клетке). */
  const at = new Map<number, { x: number; y: number }>();

  const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, String(val));
    return e;
  };
  const speed = () => Math.max(0.25, ctx?.speed?.() ?? 1);

  /* ---------- фишки ---------- */

  /** Куда поставить пуговицу: на одной клетке разводим в стороны, чтобы было видно всех. */
  function spots(): Map<number, { x: number; y: number }> {
    const st = v!;
    const by = new Map<number, number[]>();
    for (const seat of st.seats) {
      const c = shown[seat] ?? st.pos[seat];
      by.set(c, [...(by.get(c) ?? []), seat]);
    }
    const out = new Map<number, { x: number; y: number }>();
    for (const [cell, list] of by) {
      const c = CELLS[cell];
      list.forEach((seat, i) => {
        const off = list.length > 1 ? (i - (list.length - 1) / 2) * PIECE_GAP : 0;
        out.set(seat, { x: c.x + off, y: c.y - (list.length > 2 && i % 2 ? 26 : 0) });
      });
    }
    return out;
  }

  function pieceEl(seat: number): SVGGElement {
    let g = pieceEls.get(seat);
    if (g) return g;
    g = svg('g', { class: 'st-piece' });
    g.append(
      svg('ellipse', { cx: 0, cy: PIECE_R * 0.55, rx: PIECE_R * 0.95, ry: PIECE_R * 0.42, class: 'st-shadow' }),
      svg('image', { x: -PIECE_R, y: -PIECE_R, width: PIECE_R * 2, height: PIECE_R * 2, href: `/hodilki/buttons/${seat}.webp` })
    );
    const mark = svg('text', { x: PIECE_R * 0.55, y: -PIECE_R * 0.55, class: 'st-mark' });
    g.append(mark);
    takeable(g, seat);
    gPieces!.append(g);
    pieceEls.set(seat, g);
    return g;
  }

  const put = (seat: number, p: { x: number; y: number }, lift = 0) => {
    pieceEl(seat).setAttribute('transform', `translate(${p.x} ${p.y - lift})${lift ? ` scale(${1 + lift / 160})` : ''}`);
    at.set(seat, p);
  };

  /** Расставить фишки без анимации (кроме едущей). */
  function placePieces(skip?: number) {
    if (!v || !gPieces) return;
    const sp = spots();
    for (const seat of v.seats) {
      const g = pieceEl(seat);
      g.classList.toggle('st-turn', seat === v.turn && v.winner == null);
      g.classList.toggle('st-can', canMove(seat));
      const mark = g.querySelector('.st-mark') as SVGTextElement;
      mark.textContent = v.diamond === seat ? '💎' : v.bandit[seat] ? '⚔️' : '';
      if (seat !== skip) put(seat, sp.get(seat)!);
    }
    // ходящая фишка — сверху
    const cur = pieceEls.get(v.turn);
    if (cur) gPieces.append(cur);
  }

  /** Фишка едет с клетки на клетку: шаг — короткий скачок, перелёт — дугой над картой. */
  function glide(seat: number, to: number, ms: number, arc: number): Promise<void> {
    const from = at.get(seat) ?? { x: CELLS[to].x, y: CELLS[to].y };
    shown[seat] = to;
    const dest = spots().get(seat)!;
    const g = pieceEl(seat);
    gPieces!.append(g);
    return new Promise((done) => {
      const t0 = performance.now();
      let over = false;
      const finish = () => {
        if (over) return;
        over = true;
        if (g.isConnected) {
          put(seat, dest);
          placePieces();
        }
        done();
      };
      const tick = (now: number) => {
        if (over) return;
        const k = Math.min(1, (now - t0) / ms);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        put(seat, { x: from.x + (dest.x - from.x) * e, y: from.y + (dest.y - from.y) * e }, Math.sin(Math.PI * k) * arc);
        if (k < 1 && g.isConnected) requestAnimationFrame(tick);
        else finish();
      };
      requestAnimationFrame(tick);
      // во фоновой вкладке кадры не идут — показ не должен застревать
      setTimeout(finish, ms + 80);
    });
  }

  const canMove = (seat: number) => {
    const st = v;
    return !!st && !busy && seat === actSeat && st.winner == null && st.phase === 'step' && st.left > 0;
  };

  /** Свою фишку можно взять и переставить на подсвеченную клетку — как в «Кинь-двине». */
  function takeable(el: SVGGElement, seat: number) {
    el.addEventListener('pointerdown', (e) => {
      if (!canMove(seat)) return;
      e.preventDefault();
      e.stopPropagation();
      const from = { x: e.clientX, y: e.clientY };
      try { el.setPointerCapture(e.pointerId); } catch { /* не все браузеры умеют */ }
      const move = (ev: PointerEvent) => {
        const p = cam!.toImg(ev.clientX, ev.clientY);
        put(seat, p, 10);
      };
      const up = (ev: PointerEvent) => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 6 || ev.type === 'pointercancel') {
          placePieces();
          return;
        }
        const p = cam!.toImg(ev.clientX, ev.clientY);
        let best = -1;
        let bd = Infinity;
        for (const to of targets()) {
          const d = Math.hypot(CELLS[to].x - p.x, CELLS[to].y - p.y);
          if (d < bd) {
            bd = d;
            best = to;
          }
        }
        if (best < 0 || bd > 110) {
          placePieces();
          return;
        }
        ctx?.act(seat, { type: 'step', to: best });
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }

  /** Куда можно шагнуть прямо сейчас. */
  function targets(): number[] {
    const st = v;
    if (!st || actSeat == null || st.phase !== 'step' || st.left <= 0) return [];
    const from = st.pos[actSeat];
    return NEIGH[from].filter((_, k) => canStep(st, actSeat!, from, k));
  }

  /* ---------- карта ---------- */

  /** Что показать камере: куда фишка может шагнуть (её ход) или где она стоит. */
  function turnPoints(): CamPoint[] {
    const st = v;
    if (!st || st.winner != null) return [];
    if (st.phase === 'start') return FINISH.map((i) => CELLS[i]);
    const seat = st.turn;
    const from = shown[seat] ?? st.pos[seat];
    const pts: CamPoint[] = [CELLS[from]];
    if (st.phase === 'step' && st.left > 0) for (const to of NEIGH[from]) pts.push(CELLS[to]);
    return pts;
  }

  const others = (): CamPoint[] => (v ? v.seats.map((s) => CELLS[shown[s] ?? v!.pos[s]]) : []);

  function drawTrail() {
    if (!gTrail) return;
    gTrail.replaceChildren();
    if (!trail || trail.cells.length < 2) return;
    const pts = trail.cells.map((c) => `${CELLS[c].x},${CELLS[c].y}`).join(' ');
    const color = SEATS[trail.seat]?.color ?? '#fff';
    gTrail.append(
      svg('polyline', { points: pts, class: 'st-trail-under' }),
      svg('polyline', { points: pts, class: 'st-trail', stroke: color })
    );
  }

  function drawStrip(st: State) {
    if (!strip) return;
    strip.replaceChildren();
    for (let k = 0; k < CELLS.length; k++) {
      const kk = st.tokens[k];
      if (!kk || !(shownOpen[k] ?? st.open[k]) || kk === 'empty') continue;
      const im = document.createElement('img');
      im.src = `/star/${TOK_FILE[kk]}.webp`;
      im.alt = im.title = `${TOK_NAME[kk]} — ${placeName(k) ?? ''}`;
      im.draggable = false;
      strip.append(im);
    }
    strip.classList.toggle('st-open-empty', strip.childElementCount === 0);
  }

  function render() {
    if (!v || !gBoard || !btns) return;
    const st = v;
    gBoard.replaceChildren();
    // жетоны: закрытые — рубашкой вверх на напечатанном квадрате, открытые — картинкой
    for (let i = 0; i < CELLS.length; i++) {
      if (!TOKEN_AT[i]) continue;
      const c = CELLS[i];
      const open = shownOpen[i] ?? st.open[i];
      if (open && st.tokens[i]) {
        gBoard.append(svg('rect', { x: c.x - TOK_HALF, y: c.y - TOK_HALF, width: TOK_HALF * 2, height: TOK_HALF * 2, rx: 14, class: 'st-open-bg' }));
        gBoard.append(svg('image', { x: c.x - TOK_HALF + 6, y: c.y - TOK_HALF + 6, width: TOK_HALF * 2 - 12, height: TOK_HALF * 2 - 12, href: `/star/${TOK_FILE[st.tokens[i]!]}.webp` }));
      } else if (!open) {
        gBoard.append(svg('rect', { x: c.x - TOK_HALF, y: c.y - TOK_HALF, width: TOK_HALF * 2, height: TOK_HALF * 2, rx: 14, class: 'st-closed' }));
        const star = svg('text', { x: c.x, y: c.y + 26, class: 'st-closed-star' });
        star.textContent = '★';
        gBoard.append(star);
      }
    }
    // алмаз, брошенный на Кейптаун, лежит открыто — его видно всем
    if (st.diamondSite >= 0) {
      const c = CELLS[st.diamondSite];
      gBoard.append(svg('image', { x: c.x - 60, y: c.y - 60, width: 120, height: 120, href: '/star/token-diamond.webp', class: 'st-site' }));
    }
    drawStrip(st);
    // начало партии: два города на выбор — Танжер или Каир
    if (st.phase === 'start' && actSeat != null) {
      for (const i of FINISH) {
        const c = CELLS[i];
        const g = svg('circle', { cx: c.x, cy: c.y, r: 64, class: 'st-start-city' });
        g.addEventListener('click', () => ctx?.act(actSeat!, { type: 'start', at: i }));
        gBoard.append(g);
      }
    }
    if (!busy && actSeat != null) {
      const seat = actSeat;
      // куда можно шагнуть (свой ход)
      for (const to of targets()) {
        const g = svg('circle', { cx: CELLS[to].x, cy: CELLS[to].y, r: TOKEN_AT[to] ? 88 : 58, class: 'st-move' });
        g.addEventListener('click', () => ctx?.act(seat, { type: 'step', to }));
        gBoard.append(g);
      }
      // перелёт — вместо броска кубика
      if (st.phase === 'roll' && st.money[seat] >= AIR_FEE) {
        const from = st.pos[seat];
        for (const to of AIR[from]) {
          if (st.diamond === seat && robberOpen(st, to)) continue;
          gBoard.append(svg('line', { x1: CELLS[from].x, y1: CELLS[from].y, x2: CELLS[to].x, y2: CELLS[to].y, class: 'st-fly-line' }));
          const g = svg('circle', { cx: CELLS[to].x, cy: CELLS[to].y, r: 66, class: 'st-fly' });
          g.addEventListener('click', () => ctx?.act(seat, { type: 'air', to }));
          gBoard.append(g);
        }
      }
      // очки истрачены: пройденные закрытые жетоны можно открыть за 100
      if (st.phase === 'open' && st.money[seat] >= OPEN_FEE) {
        for (const cell of openable(st)) {
          const c = CELLS[cell];
          const g = svg('rect', { x: c.x - TOK_HALF - 8, y: c.y - TOK_HALF - 8, width: TOK_HALF * 2 + 16, height: TOK_HALF * 2 + 16, rx: 18, class: 'st-pass' });
          g.addEventListener('click', () => ctx?.act(seat, { type: 'open', cell }));
          gBoard.append(g);
        }
      }
    }
    drawTrail();
    placePieces();
    buttons();
  }

  function buttons() {
    const st = v!;
    if (panel) panel.classList.toggle('st-hidden', actSeat == null || busy);
    btns!.replaceChildren();
    if (actSeat == null || busy) return;
    const seat = actSeat;
    const add = (text: string, cls: string, action: Action) => {
      const b = document.createElement('button');
      b.className = `btn ${cls}`.trim();
      b.innerHTML = text;
      // тап по свободному месту доски и пробел нажимают главную кнопку хода — но только бросок:
      // в шаге по карте игрок выбирает, куда идти
      if (action.type === 'roll') b.dataset.tap = '';
      b.onclick = () => {
        Sound.ui();
        ctx?.act(seat, action);
      };
      btns!.append(b);
    };
    const horses = () => {
      if (st.horses[seat] <= 0) return;
      add(`🧲 Подкова → ${HORSE_MONEY} $`, '', { type: 'horse', use: 'money' });
      add('🧲 Подкова → лишний ход', '', { type: 'horse', use: 'move' });
    };
    if (st.phase === 'start') {
      add('Начать из Танжера', 'primary', { type: 'start', at: IDX['Tg'] });
      add('Начать из Каира', 'primary', { type: 'start', at: IDX['K'] });
    } else if (st.phase === 'roll') {
      add('Бросить кубик', 'primary', { type: 'roll' });
      if (st.money[seat] >= AIR_FEE) {
        for (const to of AIR[st.pos[seat]]) {
          if (st.diamond === seat && robberOpen(st, to)) continue;
          add(`✈ ${placeName(to) ?? to} — ${AIR_FEE} $`, '', { type: 'air', to });
        }
      }
      horses();
    } else if (st.phase === 'step') {
      add(st.left < st.die ? `Остановиться здесь (осталось ${st.left})` : 'Не идти (закончить ход)', '', { type: 'stop' });
      horses();
    } else if (st.phase === 'open') {
      if (st.money[seat] >= OPEN_FEE) {
        for (const cell of openable(st)) add(`Открыть жетон: ${placeName(cell) ?? 'жетон'} — ${OPEN_FEE} $`, '', { type: 'open', cell });
      }
      add('Закончить ход', 'primary', { type: 'stop' });
      horses();
    }
  }

  /** Показать ход: своя фишка и возможные шаги (или оба города в начале партии). */
  function frame(pts?: CamPoint[]) {
    if (!cam || !v) return Promise.resolve();
    return cam.frame(pts ?? turnPoints(), others());
  }

  function say(text: string) {
    note!.innerHTML = text;
    note!.hidden = false;
  }

  /** Подождать: за экраном человек — до касания (для важного), иначе пауза. */
  const wait = (type: string, important: boolean) => {
    const ms = PACE[type] ?? 900;
    return important && ctx?.read ? ctx.read(ms) : sleep(ms / speed());
  };

  return {
    mount(root, c) {
      ctx = c;
      wrap = document.createElement('div');
      wrap.className = 'st-wrap';
      wrap.innerHTML = `<div class="st-board">
          <img class="st-map st-map-mini" src="/star/field-small.webp" alt="" draggable="false"><img class="st-map st-map-full" src="/star/field.webp" alt="Карта Африки" draggable="false">
        </div>`;
      root.append(wrap);
      board = wrap.querySelector('.st-board') as HTMLElement;
      over = document.createElementNS(NS, 'svg');
      over.setAttribute('class', 'st-over');
      over.setAttribute('viewBox', `0 0 ${W} ${H}`);
      gBoard = svg('g', {});
      gTrail = svg('g', { class: 'st-trail-g' });
      gPieces = svg('g', {});
      over.append(gBoard, gTrail, gPieces);
      board.append(over);
      cam = new BoardCam(wrap, board, {
        w: W,
        h: H,
        mini: '/star/field.webp',
        src: W,
        token: (PIECE_R * 2) / W,
        followKey: 'star.follow',
        // в показе правил камера тоже ведёт за фишкой: на всей карте ход не разглядеть
        demo: false,
        speed: () => ctx!.speed(),
        dots: () =>
          v ? v.seats.map((s) => ({ key: s, x: CELLS[shown[s] ?? v!.pos[s]].x, y: CELLS[shown[s] ?? v!.pos[s]].y, img: `/hodilki/buttons/${s}.webp`, on: s === v!.turn })) : [],
        turn: turnPoints,
      });
      const img = wrap.querySelector('.st-map-full') as HTMLImageElement;
      c.hold?.(8000);
      const ready = () => {
        board!.classList.add('ready');
        ctx?.hold?.(0);
        cam!.shown();
      };
      if (img.complete && img.naturalWidth) ready();
      else img.onload = ready;
      panel = document.createElement('div');
      panel.className = 'st-panel';
      panel.innerHTML = `<div class="st-tray dice-tray"></div><div class="st-btns"></div>
        <div class="hint small-hint">Жёлтые кружки — куда можно шагнуть (или перетащите фишку), голубые — перелёт
        по авиалинии, рамка — пройденный жетон, его можно открыть за ${OPEN_FEE} $.</div>`;
      c.controls.append(panel);
      btns = panel.querySelector('.st-btns') as HTMLElement;
      tray = new DiceTray(panel.querySelector('.st-tray') as HTMLElement, 1);
      // событие — плашкой сверху, открытый жетон — карточкой; и то и другое в координатах окна
      note = document.createElement('div');
      note.className = 'st-note bc-ui';
      note.hidden = true;
      card = document.createElement('div');
      card.className = 'st-card bc-ui';
      card.hidden = true;
      card.innerHTML = `<img alt="" draggable="false"><div class="st-card-t"></div><div class="st-card-s"></div>`;
      strip = document.createElement('div');
      strip.className = 'st-open bc-ui';
      wrap.append(note, card, strip);
    },
    setView(view) {
      v = view;
      shown = view.pos.slice();
      shownOpen = view.open.slice();
      if (view.phase !== 'step' && view.phase !== 'open') trail = null;
      render();
    },
    /** Проиграть события: кубик катится, фишка идёт по точкам, жетон переворачивается карточкой. */
    async play(events, view) {
      const prev = v;
      v = { ...view, tokens: view.tokens.slice() };
      // до показа — ещё старое положение фишек и жетонов
      if (prev) {
        shown = prev.pos.slice();
        shownOpen = prev.open.slice();
      }
      busy = true;
      card!.hidden = true;
      note!.hidden = true;
      render();
      for (const ev of events) {
        const text = describe(ev, (s) => nameOf(s));
        if (ev.type === 'roll') {
          trail = { seat: ev.seat, cells: [shown[ev.seat]] };
          drawTrail();
          void frame([CELLS[shown[ev.seat]], ...NEIGH[shown[ev.seat]].map((n) => CELLS[n])]);
          if (tray) await tray.roll([ev.die], speed());
          continue;
        }
        if (ev.type === 'step') {
          if (!trail || trail.seat !== ev.seat) trail = { seat: ev.seat, cells: [ev.from] };
          trail.cells.push(ev.to);
          void frame([CELLS[ev.to], ...NEIGH[ev.to].map((n) => CELLS[n])]);
          Sound.step();
          await glide(ev.seat, ev.to, 300 / speed(), 34);
          drawTrail();
          if (ev.last) Sound.place();
          if (ev.fee) {
            say(text ?? '');
            await sleep(700 / speed());
          }
          continue;
        }
        if (ev.type === 'air') {
          trail = null;
          drawTrail();
          say(text ?? '');
          await Promise.race([frame([CELLS[ev.from], CELLS[ev.to]]), sleep(700)]);
          Sound.jump();
          const d = Math.hypot(CELLS[ev.to].x - CELLS[ev.from].x, CELLS[ev.to].y - CELLS[ev.from].y);
          await glide(ev.seat, ev.to, (900 + d * 0.3) / speed(), 120 + d * 0.08);
          Sound.place();
          continue;
        }
        if (ev.type === 'start') {
          shown[ev.seat] = ev.at;
          placePieces();
          Sound.place();
          say(text ?? '');
          await wait('start', false);
          continue;
        }
        if (ev.type === 'token') {
          // открытие жетона: переворачиваем его на карте и показываем карточку
          shownOpen[ev.cell] = true;
          v.tokens[ev.cell] = ev.tok;
          render();
          if (ev.tok === 'robber') Sound.capture();
          else if (ev.tok === 'diamond') Sound.home();
          else Sound.card();
          const img = card!.querySelector('img') as HTMLImageElement;
          img.src = `/star/${TOK_FILE[ev.tok]}.webp`;
          (card!.querySelector('.st-card-t') as HTMLElement).textContent = `${TOK_NAME[ev.tok]}${placeName(ev.cell) ? ` · ${placeName(ev.cell)}` : ''}`;
          (card!.querySelector('.st-card-s') as HTMLElement).innerHTML = text ?? '';
          card!.hidden = false;
          note!.hidden = true;
          await wait('token', true);
          card!.hidden = true;
          continue;
        }
        if (ev.type === 'money' || ev.type === 'stop' || !text) continue;
        say(text);
        if (ev.type === 'win') Sound.win();
        else if (ev.type === 'catch' || ev.type === 'bandit') Sound.capture();
        else if (ev.type === 'pickup' || ev.type === 'cape') Sound.home();
        else if (ev.type === 'drop' || ev.type === 'skip' || ev.type === 'halt' || ev.type === 'island' || ev.type === 'robfee') Sound.nomove();
        else Sound.ui();
        render();
        const important = ev.type === 'win' || ev.type === 'catch' || ev.type === 'drop' || ev.type === 'bandit' || ev.type === 'island';
        await wait(ev.type, important);
      }
      v = view;
      shown = view.pos.slice();
      shownOpen = view.open.slice();
      busy = false;
      note!.hidden = true;
      if (view.phase !== 'step' && view.phase !== 'open') trail = null;
      render();
      void frame();
    },
    setTurn(_toAct, interactive) {
      actSeat = v && v.winner == null && interactive.includes(v.turn) ? v.turn : null;
      if (actSeat != null) cam?.release(); // мой ход — камера снова ведёт
      render();
      void frame();
    },
    status(view, toAct, interactive) {
      if (view.winner != null) return `${nameOf(view.winner)}: «Звезда Африки» доставлена — победа!`;
      const seat = toAct[0];
      const me = interactive.includes(seat);
      if (view.phase === 'start') {
        return me ? 'Откуда начинать? Выберите город — Танжер или Каир.' : `${nameOf(seat)} выбирает, откуда начинать — Танжер или Каир.`;
      }
      if (view.phase === 'open') {
        return me ? `Очки истрачены. Пройденный жетон можно открыть за ${OPEN_FEE} $ — или закончить ход.` : `${nameOf(seat)} решает, открывать ли пройденный жетон.`;
      }
      if (view.phase === 'step') {
        const hunt = view.bandit[seat] && view.diamond >= 0
          ? ' Вы разбойник-соперник: догоните владельца алмаза.'
          : view.diamond === seat
            ? ' Несите алмаз в Танжер или Каир; через открытых разбойников нельзя.'
            : '';
        return me ? `Осталось шагов: ${view.left}. Выберите, куда идти.${hunt}` : `${nameOf(seat)} идёт по карте (осталось ${view.left}).`;
      }
      if (view.diamondSite >= 0) return `Алмаз лежит открыто на Кейптауне — кто дойдёт, тот и понесёт. ${me ? 'Бросайте кубик.' : ''}`;
      return me ? 'Бросайте кубик или летите самолётом.' : `Ходит ${nameOf(seat)}…`;
    },
    playerStats(view, seat) {
      const d = view.diamond === seat ? ' · 💎' : '';
      const b = view.bandit[seat] ? ' · ⚔️' : '';
      const h = view.horses[seat] ? ` · 🧲${view.horses[seat]}` : '';
      const w = view.skip[seat] ? ` · ⏳${view.skip[seat]}` : '';
      const city = view.phase === 'start' && !view.started[seat] ? 'выбирает город' : placeName(view.pos[seat]) ?? 'в пути';
      return `${money(view.money[seat])}${h}${d}${b}${w} · ${city}`;
    },
    destroy() {
      cam?.destroy();
      wrap?.remove();
      panel?.remove();
      wrap = board = over = panel = note = card = strip = null;
      gBoard = gTrail = gPieces = null;
      pieceEls.clear();
      at.clear();
      cam = null;
      v = null;
      shown = [];
      shownOpen = [];
      trail = null;
    },
  };
}

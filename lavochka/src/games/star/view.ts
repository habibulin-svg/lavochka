/* Вид «Звезды Африки»: карта под камерой (приближение колесом и щипком, перетаскивание, миникарта,
 * кнопки «Вся карта» / «Где ход» / «Следить») плюс панель хода (кубик, подковы, перелёты, выбор города). */
import { BoardCam, type CamPoint } from '../../core/boardcam';
import { DiceTray } from '../../core/dice';
import { sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from '../hodilki/core';
import {
  AIR, AIR_FEE, CELLS, EDGE, FINISH, H, IDX, NEIGH, OPEN_FEE, TOK_FILE, TOK_NAME, TOKEN_AT, W,
  describe,
  type Action, type Event, type State,
} from './engine';
import './star.css';

const money = (n: number) => `${n.toLocaleString('ru-RU')} $`;
const nameOf = (seat: number) => SEATS[seat]?.name ?? String(seat);
/** Пуговица места — картинка из public/hodilki/buttons, как во всех играх сборника.
 *  Размер подобран так, чтобы пуговица была заметно крупнее точек маршрута, но не закрывала соседние:
 *  точки маршрута на карте ~40 px, пуговица — 68. */
const PIECE_R = 34;
const PIECE_GAP = 58;
/** Квадрат жетона на карте — как напечатан (около 160 px). */
const TOK_HALF = 78;
/** Сколько держать событие на экране (мс), если за экраном не человек. */
const PACE: { [k: string]: number } = { token: 2400, diamond: 2400, win: 2200, catch: 1800, island: 1600, skip: 1300, halt: 1500, drop: 1600 };

export function createView(): GameView<State, Event> {
  let ctx: ViewCtx<Action> | null = null;
  let wrap: HTMLElement | null = null;
  let board: HTMLElement | null = null;
  let over: SVGSVGElement | null = null;
  let panel: HTMLElement | null = null;
  let btns: HTMLElement | null = null;
  let tray: DiceTray | null = null;
  let stats: HTMLElement | null = null;
  let note: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  let cam: BoardCam | null = null;
  let v: State | null = null;
  let actSeat: number | null = null;
  /** Где фишки нарисованы сейчас (по ходу показа событий они идут шаг за шагом). */
  let shown: number[] = [];
  /** Какие жетоны уже открыты на карте: переворачиваем ровно в тот момент, когда показываем карточку. */
  let shownOpen: boolean[] = [];
  /** Идёт показ событий: подсказки шагов не показываем, пока не дошли до конца. */
  let busy = false;

  const svg = (tag: string, attrs: Record<string, string | number>) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, String(val));
    return e;
  };
  const label = (x: number, y: number, cls: string, text: string) => {
    const t = svg('text', { x, y, class: cls });
    t.textContent = text;
    return t;
  };

  /** Свою фишку можно взять и переставить на подсвеченную клетку — как в «Кинь-двине». */
  function takeable(el: SVGElement, seat: number) {
    const st = v!;
    const canMove = seat === actSeat && st.winner == null && (st.phase === 'start' || (st.phase === 'step' && st.left > 0));
    if (!canMove) return;
    el.setAttribute('class', el.getAttribute('class') + ' st-take');
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const from = { x: e.clientX, y: e.clientY };
      const up = (ev: PointerEvent) => {
        document.removeEventListener('pointerup', up);
        if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 6) return;
        const p = cam!.toImg(ev.clientX, ev.clientY);
        let best: Element | null = null;
        let bd = Infinity;
        for (const g of Array.from(over!.querySelectorAll('[data-move]'))) {
          const cc = CELLS[Number(g.getAttribute('data-to'))];
          const d = Math.hypot(cc.x - p.x, cc.y - p.y);
          if (d < bd) {
            bd = d;
            best = g;
          }
        }
        if (!best || bd > 90) return;
        const to = Number(best.getAttribute('data-to'));
        const kind = best.getAttribute('data-move');
        ctx?.act(seat, kind === 'air' ? { type: 'air', to } : { type: 'step', to });
      };
      // захват указателя: жест остаётся за пуговицей, браузер не перехватывает его прокруткой
      try { el.setPointerCapture(e.pointerId); } catch { /* не все браузеры умеют */ }
      el.addEventListener('pointerup', up, { once: true });
      el.addEventListener('pointercancel', () => document.removeEventListener('pointerup', up), { once: true });
      document.addEventListener('pointerup', up, { once: true });
    });
  }

  /** Фишки по клеткам: на одной клетке разводим в стороны, чтобы было видно всех. */
  function pieces() {
    const st = v!;
    const at = new Map<number, number[]>();
    for (const seat of st.seats) at.set(shown[seat] ?? st.pos[seat], [...(at.get(shown[seat] ?? st.pos[seat]) ?? []), seat]);
    for (const [cell, list] of at) {
      const c = CELLS[cell];
      list.forEach((seat, i) => {
        const off = list.length > 1 ? (i - (list.length - 1) / 2) * PIECE_GAP : 0;
        const x = c.x + off;
        const el = svg('image', {
          x: x - PIECE_R, y: c.y - PIECE_R, width: PIECE_R * 2, height: PIECE_R * 2,
          href: `/hodilki/buttons/${seat}.webp`, class: 'st-piece',
        });
        takeable(el, seat);
        over!.append(el);
        if (st.diamond === seat && i === 0) over!.append(label(x + 24, c.y - 22, 'st-gem', '💎'));
        if (st.bandit[seat] && i === 0) over!.append(label(x + 22, c.y + 30, 'st-bandit', '🗡'));
      });
    }
  }

  /** Что показать камере: куда фишка может шагнуть (её ход) или где она стоит. */
  function turnPoints(): CamPoint[] {
    const st = v;
    if (!st || st.winner != null) return [];
    if (st.phase === 'start') return FINISH.map((i) => CELLS[i]);
    const seat = actSeat ?? st.turn;
    const from = st.pos[seat];
    const pts = [CELLS[from]];
    if (st.phase === 'step' && st.left > 0) {
      for (const to of NEIGH[from]) pts.push(CELLS[to]);
      for (const to of AIR[from]) pts.push(CELLS[to]);
    }
    return pts;
  }

  const others = (): CamPoint[] => (v ? v.seats.map((s) => CELLS[v!.pos[s]]) : []);

  function render() {
    if (!v || !over || !btns || !stats) return;
    const st = v;
    over.replaceChildren();
    // граф: путевые точки, жетоны и города
    for (let i = 0; i < CELLS.length; i++) {
      const c = CELLS[i];
      const tok = TOKEN_AT[i];
      const city = c.kind === 'city';
      if (tok) {
        if ((shownOpen[i] ?? st.open[i]) && st.tokens[i]) {
          over.append(svg('image', { x: c.x - 66, y: c.y - 66, width: 132, height: 132, href: `/star/${TOK_FILE[st.tokens[i]!]}.webp` }));
        } else if (shownOpen[i] ?? st.open[i]) {
          over.append(label(c.x - 8, c.y + 16, 'st-tok-txt', '·'));
        } else {
          over.append(svg('rect', { x: c.x - TOK_HALF, y: c.y - TOK_HALF, width: TOK_HALF * 2, height: TOK_HALF * 2, rx: 16, class: 'st-closed' }));
        }
      }
      if (city) over.append(label(c.x - 46, c.y - 38, 'st-city', c.id === 'Tg' ? 'Танжер' : 'Каир'));
      // алмаз, брошенный на Кейптаун, лежит открыто — его видно всем
      if (st.diamondSite === i) over.append(label(c.x + 22, c.y - 20, 'st-gem', '💎'));
    }
    // начало партии: два города на выбор — Танжер или Каир
    if (st.phase === 'start') {
      for (const i of FINISH) {
        const c = CELLS[i];
        const g = svg('circle', { cx: c.x, cy: c.y, r: 54, class: 'st-start-city' });
        if (actSeat != null) g.addEventListener('click', () => ctx?.act(actSeat!, { type: 'start', at: i }));
        over.append(g);
      }
    }
    // куда можно шагнуть (свой ход)
    if (!busy && st.phase === 'step' && st.left > 0 && actSeat != null) {
      const from = st.pos[actSeat];
      const owner = st.diamond === actSeat;
      NEIGH[from].forEach((to, k) => {
        // владельцу алмаза нельзя проходить через открытых разбойников
        if (owner && st.open[to] && st.tokens[to] === 'robber') return;
        const sea = EDGE[from][k] === 'sea' && TOKEN_AT[from];
        const g = svg('circle', { cx: CELLS[to].x, cy: CELLS[to].y, r: sea ? 38 : 32, class: 'st-move', 'data-to': to, 'data-move': 'step' });
        g.addEventListener('click', () => ctx?.act(actSeat!, { type: 'step', to }));
        over!.append(g);
      });
      for (const to of AIR[from]) {
        const g = svg('circle', { cx: CELLS[to].x, cy: CELLS[to].y, r: 28, class: 'st-fly', 'data-to': to, 'data-move': 'air' });
        g.addEventListener('click', () => ctx?.act(actSeat!, { type: 'air', to }));
        over!.append(g);
      }
      // пройденные закрытые жетоны: их можно открыть за 100 прямо по ходу
      if (st.money[actSeat] >= OPEN_FEE) {
        for (const cell of st.passed) {
          if (!TOKEN_AT[cell] || st.open[cell]) continue;
          const c = CELLS[cell];
          const g = svg('circle', { cx: c.x, cy: c.y, r: 36, class: 'st-pass' });
          g.addEventListener('click', () => ctx?.act(actSeat!, { type: 'open', cell }));
          over!.append(g);
        }
      }
    }
    pieces();
    const cur = st;
    stats.textContent = cur.seats
      .map((s) => `${nameOf(s)}: ${money(cur.money[s])}${cur.horses[s] ? ` · 🧲${cur.horses[s]}` : ''}${cur.diamond === s ? ' · 💎' : ''}${cur.bandit[s] ? ' · 🗡 разбойник' : ''}${cur.skip[s] ? ` · ⏳${cur.skip[s]}` : ''} · ${CELLS[cur.pos[s]].t ?? 'в пути'}`)
      .join('   ');
    if (panel) panel.classList.toggle('st-hidden', actSeat == null);
    btns.replaceChildren();
    if (actSeat == null) return;
    const seat = actSeat;
    const add = (text: string, cls: string, action: Action) => {
      const b = document.createElement('button');
      b.className = `btn ${cls}`.trim();
      b.innerHTML = text;
      // тап по свободному месту доски и пробел нажимают главную кнопку хода — но только бросок:
      // в шаге «Остановиться» на карте не должно срабатывать от тапа (по карте игрок выбирает шаг)
      if (action.type === 'roll') b.dataset.tap = '';
      b.onclick = () => ctx?.act(seat, action);
      btns!.append(b);
    };
    if (st.phase === 'start') {
      add('🐘 Танжер', 'primary', { type: 'start', at: IDX['Tg'] });
      add('🐪 Каир', '', { type: 'start', at: IDX['K'] });
    } else if (st.phase === 'roll') {
      add('Бросить кубик', 'primary', { type: 'roll' });
      if (st.horses[seat] > 0) {
        add('🧲 подкова → 100 $', '', { type: 'horse', use: 'money' });
        add('🧲 подкова → лишний бросок', '', { type: 'horse', use: 'move' });
      }
      for (const to of AIR[st.pos[seat]]) {
        if (st.money[seat] < AIR_FEE) continue;
        add(`✈ ${CELLS[to].t ?? to} — ${AIR_FEE} $`, '', { type: 'air', to });
      }
    } else {
      add(`Остановиться (осталось ${st.left})`, 'primary', { type: 'stop' });
      if (st.horses[seat] > 0) add('🧲 подкова → 100 $', '', { type: 'horse', use: 'money' });
      if (st.money[seat] >= OPEN_FEE) {
        for (const cell of st.passed) {
          if (!TOKEN_AT[cell] || st.open[cell]) continue;
          add(`Открыть ${CELLS[cell].t ?? 'жетон'} — ${OPEN_FEE} $`, '', { type: 'open', cell });
        }
      }
    }
  }

  /** Показать ход: своя фишка и возможные шаги (или оба города в начале партии). */
  function frame() {
    if (!cam || !v) return;
    void cam.frame(turnPoints(), others());
  }


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
      over = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      over.setAttribute('class', 'st-over');
      over.setAttribute('viewBox', `0 0 ${W} ${H}`);
      board.append(over);
      cam = new BoardCam(wrap, board, {
        w: W,
        h: H,
        mini: '/star/field.webp',
        src: W,
        // фишка — примерно как обведённый кружок карты, чтобы камера кадрировала как надо
        token: (PIECE_R * 2) / W,
        followKey: 'star.follow',
        demo: c.demo,
        speed: () => ctx!.speed(),
        dots: () =>
          v
            ? v.seats.map((s) => ({ key: s, x: CELLS[v!.pos[s]].x, y: CELLS[v!.pos[s]].y, color: SEATS[s]?.color ?? '#888', on: s === v!.turn }))
            : [],
        turn: turnPoints,
      });
      const img = wrap.querySelector('.st-map') as HTMLImageElement;
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
      panel.innerHTML = `<div class="st-stats"></div><div class="st-tray dice-tray"></div><div class="st-btns"></div>
        <div class="hint small-hint">Карта приближается колесом, щипком и кнопками «+» / «−», двигается перетаскиванием.
        Зелёные кружки — куда можно шагнуть, красные — авиалинии, синие — пройденный жетон (открыть за 100 $).
        Очки можно не истрачивать все: «Остановиться».</div>`;
      c.controls.append(panel);
      stats = panel.querySelector('.st-stats') as HTMLElement;
      btns = panel.querySelector('.st-btns') as HTMLElement;
      tray = new DiceTray(panel.querySelector('.st-tray') as HTMLElement, 1);
      // событие — плашкой сверху, открытый жетон — карточкой; и то и другое в координатах окна
      note = document.createElement('div');
      note.className = 'st-note bc-ui';
      note.hidden = true;
      card = document.createElement('div');
      card.className = 'st-card bc-ui';
      card.hidden = true;
      card.innerHTML = `<img alt="" draggable="false"><div class="st-card-t"></div><div class="st-card-s"></div>
        <div class="st-card-h">нажмите, чтобы продолжить</div>`;
      // нажатие по карточке закрывает её (read() ждёт касания, а карточка не должна держать экран)
      card.addEventListener('pointerdown', () => {
        card!.hidden = true;
      });
      wrap.append(note, card);
    },
    setView(view) {
      v = view;
      shown = view.pos.slice();
      shownOpen = view.open.slice();
      render();
    },
    /** Событие плашкой сверху; карточка жетона — отдельно, с картинкой. */
    async play(events, view) {
      const speed = ctx?.speed?.() ?? 1;
      v = view;
      busy = true;
      card!.hidden = true;
      note!.hidden = true;
      for (const ev of events) {
        if (ev.type === 'roll') {
          if (tray) await tray.roll([ev.die], speed);
          continue;
        }
        if (ev.type === 'step' || ev.type === 'air' || ev.type === 'start') {
          shown[ev.seat] = ev.type === 'start' ? ev.at : ev.to;
        }
        const text = describe(ev, (s) => nameOf(s));
        if (!text) continue;
        note!.innerHTML = text;
        note!.hidden = false;
        render();
        if (ev.type === 'token') {
          // открытие жетона: сначала переворачиваем его на карте, потом показываем карточку и ЖДЁМ игрока
          shownOpen[ev.cell] = true;
          const img = card!.querySelector('img') as HTMLImageElement;
          img.src = `/star/${TOK_FILE[ev.tok]}.webp`;
          (card!.querySelector('.st-card-t') as HTMLElement).textContent = TOK_NAME[ev.tok] ?? '';
          (card!.querySelector('.st-card-s') as HTMLElement).innerHTML = text;
          card!.hidden = false;
          await (ctx?.read ? ctx.read(PACE.token) : sleep(PACE.token / speed));
          card!.hidden = true;
        } else {
          await (ctx?.read ? ctx.read(PACE[ev.type] ?? 900) : sleep((PACE[ev.type] ?? 900) / speed));
        }
        if (ev.type === 'step' || ev.type === 'air') await sleep(220 / speed);
      }
      busy = false;
      note!.hidden = true;
      render();
      frame();
    },
    setTurn(_toAct, interactive) {
      actSeat = v && v.winner == null && interactive.includes(v.turn) ? v.turn : null;
      if (actSeat != null) cam?.release(); // мой ход — камера снова ведёт
      render();
      frame();
    },
    status(view, toAct, interactive) {
      if (view.winner != null) return `${nameOf(view.winner)}: «Звезда Африки» доставлена — победа!`;
      const me = interactive.includes(toAct[0]);
      if (view.phase === 'start') {
        return me
          ? 'Откуда начинать? Поставьте фишку — в Танжер или в Каир.'
          : `${nameOf(toAct[0])} выбирает, откуда начинать — Танжер или Каир.`;
      }
      if (view.skip[toAct[0]] > 0) return `${nameOf(toAct[0])}: пропуск хода (осталось ${view.skip[toAct[0]]}).`;
      if (view.diamondSite >= 0) return `Алмаз лежит открыто на Кейптауне — кто дойдёт, тот и понесёт.`;
      if (view.phase === 'step') {
        const hunt = view.bandit[toAct[0]] && view.diamond >= 0
          ? ' Вы разбойник-соперник: догоняйте владельца алмаза.'
          : view.diamond === toAct[0]
            ? ' Через открытых разбойников владельцу алмаза нельзя.'
            : view.diamond >= 0
              ? ' Алмаз найден: пройдите через разбойника, чтобы стать охотником.'
              : '';
        return me
          ? `Осталось шагов: ${view.left}. Куда идти — выбираете сами.${hunt}`
          : `${nameOf(toAct[0])} идёт по карте (осталось ${view.left}).`;
      }
      return me ? 'Бросайте кубик.' : `Бросает ${nameOf(toAct[0])}…`;
    },
    playerStats(view, seat) {
      const d = view.diamond === seat ? ' · 💎' : '';
      const b = view.bandit[seat] ? ' · 🗡' : '';
      const h = view.horses[seat] ? ` · 🧲${view.horses[seat]}` : '';
      const w = view.skip[seat] ? ` · ⏳${view.skip[seat]}` : '';
      const city = view.phase === 'start' ? 'выбирает город' : CELLS[view.pos[seat]].t ?? 'в пути';
      return `${money(view.money[seat])}${h}${d}${b}${w} · ${city}`;
    },
    destroy() {
      cam?.destroy();
      wrap?.remove();
      panel?.remove();
      wrap = board = over = panel = note = card = null;
      cam = null;
      v = null;
      shown = [];
      shownOpen = [];
    },
  };
}

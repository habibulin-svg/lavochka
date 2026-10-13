/* Вид «Звезды Африки»: карта под камерой (приближение колесом и щипком, перетаскивание, миникарта,
 * кнопки «Вся карта» / «Где ход» / «Следить») плюс панель хода (кубик, подковы, перелёты, выбор города). */
import { BoardCam, type CamPoint } from '../../core/boardcam';
import { DiceTray } from '../../core/dice';
import { sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from '../hodilki/core';
import {
  AIR, AIR_FEE, CELLS, EDGE, FINISH, H, IDX, NEIGH, OPEN_FEE, TOK_FILE, TOKEN_AT, W,
  type Action, type Event, type State,
} from './engine';
import './star.css';

const money = (n: number) => `${n.toLocaleString('ru-RU')} $`;
const nameOf = (seat: number) => SEATS[seat]?.name ?? String(seat);
/** Фишка: размер и разводка, когда несколько встали на одну клетку. */
const PIECE_R = 36;
const PIECE_GAP = 68;

export function createView(): GameView<State, Event> {
  let ctx: ViewCtx<Action> | null = null;
  let wrap: HTMLElement | null = null;
  let board: HTMLElement | null = null;
  let over: SVGSVGElement | null = null;
  let panel: HTMLElement | null = null;
  let btns: HTMLElement | null = null;
  let tray: DiceTray | null = null;
  let stats: HTMLElement | null = null;
  let cam: BoardCam | null = null;
  let v: State | null = null;
  let actSeat: number | null = null;

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

  /** Фишки по клеткам: на одной клетке разводим в стороны, чтобы было видно всех. */
  function pieces() {
    const st = v!;
    const at = new Map<number, number[]>();
    for (const seat of st.seats) at.set(st.pos[seat], [...(at.get(st.pos[seat]) ?? []), seat]);
    for (const [cell, list] of at) {
      const c = CELLS[cell];
      list.forEach((seat, i) => {
        const off = list.length > 1 ? (i - (list.length - 1) / 2) * PIECE_GAP : 0;
        const x = c.x + off;
        over!.append(svg('circle', { cx: x, cy: c.y, r: PIECE_R, fill: SEATS[seat]?.color ?? '#888', class: 'st-piece' }));
        over!.append(label(x - 12, c.y + 14, 'st-piece-txt', nameOf(seat).slice(0, 1)));
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
      over.append(
        svg('circle', {
          cx: c.x,
          cy: c.y,
          r: tok ? 30 : city ? 26 : c.kind === 'sea' ? 7 : 9,
          class: `st-dot${tok ? ' st-dot-tok' : ''}${city ? ' st-dot-city' : ''}${c.kind === 'sea' ? ' st-dot-sea' : ''}`,
        })
      );
      if (tok) {
        if (st.open[i] && st.tokens[i]) {
          over.append(svg('image', { x: c.x - 26, y: c.y - 26, width: 52, height: 52, href: `/star/${TOK_FILE[st.tokens[i]!]}.webp` }));
        } else if (st.open[i]) {
          over.append(label(c.x - 6, c.y + 12, 'st-tok-txt', '·'));
        } else {
          over.append(svg('rect', { x: c.x - 24, y: c.y - 24, width: 48, height: 48, rx: 9, class: 'st-closed' }));
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
    if (st.phase === 'step' && st.left > 0 && actSeat != null) {
      const from = st.pos[actSeat];
      const owner = st.diamond === actSeat;
      NEIGH[from].forEach((to, k) => {
        // владельцу алмаза нельзя проходить через открытых разбойников
        if (owner && st.open[to] && st.tokens[to] === 'robber') return;
        const sea = EDGE[from][k] === 'sea' && TOKEN_AT[from];
        const g = svg('circle', { cx: CELLS[to].x, cy: CELLS[to].y, r: sea ? 38 : 32, class: 'st-move' });
        g.addEventListener('click', () => ctx?.act(actSeat!, { type: 'step', to }));
        over!.append(g);
      });
      for (const to of AIR[from]) {
        const g = svg('circle', { cx: CELLS[to].x, cy: CELLS[to].y, r: 28, class: 'st-fly' });
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
          <img class="st-map" src="/star/field.webp" alt="Карта Африки" draggable="false">
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
    },
    setView(view) {
      v = view;
      render();
    },
    async play(events, view) {
      const rolled = events.find((e) => e.type === 'roll');
      v = view;
      if (rolled && rolled.type === 'roll' && tray) await tray.roll([rolled.die], ctx?.speed?.() ?? 1);
      else await sleep(150);
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
      wrap = board = over = panel = null;
      cam = null;
      v = null;
    },
  };
}

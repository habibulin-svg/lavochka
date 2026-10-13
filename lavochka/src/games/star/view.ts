/* Вид «Звезды Африки»: карта с фишками и жетонами плюс панель хода (кубик, шаги, подковы, перелёты). */
import { DiceTray } from '../../core/dice';
import { sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from '../hodilki/core';
import {
  AIR, AIR_FEE, CELLS, EDGE, H, NEIGH, TOK_FILE, TOKEN_AT, W,
  type Action, type Event, type State,
} from './engine';
import './star.css';

const money = (n: number) => `${n.toLocaleString('ru-RU')} $`;
const nameOf = (seat: number) => SEATS[seat]?.name ?? String(seat);

export function createView(): GameView<State, Event> {
  let ctx: ViewCtx | null = null;
  let el: HTMLElement | null = null;
  let over: SVGSVGElement | null = null;
  let panel: HTMLElement | null = null;
  let btns: HTMLElement | null = null;
  let tray: DiceTray | null = null;
  let stats: HTMLElement | null = null;
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

  function render() {
    if (!v || !over || !btns || !stats) return;
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
        if (v.open[i] && v.tokens[i]) {
          over.append(svg('image', { x: c.x - 26, y: c.y - 26, width: 52, height: 52, href: `/star/${TOK_FILE[v.tokens[i]!]}.webp` }));
        } else if (v.open[i]) {
          over.append(label(c.x - 6, c.y + 12, 'st-tok-txt', '·'));
        } else {
          over.append(svg('rect', { x: c.x - 24, y: c.y - 24, width: 48, height: 48, rx: 9, class: 'st-closed' }));
        }
      }
      if (city) over.append(label(c.x - 46, c.y - 38, 'st-city', c.id === 'Tg' ? 'Танжер' : 'Каир'));
    }
    // куда можно шагнуть (свой ход)
    if (v.phase === 'step' && v.left > 0 && actSeat != null) {
      const from = v.pos[actSeat];
      NEIGH[from].forEach((to, k) => {
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
    }
    // фишки мест
    for (const seat of v.seats) {
      const c = CELLS[v.pos[seat]];
      over.append(svg('circle', { cx: c.x, cy: c.y, r: 30, fill: SEATS[seat]?.color ?? '#888', class: 'st-piece' }));
      over.append(label(c.x - 9, c.y + 11, 'st-piece-txt', nameOf(seat).slice(0, 1)));
      if (v.diamond === seat) over.append(label(c.x + 20, c.y - 18, 'st-gem', '💎'));
    }
    const cur = v;
    stats.textContent = cur.seats
      .map((s) => `${nameOf(s)}: ${money(cur.money[s])}${cur.horses[s] ? ` · 🧲${cur.horses[s]}` : ''}${cur.diamond === s ? ' · 💎' : ''}`)
      .join('   ');
    if (panel) panel.classList.toggle('st-hidden', actSeat == null);
    btns.replaceChildren();
    if (actSeat == null) return;
    const seat = actSeat;
    const add = (label: string, cls: string, action: Action) => {
      const b = document.createElement('button');
      b.className = `btn ${cls}`.trim();
      b.innerHTML = label;
      b.onclick = () => ctx?.act(seat, action);
      btns!.append(b);
    };
    if (v.phase === 'roll') {
      add('Бросить кубик', 'primary', { type: 'roll' });
      if (v.horses[seat] > 0) {
        add('🧲 подкова → 100 $', '', { type: 'horse', use: 'money' });
        add('🧲 подкова → лишний бросок', '', { type: 'horse', use: 'move' });
      }
      for (const to of AIR[v.pos[seat]]) {
        if (v.money[seat] < AIR_FEE) continue;
        add(`✈ ${CELLS[to].t ?? to} — ${AIR_FEE} $`, '', { type: 'air', to });
      }
    } else {
      add(`Остановиться (осталось ${v.left})`, 'primary', { type: 'stop' });
      if (v.horses[seat] > 0) add('🧲 подкова → 100 $', '', { type: 'horse', use: 'money' });
    }
  }

  return {
    mount(root, c) {
      ctx = c;
      el = document.createElement('div');
      el.className = 'st-wrap';
      el.innerHTML = '<img class="st-map" src="/star/field.webp" alt="Карта Африки" draggable="false">';
      over = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      over.setAttribute('class', 'st-over');
      over.setAttribute('viewBox', `0 0 ${W} ${H}`);
      el.append(over);
      root.append(el);
      panel = document.createElement('div');
      panel.className = 'st-panel';
      panel.innerHTML = `<div class="st-stats"></div><div class="st-tray dice-tray"></div><div class="st-btns"></div>
        <div class="hint small-hint">Зелёные кружки на карте — куда можно шагнуть, красные — авиалинии. Очки можно не истрачивать все: «Остановиться».</div>`;
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
    },
    setTurn(_toAct, interactive) {
      actSeat = v && v.winner == null && interactive.includes(v.turn) ? v.turn : null;
      render();
    },
    status(view, toAct, interactive) {
      if (view.winner != null) return `${nameOf(view.winner)}: «Звезда Африки» доставлена — победа!`;
      const me = interactive.includes(toAct[0]);
      if (view.phase === 'step') {
        return me
          ? `Осталось шагов: ${view.left}. Куда идти — выбираете сами.`
          : `${nameOf(toAct[0])} идёт по карте (осталось ${view.left}).`;
      }
      return me ? 'Бросайте кубик.' : `Бросает ${nameOf(toAct[0])}…`;
    },
    playerStats(view, seat) {
      const d = view.diamond === seat ? ' · 💎' : '';
      const h = view.horses[seat] ? ` · 🧲${view.horses[seat]}` : '';
      return `${money(view.money[seat])}${h}${d} · ${CELLS[view.pos[seat]].t ?? 'в пути'}`;
    },
    destroy() {
      el?.remove();
      panel?.remove();
      el = over = panel = null;
      v = null;
    },
  };
}

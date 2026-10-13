/* Вид «Чудовища Джио-Джанги»: поле под камерой сборника, пуговицы-фишки, панель экспедиции,
 * карточки ситуаций с ожиданием игрока (как в «Звезде Африки»). */
import { BoardCam, type CamPoint } from '../../core/boardcam';
import { DiceTray } from '../../core/dice';
import { sleep } from '../../core/util';
import { Sound } from '../../core/audio';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from '../hodilki/core';
import {
  CELLS, H, NEIGH, W, bestWeapon, describe, hasHorse, scoreOf,
  type Action, type Event, type State,
} from './engine';
import { CARDS, ITEMS, itemOf as item } from './rules';
import './djio.css';

const money = (n: number) => `${n.toLocaleString('ru-RU')} $`;
const nameOf = (seat: number) => SEATS[seat]?.name ?? String(seat);
const PIECE_R = 34;
const PIECE_GAP = 58;
/** Сколько держать событие на экране, если за экраном не человек. */
const PACE: { [k: string]: number } = { card: 2600, die: 2600, win: 2400, home: 2200, shoot: 1200, attack: 1600, cross: 1800, swamp: 1700, film: 1600 };

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
  let shown: number[] = [];
  let busy = false;

  const svg = (tag: string, attrs: Record<string, string | number>) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, String(val));
    return e;
  };

  function pieces() {
    const st = v!;
    const at = new Map<number, number[]>();
    for (const seat of st.seats) {
      const p = shown[seat] ?? st.pos[seat];
      at.set(p, [...(at.get(p) ?? []), seat]);
    }
    for (const [cell, list] of at) {
      const c = CELLS[cell];
      list.forEach((seat, i) => {
        const off = list.length > 1 ? (i - (list.length - 1) / 2) * PIECE_GAP : 0;
        const el = svg('image', {
          x: c.x + off - PIECE_R, y: c.y - PIECE_R, width: PIECE_R * 2, height: PIECE_R * 2,
          href: `/hodilki/buttons/${seat}.webp`, class: 'dj-piece',
        });
        // свою пуговицу можно взять и переставить на подсвеченную клетку — как в кинь-двинь
        if (seat === actSeat && st.phase === 'move' && st.left > 0) {
          el.setAttribute('class', 'dj-piece dj-take');
          el.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            const from = { x: e.clientX, y: e.clientY };
            const up = (ev: PointerEvent) => {
              document.removeEventListener('pointerup', up);
              if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 6) return;
              const p = cam!.toImg(ev.clientX, ev.clientY);
              let best = -1;
              let bd = Infinity;
              for (const g of Array.from(over!.querySelectorAll('circle.dj-move'))) {
                const to = Number((g as Element).getAttribute('data-to'));
                const cc = CELLS[to];
                const d = Math.hypot(cc.x - p.x, cc.y - p.y);
                if (d < bd) {
                  bd = d;
                  best = to;
                }
              }
              if (best >= 0 && bd < 90) ctx?.act(seat, { type: 'step', to: best });
            };
            document.addEventListener('pointerup', up, { once: true });
          });
        }
        over!.append(el);
        if (hasHorse(st, seat) && i === 0) {
          const t = svg('text', { x: c.x + off + 26, y: c.y - 22, class: 'dj-mark' });
          t.textContent = '🐎';
          over!.append(t);
        }
      });
    }
  }

  function turnPoints(): CamPoint[] {
    const st = v;
    if (!st || st.over) return [];
    if (st.phase === 'buy') return [CELLS[st.pos[st.turn]]];
    const seat = actSeat ?? st.turn;
    const pts = [CELLS[st.pos[seat]]];
    if (st.phase === 'move' && st.left > 0) for (const to of NEIGH[st.pos[seat]]) pts.push(CELLS[to]);
    return pts;
  }

  const others = (): CamPoint[] => (v ? v.seats.map((s) => CELLS[shown[s] ?? v!.pos[s]]) : []);

  function render() {
    if (!v || !over || !btns || !stats) return;
    const st = v;
    over.replaceChildren();
    // куда можно шагнуть (свой ход)
    if (!busy && st.phase === 'move' && st.left > 0 && actSeat != null) {
      for (const to of NEIGH[st.pos[actSeat]]) {
        const g = svg('circle', { cx: CELLS[to].x, cy: CELLS[to].y, r: 30, class: 'dj-move', 'data-to': to });
        g.addEventListener('click', () => ctx?.act(actSeat!, { type: 'step', to }));
        over.append(g);
      }
    }
    // дикие звери: где какое чудовище живёт (подсказка на карте)
    pieces();
    const line = (s: number) => {
      const it = st.items[s];
      const bag = it.filter((x) => x !== 'horse').map((x) => item(x).name);
      const skins = Object.keys(st.skins)
        .filter((k) => k.startsWith(`${s}:`))
        .map((k) => {
          const n = st.skins[k];
          const id = k.split(':')[1];
          return `${id}×${n}`;
        });
      return `${nameOf(s)}: ${money(st.money[s])}${hasHorse(st, s) ? ' · 🐎' : ''}${bag.length ? ` · ${bag.join(', ')}` : ''}${skins.length ? ` · шкуры: ${skins.join(', ')}` : ''}`;
    };
    stats.textContent = st.seats.map((s) => line(s)).join('   ');
    if (panel) panel.classList.toggle('dj-hidden', actSeat == null);
    btns.replaceChildren();
    if (actSeat == null) return;
    const seat = actSeat;
    const add = (text: string, cls: string, action: Action, tap = false) => {
      const b = document.createElement('button');
      b.className = `btn ${cls}`.trim();
      b.innerHTML = text;
      if (tap) b.dataset.tap = '';
      b.onclick = () => ctx?.act(seat, action);
      btns!.append(b);
    };
    if (st.phase === 'buy') {
      for (const it of ITEMS) {
        const taken = st.seats.reduce((n, x) => n + st.items[x].filter((i) => i === it.id).length, 0);
        if (taken >= it.count || st.money[seat] < it.price) continue;
        if (it.id === 'horse' && hasHorse(st, seat)) continue;
        add(`${it.name} — ${money(it.price)}`, '', { type: 'buy', item: it.id });
      }
      add('В путь!', 'primary', { type: 'ready' });
      return;
    }
    if (st.phase === 'card') {
      add('Дальше', 'primary', { type: 'ok' }, true);
      return;
    }
    if (st.phase === 'choice' && st.ask) {
      for (const o of st.ask.options) {
        if (st.ask.kind === 'give') add(`Взять: ${item(o).name}`, '', { type: 'pick', pick: o });
        else add(`${item(o).name} (отдать)`, '', { type: 'pick', pick: o });
      }
      if (st.ask.kind === 'natives') {
        if (st.money[seat] >= 10000) add('Отсчитать 10 000 $', '', { type: 'pick', pick: 'money' });
        if (hasHorse(st, seat)) add('Отдать лошадь', '', { type: 'pick', pick: 'horse' });
      }
      return;
    }
    if (st.phase === 'shoot') {
      const w = bestWeapon(st, seat);
      add(`Выстрел (${w ? item(w).name : '—'})`, 'primary', { type: 'shoot' }, true);
      return;
    }
    if (st.phase === 'stop') {
      add('Привал: дальше', 'primary', { type: 'stop' }, true);
      return;
    }
    if (st.phase === 'move') {
      add(`Остановиться (осталось ${st.left})`, 'primary', { type: 'stop' });
      return;
    }
    // обычный ход
    add(hasHorse(st, seat) && !st.lead ? 'Бросить кубик (+6 за лошадь)' : 'Бросить кубик', 'primary', { type: 'roll' }, true);
    if (hasHorse(st, seat)) add(st.lead ? 'Сесть на лошадь (+6)' : 'Вести лошадь на поводу', '', { type: 'lead', on: !st.lead });
  }

  function frame() {
    if (!cam || !v) return;
    void cam.frame(turnPoints(), others());
  }

  return {
    mount(root, c) {
      ctx = c;
      wrap = document.createElement('div');
      wrap.className = 'dj-wrap';
      wrap.innerHTML = `<div class="dj-board"><img class="dj-map dj-map-mini" src="/djio/field-small.webp" alt="" draggable="false"><img class="dj-map dj-map-full" src="/djio/field.webp" alt="Поле Джио-Джанги" draggable="false"></div>`;
      root.append(wrap);
      board = wrap.querySelector('.dj-board') as HTMLElement;
      over = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      over.setAttribute('class', 'dj-over');
      over.setAttribute('viewBox', `0 0 ${W} ${H}`);
      board.append(over);
      cam = new BoardCam(wrap, board, {
        w: W,
        h: H,
        mini: '/djio/field.webp',
        src: W,
        token: (PIECE_R * 2) / W,
        followKey: 'djio.follow',
        demo: c.demo,
        speed: () => ctx!.speed(),
        dots: () =>
          v
            ? v.seats.map((s) => ({ key: s, x: CELLS[v!.pos[s]].x, y: CELLS[v!.pos[s]].y, color: SEATS[s]?.color ?? '#888', on: s === v!.turn }))
            : [],
        turn: turnPoints,
      });
      const img = wrap.querySelector('.dj-map') as HTMLImageElement;
      c.hold?.(9000);
      const ready = () => {
        board!.classList.add('ready');
        ctx?.hold?.(0);
        cam!.shown();
      };
      if (img.complete && img.naturalWidth) ready();
      else img.onload = ready;
      panel = document.createElement('div');
      panel.className = 'dj-panel';
      panel.innerHTML = `<div class="dj-stats"></div><div class="dj-tray dice-tray"></div><div class="dj-btns"></div>
        <div class="hint small-hint">Карта приближается колесом и кнопками «+» / «−». Зелёные кружки — куда шагнуть
        (по ленте можно в любую сторону). У домиков, монастыря, хижин и костров остановка обязательна. Кубик — пробелом.</div>`;
      c.controls.append(panel);
      stats = panel.querySelector('.dj-stats') as HTMLElement;
      btns = panel.querySelector('.dj-btns') as HTMLElement;
      tray = new DiceTray(panel.querySelector('.dj-tray') as HTMLElement, 1);
      note = document.createElement('div');
      note.className = 'dj-note bc-ui';
      note.hidden = true;
      card = document.createElement('div');
      card.className = 'dj-card bc-ui';
      card.hidden = true;
      card.innerHTML = `<img alt="" draggable="false" hidden><div class="dj-card-t"></div><div class="dj-card-s"></div><div class="dj-card-h">нажмите, чтобы продолжить</div>`;
      card.addEventListener('pointerdown', () => {
        card!.hidden = true;
      });
      wrap.append(note, card);
    },
    setView(view) {
      v = view;
      shown = view.pos.slice();
      render();
    },
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
        // звуки событий: шаг, находка, съёмка, выстрел, беда, победа
        if (ev.type === 'step') Sound.step();
        if (ev.type === 'card' || ev.type === 'buy' || ev.type === 'item') Sound.place();
        if (ev.type === 'film') Sound.jump();
        if (ev.type === 'shoot' || ev.type === 'attack') Sound.diceRoll(0.35);
        if (ev.type === 'die' || ev.type === 'cross' || ev.type === 'swamp') Sound.nomove();
        if (ev.type === 'win' || ev.type === 'home') Sound.win();
        if (ev.type === 'step') shown[ev.seat] = ev.to;
        const text = describe(ev, (s) => nameOf(s));
        if (!text) continue;
        note!.innerHTML = text;
        note!.hidden = false;
        render();
        if (ev.type === 'card') {
          const c = CARDS.find((x) => x.n === ev.card)!;
          (card!.querySelector('.dj-card-t') as HTMLElement).textContent = c.title;
          (card!.querySelector('.dj-card-s') as HTMLElement).textContent = c.text;
          card!.hidden = false;
          await (ctx?.read ? ctx.read(PACE.card) : sleep(PACE.card / speed));
          card!.hidden = true;
        } else {
          await (ctx?.read ? ctx.read(PACE[ev.type] ?? 900) : sleep((PACE[ev.type] ?? 900) / speed));
        }
        if (ev.type === 'step') await sleep(200 / speed);
      }
      busy = false;
      note!.hidden = true;
      render();
      frame();
    },
    setTurn(_toAct, interactive) {
      actSeat = v && !v.over && interactive.includes(v.turn) ? v.turn : null;
      if (actSeat != null) cam?.release();
      render();
      frame();
    },
    status(view, act) {
      if (view.over) return 'Экспедиция окончена: считаем деньги, шкуры и снаряжение.';
      if (view.phase === 'buy') return 'Сборы: покупайте снаряжение — по одному предмету за ход.';
      if (view.phase === 'card') return 'Карточка ситуаций: прочитайте и нажмите «Дальше».';
      if (view.phase === 'choice') return 'Выбирайте, что делать.';
      if (view.phase === 'shoot') return `Стреляйте: попаданий ${view.hits}, нужно ещё.`;
      if (view.phase === 'wait') return `Ждём цифру ${view.waits[act[0]]} — пока стоим на месте.`;
      if (view.phase === 'move') return `Осталось шагов: ${view.left}.`;
      return 'Бросайте кубик — пробелом или кнопкой.';
    },
    playerStats(view, seat) {
      const it = view.items[seat];
      return `${money(view.money[seat])}${hasHorse(view, seat) ? ' · 🐎' : ''}${it.length ? ` · ${it.length} предм.` : ''} · счёт ${money(scoreOf(view, seat))}`;
    },
    destroy() {
      cam?.destroy();
      wrap?.remove();
      panel?.remove();
      wrap = board = over = panel = note = card = null;
      cam = null;
      v = null;
      shown = [];
    },
  };
}

/* Вид «Беглых»: карта под камерой, пуговицы-фишки, кубик со знаками и события, которые ждут игрока. */
import { BoardCam, type CamPoint } from '../../core/boardcam';
import { sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from '../hodilki/core';
import {
  CELLS, FACES, H, NEIGH, SIGN_NAME, W, describe, type Action, type Event, type State,
} from './engine';
import './beglye.css';

const nameOf = (seat: number) => SEATS[seat]?.name ?? String(seat);
const PIECE_R = 30;
/** Цвет кружка по знаку клетки. */
const SIGN_COLOR: { [k: string]: string } = {
  monastery: '#f4f2e3',
  resident: '#c9a2e0',
  ostrog: '#d8463c',
  arrest: '#e8a13a',
  forest: '#4f9d52',
  plen: '#e0713a',
  robber: '#6b4b3a',
  death: '#8a8a8a',
  boat: '#4a7fc1',
  horse: '#c8a163',
  cart: '#8f6b45',
};

export function createView(): GameView<State, Event> {
  let ctx: ViewCtx<Action> | null = null;
  let wrap: HTMLElement | null = null;
  let board: HTMLElement | null = null;
  let over: SVGSVGElement | null = null;
  let panel: HTMLElement | null = null;
  let btns: HTMLElement | null = null;
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
        const off = list.length > 1 ? (i - (list.length - 1) / 2) * 50 : 0;
        over!.append(
          svg('image', {
            x: c.x + off - PIECE_R, y: c.y - PIECE_R, width: PIECE_R * 2, height: PIECE_R * 2,
            href: `/hodilki/buttons/${seat}.webp`, class: 'bg-piece',
          })
        );
        if (st.hold[seat] !== 'none' && i === 0) {
          const t = svg('text', { x: c.x + off + 20, y: c.y - 18, class: 'bg-mark' });
          t.textContent = st.hold[seat] === 'ostrog' ? '⛓' : st.hold[seat] === 'plen' ? '🐎' : st.hold[seat] === 'robber' ? '🗡' : '⛪';
          over!.append(t);
        }
      });
    }
  }

  function turnPoints(): CamPoint[] {
    const st = v;
    if (!st || st.winner != null) return [];
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
    for (let i = 0; i < CELLS.length; i++) {
      const c = CELLS[i];
      const sign = c.signs[0];
      const color = c.kind === 'finish' ? '#ffd764' : c.kind === 'start' ? '#f4f2e3' : sign ? SIGN_COLOR[sign] ?? '#bbb' : 'rgba(0,0,0,0.25)';
      over.append(
        svg('circle', {
          cx: c.x, cy: c.y,
          r: c.kind === 'point' ? (sign ? 15 : 9) : 26,
          class: 'bg-dot',
          style: `stroke:${color}`,
        })
      );
    }
    if (!busy && actSeat != null && st.phase === 'move' && st.left > 0) {
      for (const to of NEIGH[st.pos[actSeat]]) {
        const g = svg('circle', { cx: CELLS[to].x, cy: CELLS[to].y, r: 26, class: 'bg-move' });
        g.addEventListener('click', () => ctx?.act(actSeat!, { type: 'step', to }));
        over.append(g);
      }
    }
    pieces();
    stats.textContent = st.seats
      .map((s) => {
        const hold = st.hold[s];
        const where = hold === 'none' ? 'на воле' : hold === 'monastery' ? 'в монастыре' : hold === 'resident' ? 'у помещика' : hold === 'plen' ? 'в плену' : hold === 'robber' ? 'в шайке' : 'по этапу';
        return `${nameOf(s)}: ${where}`;
      })
      .join('   ');
    if (panel) panel.classList.toggle('bg-hidden', actSeat == null);
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
    if (st.phase === 'roll') {
      add('Бросить кубик', 'primary', { type: 'roll' }, true);
      return;
    }
    if (st.phase === 'move') {
      add(`Остаться на месте`, '', { type: 'stay' });
      return;
    }
  }

  function frame() {
    if (!cam || !v) return;
    void cam.frame(turnPoints(), others());
  }

  return {
    mount(root, c) {
      ctx = c;
      wrap = document.createElement('div');
      wrap.className = 'bg-wrap';
      wrap.innerHTML = `<div class="bg-board"><img class="bg-map" src="/beglye/field.webp" alt="Карта" draggable="false"></div>`;
      root.append(wrap);
      board = wrap.querySelector('.bg-board') as HTMLElement;
      over = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      over.setAttribute('class', 'bg-over');
      over.setAttribute('viewBox', `0 0 ${W} ${H}`);
      board.append(over);
      cam = new BoardCam(wrap, board, {
        w: W,
        h: H,
        mini: '/beglye/field.webp',
        src: W,
        token: (PIECE_R * 2) / W,
        followKey: 'beglye.follow',
        demo: c.demo,
        speed: () => ctx!.speed(),
        dots: () => (v ? v.seats.map((s) => ({ key: s, x: CELLS[v!.pos[s]].x, y: CELLS[v!.pos[s]].y, color: SEATS[s]?.color ?? '#888', on: s === v!.turn })) : []),
        turn: turnPoints,
      });
      const img = wrap.querySelector('.bg-map') as HTMLImageElement;
      c.hold?.(9000);
      const ready = () => {
        board!.classList.add('ready');
        ctx?.hold?.(0);
        cam!.shown();
      };
      if (img.complete && img.naturalWidth) ready();
      else img.onload = ready;
      panel = document.createElement('div');
      panel.className = 'bg-panel';
      panel.innerHTML = `<div class="bg-stats"></div><div class="bg-btns"></div>
        <div class="hint small-hint">Ход — на один пункт по любой дороге, куда хотите. Перед ходом бросают кубик со знаками:
        совпал знак с пунктом, где стоит фишка, — случается то, что написано в легенде. «Побег» выпускает из монастыря,
        острога и плена и даёт лишний бросок. Кубик бросают пробелом.</div>`;
      c.controls.append(panel);
      stats = panel.querySelector('.bg-stats') as HTMLElement;
      btns = panel.querySelector('.bg-btns') as HTMLElement;
      note = document.createElement('div');
      note.className = 'bg-note bc-ui';
      note.hidden = true;
      card = document.createElement('div');
      card.className = 'bg-card bc-ui';
      card.hidden = true;
      card.innerHTML = `<div class="bg-card-f"></div><div class="bg-card-t"></div><div class="bg-card-s"></div><div class="bg-card-h">нажмите, чтобы продолжить</div>`;
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
        if (ev.type === 'step') shown[ev.seat] = ev.to;
        const text = describe(ev, (s) => nameOf(s));
        if (!text) continue;
        note!.innerHTML = text;
        note!.hidden = false;
        render();
        if (ev.type === 'roll') {
          // показываем грань кубика карточкой и ждём игрока
          const face = FACES.find((f) => f.name === ev.face) ?? FACES[0];
          (card!.querySelector('.bg-card-f') as HTMLElement).textContent = face.short;
          (card!.querySelector('.bg-card-t') as HTMLElement).textContent = face.name;
          (card!.querySelector('.bg-card-s') as HTMLElement).innerHTML = face.symbols.length
            ? `Знаки на грани: ${face.symbols.map((s) => SIGN_NAME[s] ?? s).join(', ')}.`
            : face.escape
              ? 'Можно бежать из монастыря, острога и плена, и бросок даётся ещё раз.'
              : 'Можно уходить из монастыря и от помещика.';
          card!.hidden = false;
          await (ctx?.read ? ctx.read(2000) : sleep(2000 / speed));
          card!.hidden = true;
        } else if (ev.type === 'hold' || ev.type === 'jail' || ev.type === 'death' || ev.type === 'win') {
          await (ctx?.read ? ctx.read(1600) : sleep(1600 / speed));
        } else {
          await sleep(400 / speed);
        }
      }
      busy = false;
      note!.hidden = true;
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
      if (view.winner != null) return `${nameOf(view.winner)} дошёл до устья Дона — воля!`;
      const me = act.includes(view.turn);
      const hold = view.hold[view.turn];
      if (hold === 'ostrog') return me ? 'Вы идёте по этапу: нужен «Побег».' : 'Этап идёт к монастырю.';
      if (hold !== 'none') return me ? 'Ждём «Побег» (или «Юрьев день», если вы в монастыре или у помещика).' : 'Ждёт свободы.';
      if (view.phase === 'move') return me ? 'Куда идти — выбирайте сами.' : 'Идёт по дороге.';
      return me ? 'Бросайте кубик — пробелом или кнопкой.' : 'Бросает кубик…';
    },
    playerStats(view, seat) {
      const hold = view.hold[seat];
      const where = hold === 'none' ? 'на воле' : hold === 'monastery' ? 'монастырь' : hold === 'resident' ? 'помещик' : hold === 'plen' ? 'плен' : hold === 'robber' ? 'шайка' : 'этап';
      return `${where}${view.boat[seat] ? ' · лодка' : ''}`;
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

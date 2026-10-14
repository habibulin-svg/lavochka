/* Вид «Чудовища Джио-Джанги»: поле под камерой сборника (приближение, миникарта, «Где ход»), пуговицы-фишки
 * едут по клеткам ленты шаг за шагом, подсветка развилок, карточки ситуаций и события плашками,
 * панель экспедиции: кубик, кнопки хода, покупки, выбор (туземцы, переправа, зверь). */
import { Sound } from '../../core/audio';
import { BoardCam, type CamPoint } from '../../core/boardcam';
import { DiceTray } from '../../core/dice';
import { sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from '../hodilki/core';
import {
  CELLS, H, NEIGH, W, bestWeapon, canBuy, describe, foeName, has, hasHorse, isAnimal, options, pickLabel, scoreOf, seriesOf, shopAt,
  type Action, type Event, type State,
} from './engine';
import { ANIMALS, CARDS, ITEMS, STOPS, itemOf, type StopKind } from './rules';
import './djio.css';

const money = (n: number) => `${n.toLocaleString('ru-RU')} $`;
const nameOf = (seat: number) => SEATS[seat]?.name ?? String(seat);
/** Клетка ленты на поле — около 110 px; пуговица чуть меньше, чтобы стояла на клетке. */
const PIECE_R = 50;
const PIECE_GAP = 56;
const NS = 'http://www.w3.org/2000/svg';
/** Сколько держать событие (мс), если за экраном не человек. */
const PACE: { [k: string]: number } = {
  card: 2600, die: 2400, win: 2600, home: 2200, stop: 1500, swamp: 1700, rope: 1500, cross: 1700, foe: 1600,
  natives: 1300, beast: 1400, film: 1500, shoot: 700, attack: 1000, kill: 1600, smoke: 1100, gift: 1300, need: 1300, wait: 1100,
};
/** Важные события: за экраном человек — ждём касания. */
const IMPORTANT = new Set(['card', 'die', 'win', 'home', 'foe', 'kill']);

export function createView(): GameView<State, Event> {
  let ctx: ViewCtx<Action> | null = null;
  let wrap: HTMLElement | null = null;
  let board: HTMLElement | null = null;
  let over: SVGSVGElement | null = null;
  let gBoard: SVGGElement | null = null;
  let gTrail: SVGGElement | null = null;
  let gPieces: SVGGElement | null = null;
  let panel: HTMLElement | null = null;
  let stats: HTMLElement | null = null;
  let btns: HTMLElement | null = null;
  let tray: DiceTray | null = null;
  let note: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  let cam: BoardCam | null = null;
  let v: State | null = null;
  let actSeat: number | null = null;
  let shown: number[] = [];
  let trail: { seat: number; cells: number[] } | null = null;
  let busy = false;
  const pieceEls = new Map<number, SVGGElement>();
  const at = new Map<number, { x: number; y: number }>();

  const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, String(val));
    return e;
  };
  const speed = () => Math.max(0.25, ctx?.speed?.() ?? 1);

  /* ---------- фишки ---------- */

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
        out.set(seat, { x: c.x + off, y: c.y - (list.length > 2 && i % 2 ? 30 : 0) });
      });
    }
    return out;
  }

  function pieceEl(seat: number): SVGGElement {
    let g = pieceEls.get(seat);
    if (g) return g;
    g = svg('g', { class: 'dj-piece' });
    g.append(
      svg('ellipse', { cx: 0, cy: PIECE_R * 0.55, rx: PIECE_R * 0.95, ry: PIECE_R * 0.42, class: 'dj-shadow' }),
      svg('image', { x: -PIECE_R, y: -PIECE_R, width: PIECE_R * 2, height: PIECE_R * 2, href: `/hodilki/buttons/${seat}.webp` }),
      svg('text', { x: PIECE_R * 0.5, y: -PIECE_R * 0.5, class: 'dj-mark' })
    );
    takeable(g, seat);
    gPieces!.append(g);
    pieceEls.set(seat, g);
    return g;
  }

  const put = (seat: number, p: { x: number; y: number }, lift = 0) => {
    pieceEl(seat).setAttribute('transform', `translate(${p.x} ${p.y - lift})${lift ? ` scale(${1 + lift / 160})` : ''}`);
    at.set(seat, p);
  };

  function placePieces() {
    if (!v || !gPieces) return;
    const sp = spots();
    for (const seat of v.seats) {
      const g = pieceEl(seat);
      g.classList.toggle('dj-turn', seat === v.turn && !v.over);
      g.classList.toggle('dj-can', canMove(seat));
      (g.querySelector('.dj-mark') as SVGTextElement).textContent = v.wait[seat] ? '⏳' : hasHorse(v, seat) ? '🐎' : '';
      put(seat, sp.get(seat)!);
    }
    const cur = pieceEls.get(v.turn);
    if (cur) gPieces.append(cur);
  }

  /** Фишка едет с клетки на клетку коротким скачком. */
  function glide(seat: number, to: number, ms: number, arc: number): Promise<void> {
    const from = at.get(seat) ?? { x: CELLS[to].x, y: CELLS[to].y };
    shown[seat] = to;
    const dest = spots().get(seat)!;
    const g = pieceEl(seat);
    gPieces!.append(g);
    return new Promise((done) => {
      const t0 = performance.now();
      let end = false;
      const finish = () => {
        if (end) return;
        end = true;
        put(seat, dest);
        placePieces();
        done();
      };
      const tick = (now: number) => {
        if (end) return;
        const k = Math.min(1, (now - t0) / ms);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        put(seat, { x: from.x + (dest.x - from.x) * e, y: from.y + (dest.y - from.y) * e }, Math.sin(Math.PI * k) * arc);
        if (k < 1 && g.isConnected) requestAnimationFrame(tick);
        else finish();
      };
      requestAnimationFrame(tick);
      // вкладка в фоне не рисует кадры — фишка всё равно встаёт на место вовремя
      setTimeout(finish, ms + 120);
    });
  }

  const canMove = (seat: number) => !!v && !busy && seat === actSeat && !v.over && v.phase === 'move' && v.left > 0;
  const targets = (): number[] => (v && actSeat != null && canMove(actSeat) ? options(v, actSeat) : []);

  /** Свою фишку можно взять и переставить на подсвеченную клетку. */
  function takeable(el: SVGGElement, seat: number) {
    el.addEventListener('pointerdown', (e) => {
      if (!canMove(seat)) return;
      e.preventDefault();
      e.stopPropagation();
      const from = { x: e.clientX, y: e.clientY };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* не все браузеры умеют */
      }
      const move = (ev: PointerEvent) => put(seat, cam!.toImg(ev.clientX, ev.clientY), 10);
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
        if (best < 0 || bd > 120) {
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

  /* ---------- карта ---------- */

  function turnPoints(): CamPoint[] {
    const st = v;
    if (!st || st.over) return [];
    const from = shown[st.turn] ?? st.pos[st.turn];
    const pts: CamPoint[] = [CELLS[from]];
    if (st.phase === 'move' && st.left > 0) for (const to of NEIGH[from]) pts.push(CELLS[to]);
    return pts;
  }
  const others = (): CamPoint[] => (v ? v.seats.map((s) => CELLS[shown[s] ?? v!.pos[s]]) : []);

  function drawTrail() {
    if (!gTrail) return;
    gTrail.replaceChildren();
    if (!trail || trail.cells.length < 2) return;
    const pts = trail.cells.map((c) => `${CELLS[c].x},${CELLS[c].y}`).join(' ');
    gTrail.append(svg('polyline', { points: pts, class: 'dj-trail-under' }), svg('polyline', { points: pts, class: 'dj-trail', stroke: SEATS[trail.seat]?.color ?? '#fff' }));
  }

  function render() {
    if (!v || !gBoard) return;
    gBoard.replaceChildren();
    if (!busy && actSeat != null) {
      const seat = actSeat;
      for (const to of targets()) {
        const g = svg('circle', { cx: CELLS[to].x, cy: CELLS[to].y, r: 62, class: 'dj-move' });
        g.addEventListener('click', () => ctx?.act(seat, { type: 'step', to }));
        gBoard.append(g);
      }
    }
    drawTrail();
    placePieces();
    panelRender();
  }

  function panelRender() {
    const st = v!;
    if (stats) {
      stats.innerHTML = st.seats
        .map((s) => {
          const bag = st.items[s].map((x) => itemOf(x).name);
          const skins = st.skins[s].map((id) => ANIMALS.find((a) => a.id === id)?.name ?? id);
          return `<div><b style="color:${SEATS[s]?.color ?? '#fff'}">${nameOf(s)}</b>: ${money(st.money[s])}${bag.length ? ` · ${bag.join(', ')}` : ''}${skins.length ? ` · шкуры: ${skins.join(', ')}` : ''}</div>`;
        })
        .join('');
    }
    if (!btns) return;
    btns.replaceChildren();
    if (panel) panel.classList.toggle('dj-hidden', actSeat == null || busy);
    if (actSeat == null || busy || st.over) return;
    const seat = actSeat;
    const add = (text: string, cls: string, action: Action, tap = false) => {
      const b = document.createElement('button');
      b.className = `btn ${cls}`.trim();
      b.innerHTML = text;
      if (tap) b.dataset.tap = '';
      b.onclick = () => {
        Sound.ui();
        ctx?.act(seat, action);
      };
      btns!.append(b);
    };
    const shop = (title: string) => {
      const h = document.createElement('div');
      h.className = 'dj-shop-h';
      h.textContent = title;
      btns!.append(h);
      for (const it of ITEMS) if (canBuy(st, seat, it.id)) add(`${it.name} — ${money(it.price)} <small>${it.note}</small>`, 'dj-buy', { type: 'buy', item: it.id });
    };
    if (st.phase === 'buy') {
      add('Хватит — закончить сборы', 'primary', { type: 'done' });
      shop(st.perTurn > 1 ? `Покупка ${st.bought + 1} из ${st.perTurn} за этот ход:` : 'Купить один предмет (по одному за ход):');
      return;
    }
    if (st.phase === 'roll') {
      if (isAnimal(st.pos[seat]) && !st.wait[seat]) add('📷 Снимать дальше (бросок у зверя)', 'primary', { type: 'film' });
      const horse = hasHorse(st, seat) && !st.lead[seat];
      add(st.wait[seat] ? `Бросить кубик (нужно ${st.wait[seat]})` : horse ? 'Бросить кубик (+6 лошадь)' : 'Бросить кубик', isAnimal(st.pos[seat]) ? '' : 'primary', { type: 'roll' }, true);
      if (hasHorse(st, seat)) add(st.lead[seat] ? 'Сесть на лошадь (+6)' : 'Вести лошадь на поводу', '', { type: 'lead', on: !st.lead[seat] });
      if (shopAt(st, seat)) {
        shop(CELLS[st.pos[seat]].kind === 'monastery' ? 'Монастырь — купить:' : 'Гостиница — купить:');
        if (CELLS[st.pos[seat]].kind === 'monastery') for (const it of new Set(st.items[seat])) add(`Продать: ${itemOf(it).name} — ${money(itemOf(it).price)}`, 'dj-buy', { type: 'sell', item: it });
      }
      return;
    }
    if (st.phase === 'ask' && st.ask) {
      for (const o of st.ask.options) add(pickLabel(st.ask, o), '', { type: 'pick', pick: o });
      return;
    }
    if (st.phase === 'shoot' && st.fight) {
      const w = bestWeapon(st, seat);
      add(`🎯 Выстрел (${w ? itemOf(w).name : '—'}) — попаданий ${st.fight.hits} из ${st.fight.need}, в серии ${st.fight.shots}`, 'primary', { type: 'shoot' }, true);
      if (has(st, seat, 'smoke') && !(st.fight.oneShot && ['gangster', 'priests', 'mad', 'puma'].includes(st.fight.foe))) add('Бросить дымовую шашку и уйти', '', { type: 'smoke' });
    }
  }

  function frame(pts?: CamPoint[]) {
    if (!cam || !v) return Promise.resolve();
    return cam.frame(pts ?? turnPoints(), others());
  }

  function say(text: string) {
    note!.innerHTML = text;
    note!.hidden = false;
  }
  const wait = (type: string) => {
    const ms = PACE[type] ?? 900;
    return IMPORTANT.has(type) && ctx?.read ? ctx.read(ms) : sleep(ms / speed());
  };

  function sound(ev: Event) {
    switch (ev.type) {
      case 'buy':
      case 'sell':
      case 'item':
      case 'gift':
        return Sound.place();
      case 'card':
        return Sound.card();
      case 'film':
      case 'kill':
        return Sound.jump();
      case 'shoot':
        return ev.hit ? Sound.capture() : Sound.beep(900, 0.06, 0.1);
      case 'attack':
        return ev.ok ? Sound.ui() : Sound.capture();
      case 'die':
        return Sound.nomove();
      case 'swamp':
      case 'cross':
      case 'rope':
      case 'need':
      case 'wait':
        return 'ok' in ev && ev.ok === false ? Sound.nomove() : 'saved' in ev && !ev.saved ? Sound.nomove() : Sound.ui();
      case 'stop':
        return Sound.home();
      case 'home':
      case 'win':
        return Sound.win();
      default:
        return Sound.ui();
    }
  }

  /** Кубик в лотке: бросок хода и все броски на клетках. */
  const dieOf = (ev: Event): number | null =>
    ev.type === 'swamp' || ev.type === 'cross' || ev.type === 'beast' || ev.type === 'shoot' || ev.type === 'attack' || ev.type === 'wait' ? ev.die : null;

  return {
    mount(root, c) {
      ctx = c;
      wrap = document.createElement('div');
      wrap.className = 'dj-wrap';
      wrap.innerHTML = `<div class="dj-board"><img class="dj-map dj-map-mini" src="/djio/field-small.webp" alt="" draggable="false"><img class="dj-map dj-map-full" src="/djio/field.webp" alt="Поле Джио-Джанги" draggable="false"></div>`;
      root.append(wrap);
      board = wrap.querySelector('.dj-board') as HTMLElement;
      over = document.createElementNS(NS, 'svg');
      over.setAttribute('class', 'dj-over');
      over.setAttribute('viewBox', `0 0 ${W} ${H}`);
      gBoard = svg('g', {});
      gTrail = svg('g', { class: 'dj-trail-g' });
      gPieces = svg('g', {});
      over.append(gBoard, gTrail, gPieces);
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
        dots: () => (v ? v.seats.map((s) => ({ key: s, x: CELLS[shown[s] ?? v!.pos[s]].x, y: CELLS[shown[s] ?? v!.pos[s]].y, img: `/hodilki/buttons/${s}.webp`, on: s === v!.turn })) : []),
        turn: turnPoints,
      });
      const img = wrap.querySelector('.dj-map-full') as HTMLImageElement;
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
      panel.innerHTML = `<div class="dj-tray dice-tray"></div><div class="dj-btns"></div><div class="dj-stats"></div>
        <div class="hint small-hint">Жёлтые кружки — куда шагнуть на развилке (или перетащите фишку). По ленте можно идти в любую сторону,
        у построек, на берегу и в тупике у зверя — остановка. Кубик — пробелом или тапом по полю.</div>`;
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
      card.innerHTML = `<div class="dj-card-k">Карточка ситуаций</div><div class="dj-card-t"></div><div class="dj-card-s"></div>`;
      wrap.append(note, card);
    },
    setView(view) {
      v = view;
      shown = view.pos.slice();
      if (view.phase !== 'move') trail = null;
      render();
    },
    async play(events, view) {
      const prev = v;
      v = view;
      if (prev) shown = prev.pos.slice();
      busy = true;
      card!.hidden = true;
      note!.hidden = true;
      render();
      for (const ev of events) {
        if (ev.type === 'roll') {
          trail = { seat: ev.seat, cells: [shown[ev.seat]] };
          drawTrail();
          void frame([CELLS[shown[ev.seat]], ...NEIGH[shown[ev.seat]].map((n) => CELLS[n])]);
          if (tray) await tray.roll([ev.die], speed());
          if (ev.bonus) {
            say(describe(ev, nameOf) ?? '');
            await sleep(600 / speed());
          }
          continue;
        }
        if (ev.type === 'step') {
          if (!trail || trail.seat !== ev.seat) trail = { seat: ev.seat, cells: [ev.from] };
          trail.cells.push(ev.to);
          void frame([CELLS[ev.to], ...NEIGH[ev.to].map((n) => CELLS[n])]);
          Sound.step();
          await glide(ev.seat, ev.to, 260 / speed(), 30);
          drawTrail();
          if (ev.last) Sound.place();
          continue;
        }
        if (ev.type === 'money') {
          panelRender();
          continue;
        }
        const d = dieOf(ev);
        if (d != null && tray) await tray.roll([d], speed() * (ev.type === 'shoot' || ev.type === 'attack' ? 1.6 : 1));
        if (ev.type === 'die') {
          // гибель: фишка возвращается в гостиницу
          say(describe(ev, nameOf) ?? '');
          Sound.nomove();
          await wait('die');
          shown[ev.seat] = view.pos[ev.seat];
          placePieces();
          continue;
        }
        if (ev.type === 'item' || ev.type === 'done' || ev.type === 'buy' || ev.type === 'sell') {
          sound(ev);
          panelRender();
          if (ev.type === 'buy' || ev.type === 'done') {
            say(describe(ev, nameOf) ?? '');
            await sleep(500 / speed());
          }
          continue;
        }
        const text = describe(ev, nameOf);
        if (!text) continue;
        sound(ev);
        if (ev.type === 'card') {
          const cc = CARDS.find((x) => x.n === ev.card)!;
          (card!.querySelector('.dj-card-t') as HTMLElement).textContent = cc.title;
          (card!.querySelector('.dj-card-s') as HTMLElement).textContent = cc.text;
          card!.hidden = false;
          note!.hidden = true;
          await wait('card');
          card!.hidden = true;
          continue;
        }
        if (ev.type === 'stop') {
          const st = STOPS[CELLS[ev.cell].kind as StopKind];
          say(`<b>${st?.name ?? ''}</b> — ${st?.text ?? ''}`);
        } else say(text);
        await wait(ev.type);
      }
      v = view;
      shown = view.pos.slice();
      busy = false;
      note!.hidden = true;
      if (view.phase !== 'move') trail = null;
      render();
      void frame();
    },
    setTurn(_toAct, interactive) {
      actSeat = v && !v.over && interactive.includes(v.turn) ? v.turn : null;
      if (actSeat != null) cam?.release();
      render();
      void frame();
    },
    status(view, toAct, interactive) {
      if (view.over) return 'Экспедиция окончена: считаем деньги, шкуры и снаряжение.';
      const seat = toAct[0];
      const me = interactive.includes(seat);
      const who = nameOf(seat);
      if (view.phase === 'buy') return me ? 'Сборы: купите предмет или закончите сборы.' : `${who} собирается в путь.`;
      if (view.phase === 'move') return me ? `Осталось шагов: ${view.left}. Развилка — выберите дорогу.` : `${who} идёт по ленте.`;
      if (view.phase === 'ask' && view.ask) {
        const what = { gift: 'Привал: что взять даром?', give: 'Карточка: что взять?', buy: 'Базар: что купить?', natives: 'Туземцы! Чем откупиться?', cross: 'Переправа: как переправляться?', beast: 'Зверь нападает: стрелять или уходить?' }[view.ask.kind];
        return me ? what : `${who}: ${what.toLowerCase()}`;
      }
      if (view.phase === 'shoot' && view.fight) return `${me ? 'Стреляйте' : `${who} стреляет`}: ${foeName(view.fight.foe)} — попаданий ${view.fight.hits} из ${view.fight.need}, в серии ${view.fight.shots}.`;
      if (view.wait[seat]) return me ? `Стоим, пока не выпадет ${view.wait[seat]}.` : `${who} ждёт «${view.wait[seat]}».`;
      return me ? 'Бросайте кубик — пробелом, тапом по полю или кнопкой.' : `Ходит ${who}…`;
    },
    playerStats(view, seat) {
      const w = bestWeapon(view, seat);
      const parts = [money(view.money[seat])];
      if (hasHorse(view, seat)) parts.push('🐎');
      if (w) parts.push(`🔫${seriesOf(view, seat)}`);
      if (view.skins[seat].length) parts.push(`шкур ${view.skins[seat].length}`);
      if (view.wait[seat]) parts.push(`⏳${view.wait[seat]}`);
      parts.push(`счёт ${money(scoreOf(view, seat))}`);
      return parts.join(' · ');
    },
    destroy() {
      cam?.destroy();
      wrap?.remove();
      panel?.remove();
      wrap = board = over = panel = note = card = stats = btns = null;
      gBoard = gTrail = gPieces = null;
      pieceEls.clear();
      at.clear();
      cam = null;
      v = null;
      shown = [];
      trail = null;
    },
  };
}

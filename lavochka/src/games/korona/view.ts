/**
 * «Корона Эмбера 1994» — вид: два поля под камерой сборника (Мир Приключений и Королевство Эмбер),
 * пуговицы-фишки с ходом по клеткам, маршруты броска, карточки приключений, кубики и звуки.
 *
 * Поле показывается то, где сейчас ход (или где идёт событие); кнопкой его можно переключить вручную.
 * Смена поля пересоздаёт окно камеры целиком: у BoardCam размеры поля задаются один раз.
 */
import './korona.css';
import { Sound } from '../../core/audio';
import { BoardCam, type CamPoint } from '../../core/boardcam';
import { DiceTray } from '../../core/dice';
import { esc, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from '../hodilki/core';
import { FIELD1, FIELD2, PLACES2, ROAD_BY_ID, cell, cellPx, sectorPx } from './data';
import type { KoronaView as KV } from './def';
import { kindOf, place2, routes, type Action, type Event, type Hero, type Zone } from './engine';
import { STATS, type Stat } from './rules';

type F = 1 | 2;
interface Pos {
  f: F;
  x: number;
  y: number;
}

const DIM: Record<F, { w: number; h: number; img: string; mini: string; r: number; name: string }> = {
  1: { w: Math.round(FIELD1.pt[0] * FIELD1.scale), h: Math.round(FIELD1.pt[1] * FIELD1.scale), img: '/korona/field1.webp', mini: '/korona/field1-small.webp', r: 95, name: 'Мир Приключений' },
  2: { w: 1743, h: 3567, img: '/korona/field2.webp', mini: '/korona/field2-small.webp', r: 40, name: 'Королевство Эмбер' },
};
void FIELD2;

/** Сколько держать событие, если за экраном не человек. */
const PACE = { card: 2600, zone: 1500, duel: 900 };

const nameOf = (s: number) => SEATS[s]?.name ?? String(s);
const color = (s: number) => SEATS[s]?.color ?? '#888';

/** Где стоит фишка героя по состоянию. */
function posOf(h: Hero): Pos {
  if (h.zone === 'world') {
    const p = h.sector != null ? sectorPx(h.cell, h.sector) : cellPx(h.cell);
    return { f: 1, x: p?.x ?? 0, y: p?.y ?? 0 };
  }
  const p = place2(h);
  return { f: 2, x: p.x, y: p.y };
}

/** Куда ставить фишку по событию смены места (точное место — в итоговом виде). */
function zonePos(z: Zone, h: Hero | undefined): Pos {
  if (h && h.zone === z) return posOf(h);
  if (z === 'world') return h ? posOf(h) : { f: 1, x: 0, y: 0 };
  if (z === 'road') return { f: 2, ...ROAD_BY_ID.get('fall')! };
  if (z === 'capital') return { f: 2, ...PLACES2.capital };
  if (z === 'labyrinth') return { f: 2, ...PLACES2.labyrinthIn };
  if (z === 'palace') return { f: 2, ...PLACES2.palace };
  return { f: 2, ...PLACES2.rooms[0] };
}

const svg = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

export function createView(): GameView<KV, Event> {
  let ctx: ViewCtx<Action> | null = null;
  let root: HTMLElement | null = null;
  let wrap: HTMLElement | null = null;
  let board: HTMLElement | null = null;
  let over: SVGSVGElement | null = null;
  let cam: BoardCam | null = null;
  let field: F = 1;
  /** игрок сам переключил поле — не дёргать его, пока не начнётся его ход */
  let pinned = false;
  let panel: HTMLElement | null = null;
  let stats: HTMLElement | null = null;
  let btns: HTMLElement | null = null;
  let hint: HTMLElement | null = null;
  let tray: DiceTray | null = null;
  let note: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  let v: KV | null = null;
  let actSeat: number | null = null;
  /** где фишки нарисованы сейчас (во время проигрыша событий — отстают от состояния) */
  const shown = new Map<number, Pos>();
  const pieceEl = new Map<number, SVGElement>();
  /** след последнего хода */
  let trail: { seat: number; f: F; pts: CamPoint[] } | null = null;
  let playing = false;

  // ---------- поле и камера ----------

  function buildField(f: F) {
    field = f;
    cam?.destroy();
    wrap?.remove();
    const d = DIM[f];
    wrap = document.createElement('div');
    wrap.className = 'kn-wrap';
    wrap.innerHTML =
      `<div class="kn-board"><img class="kn-map kn-map-mini" src="${d.mini}" alt="" draggable="false">` +
      `<img class="kn-map kn-map-full" src="${d.img}" alt="${d.name}" draggable="false"></div>`;
    root!.append(wrap);
    board = wrap.querySelector('.kn-board') as HTMLElement;
    over = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    over.setAttribute('class', 'kn-over');
    over.setAttribute('viewBox', `0 0 ${d.w} ${d.h}`);
    board.append(over);
    note = document.createElement('div');
    note.className = 'kn-note bc-ui';
    note.hidden = true;
    card = document.createElement('div');
    card.className = 'kn-card bc-ui';
    card.hidden = true;
    wrap.append(note, card);
    cam = new BoardCam(wrap, board, {
      w: d.w,
      h: d.h,
      mini: d.img,
      src: d.w,
      token: (d.r * 2) / d.w,
      followKey: 'korona.follow',
      demo: ctx!.demo,
      speed: () => ctx!.speed(),
      dots: () =>
        v
          ? v.seats
              .filter((s) => shown.get(s)?.f === field)
              .map((s) => ({ key: s, x: shown.get(s)!.x, y: shown.get(s)!.y, color: color(s), on: s === v!.turn }))
          : [],
      turn: turnPoints,
    });
    const full = wrap.querySelector('.kn-map-full') as HTMLImageElement;
    const ready = () => {
      board?.classList.add('ready');
      ctx?.hold?.(0);
      cam?.shown();
      frame();
    };
    if (full.complete && full.naturalWidth) ready();
    else full.addEventListener('load', ready, { once: true });
    render();
  }

  function turnPoints(): CamPoint[] {
    if (!v || v.winner != null) return [];
    const p = shown.get(v.turn);
    if (!p || p.f !== field) return [];
    const pts: CamPoint[] = [p];
    if (v.phase === 'pick' && actSeat === v.turn) for (const end of routes(v.heroes[v.turn].cell, v.die).keys()) pts.push(cellPx(end)!);
    return pts;
  }

  function frame() {
    if (!cam || !v) return;
    const others = v.seats.map((s) => shown.get(s)).filter((p): p is Pos => !!p && p.f === field);
    void cam.frame(turnPoints(), others);
  }

  // ---------- отрисовка ----------

  /** Смещения, чтобы фишки на одной клетке не накрывали друг друга. */
  function spread(): Map<number, { x: number; y: number }> {
    const out = new Map<number, { x: number; y: number }>();
    if (!v) return out;
    const groups = new Map<string, number[]>();
    for (const s of v.seats) {
      const p = shown.get(s);
      if (!p || p.f !== field) continue;
      const k = `${Math.round(p.x / 20)},${Math.round(p.y / 20)}`;
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    const gap = DIM[field].r * 1.15;
    for (const list of groups.values()) {
      list.forEach((s, i) => {
        const p = shown.get(s)!;
        const off = list.length > 1 ? (i - (list.length - 1) / 2) * gap : 0;
        out.set(s, { x: p.x + off, y: p.y });
      });
    }
    return out;
  }

  function render() {
    if (!over || !v) return;
    const st = v;
    const R = DIM[field].r;
    over.replaceChildren();
    pieceEl.clear();
    // след хода
    if (trail && trail.f === field && trail.pts.length > 1) {
      over.append(svg('polyline', { points: trail.pts.map((p) => `${p.x},${p.y}`).join(' '), class: 'kn-trail', stroke: color(trail.seat) }));
    }
    // маршруты броска: жёлтые кружки на конечных клетках, наведение рисует путь
    const me = actSeat;
    if (me != null && st.phase === 'pick' && field === 1 && st.heroes[me]?.zone === 'world' && !playing) {
      const from = cellPx(st.heroes[me].cell)!;
      const route = svg('polyline', { class: 'kn-route', points: '' });
      over.append(route);
      for (const [end, path] of routes(st.heroes[me].cell, st.die)) {
        const p = cellPx(end)!;
        const g = svg('circle', { cx: p.x, cy: p.y, r: R * 1.9, class: 'kn-move', 'data-to': end });
        const pts = [from, ...path.map((c) => cellPx(c)!)].map((q) => `${q.x},${q.y}`).join(' ');
        g.addEventListener('pointerenter', () => route.setAttribute('points', pts));
        g.addEventListener('pointerleave', () => route.setAttribute('points', ''));
        g.addEventListener('click', () => ctx?.act(me, { type: 'go', path }));
        over.append(g);
      }
    }
    // фишки
    const at = spread();
    for (const s of st.seats) {
      const p = at.get(s);
      if (!p) continue;
      const el = svg('image', {
        x: p.x - R, y: p.y - R, width: R * 2, height: R * 2,
        href: `/hodilki/buttons/${s}.webp`,
        class: 'kn-piece' + (s === st.turn && st.winner == null ? ' kn-on' : ''),
      });
      if (s === me && st.phase === 'pick' && field === 1 && !playing) takeable(el, s);
      pieceEl.set(s, el);
      over.append(el);
    }
    panelRender();
  }

  /** Пуговицу можно взять и отпустить на жёлтом кружке. */
  function takeable(el: SVGElement, seat: number) {
    el.classList.add('kn-take');
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const from = { x: e.clientX, y: e.clientY };
      const up = (ev: PointerEvent) => {
        document.removeEventListener('pointerup', up);
        if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 6 || !over || !v) return;
        const ctm = over.getScreenCTM();
        const p = ctm ? { x: (ev.clientX - ctm.e) / ctm.a, y: (ev.clientY - ctm.f) / ctm.d } : cam!.toImg(ev.clientX, ev.clientY);
        let best: number[] | null = null;
        let bd = Infinity;
        for (const [end, path] of routes(v.heroes[seat].cell, v.die)) {
          const q = cellPx(end)!;
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < bd) {
            bd = d;
            best = path;
          }
        }
        if (best && bd < 260) ctx?.act(seat, { type: 'go', path: best });
      };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* не все браузеры умеют — ловим на документе */
      }
      el.addEventListener('pointerup', up, { once: true });
      document.addEventListener('pointerup', up, { once: true });
    });
  }

  function heroLine(s: number, h: Hero): string {
    const where =
      h.zone === 'world'
        ? esc(h.sector != null ? `${cell(h.cell)?.name ?? ''}, сектор ${h.sector || '—'}` : (cell(h.cell)?.name ?? ''))
        : { road: 'дорога к столице', capital: 'столица Эмбера', labyrinth: `лабиринт, кольцо ${h.ring + 1}`, palace: 'дворец', chambers: `покои, клетка ${h.room + 1}` }[h.zone];
    const stl = STATS.map((k) => `<span class="${v && h.st[k] >= v.need ? 'kn-ok' : ''}">${k} ${h.st[k as Stat]}</span>`).join(' ');
    const body = h.prince ? `принц · <b>ПЖ ${h.pj}</b>` : `${stl} · ПЖ ${h.life} · ${h.thalers} т.`;
    return `<div class="kn-p${v && s === v.turn ? ' kn-p-on' : ''}"><b style="color:${color(s)}">${esc(v?.names[s] ?? nameOf(s))}</b> <i>${where}</i><br>${body}</div>`;
  }

  function panelRender() {
    if (!v || !stats || !btns || !hint) return;
    const st = v;
    // характеристики всех путников — в общей панели стола (playerStats), здесь — только ходящий
    stats.innerHTML = heroLine(st.turn, st.heroes[st.turn]) + `<div class="kn-need">Порог Провала: ${st.need} · в колоде ${st.deckLeft}</div>`;
    btns.replaceChildren();
    const sw = document.createElement('button');
    sw.className = 'btn small kn-switch';
    sw.textContent = field === 1 ? 'Показать: Королевство Эмбер' : 'Показать: Мир Приключений';
    sw.onclick = () => {
      pinned = true;
      buildField(field === 1 ? 2 : 1);
      frame();
    };
    const me = actSeat;
    if (me == null || playing || st.winner != null) {
      btns.append(sw);
      hint.textContent = st.winner != null ? '' : 'Ходят другие. Карта двигается мышью, колесом и кнопками «+» / «−».';
      return;
    }
    const h = st.heroes[me];
    const add = (text: string, action: Action, primary = false, tap = false) => {
      const b = document.createElement('button');
      b.className = 'btn' + (primary ? ' primary' : '');
      b.innerHTML = text;
      if (tap) b.dataset.tap = '';
      b.onclick = () => ctx?.act(me, action);
      btns!.append(b);
    };
    if (st.phase === 'card') {
      add('Дальше', { type: 'ok' }, true, true);
      hint.textContent = 'Прочитайте карточку и нажмите «Дальше».';
    } else if (st.phase === 'shop') {
      const low = [...STATS].sort((a, b) => h.st[a] - h.st[b])[0];
      const high = [...STATS].sort((a, b) => h.st[b] - h.st[a])[0];
      for (const k of STATS) if (h.thalers >= 5) add(`Купить 1 ${k} за 5 талеров`, { type: 'buyStat', stat: k });
      if (h.st[high] >= 2 && high !== low) add(`Обменять 2 ${high} на 1 ${low}`, { type: 'exchange', from: high, to: low });
      add('Дальше', { type: 'ok' }, true, true);
      hint.textContent = 'Обменный пункт: купите или обменяйте характеристики, затем «Дальше».';
    } else if (st.phase === 'pick') {
      hint.textContent = `Выпало ${st.die}. Жёлтые кружки — куда можно прийти (наведите — покажу маршрут). Нажмите кружок или перетащите пуговицу.`;
    } else if (st.phase === 'roll') {
      if (h.zone === 'capital') {
        if (h.thalers >= 20) add('Купить 1 ПЖ за 20 талеров', { type: 'buyPj' });
        for (const k of ['ПС', 'ПУ', 'ПМ'] as Stat[]) if (h.st[k] >= 5) add(`Обменять 5 ${k} на 1 ПЖ`, { type: 'exchangePj', from: k });
        add('Войти в лабиринт', { type: 'labyrinth' }, true, true);
        hint.textContent = 'Столица: вы принц. В лабиринт можно взять только ПЖ — деньги останутся здесь.';
      } else if (h.zone === 'palace') {
        for (const o of st.seats) if (o !== me && st.heroes[o].zone === 'chambers') add(`Вызвать на поединок: ${esc(st.names[o])} (ПЖ ${st.heroes[o].pj})`, { type: 'challenge', target: o });
        add('В дворцовые покои', { type: 'climb' }, true, true);
        hint.textContent = 'Дворец: идите в покои или вызовите на поединок принца, который уже там.';
      } else if (h.zone === 'chambers') {
        add(h.room >= 3 ? 'В тронный зал — коронация!' : 'Подняться выше', { type: 'climb' }, true, true);
        hint.textContent = 'Покои: по клетке за ход, до тронного зала.';
      } else {
        add(h.zone === 'labyrinth' ? 'Бросить кубик у ворот' : 'Бросить кубик', { type: 'roll' }, true, true);
        hint.textContent =
          h.zone === 'labyrinth' ? 'Ворота: 4–6 — налево, возьмёте ПЖ; 1–3 — направо, отдадите.'
          : h.zone === 'road' ? 'Дорога идёт по стрелкам сама: развилки — по чётному или нечётному броску.'
          : h.sector != null ? 'Вы бродите по секторам подполя: бросок ведёт по кругу, сектор 8 — выход.'
          : 'Бросьте кубик — кнопкой, пробелом или тапом по полю.';
      }
    }
    btns.append(sw);
  }

  // ---------- карточка и подпись ----------

  function cardHtml(c: { n: number | null; title: string; text: string; lines: string[] }, wait: boolean) {
    return (
      `<div class="kn-card-k">${c.n != null ? 'Карточка приключений' : 'Поле'}</div>` +
      `<div class="kn-card-t">${esc(c.title)}</div><div class="kn-card-s">${esc(c.text)}</div>` +
      (c.lines.length ? `<div class="kn-card-r">${c.lines.map((l) => `<span class="${/−/.test(l) ? 'kn-bad' : 'kn-good'}">${esc(l)}</span>`).join('')}</div>` : '') +
      (wait ? '<div class="kn-card-h">нажмите, чтобы продолжить</div>' : '')
    );
  }

  async function say(text: string, ms: number) {
    if (!note) return;
    note.innerHTML = text;
    note.hidden = false;
    await (ctx?.read ? ctx.read(ms) : sleep(ms / (ctx?.speed() ?? 1)));
    if (note) note.hidden = true;
  }

  // ---------- движение ----------

  /** Плавно перевести фишку в точку (на текущем поле). */
  function glide(seat: number, to: Pos, ms: number): Promise<void> {
    const from = shown.get(seat);
    shown.set(seat, to);
    if (!from || from.f !== to.f || to.f !== field) {
      render();
      return Promise.resolve();
    }
    // остальные фишки раздвигаются заранее, движущаяся едет поверх
    render();
    const el = pieceEl.get(seat);
    if (!el || !over) return Promise.resolve();
    over.append(el);
    const R = DIM[field].r;
    const end = { x: Number(el.getAttribute('x')) + R, y: Number(el.getAttribute('y')) + R };
    const t0 = performance.now();
    return new Promise((res) => {
      // в фоновой вкладке кадры не идут — страховка таймером, чтобы партия не вставала
      let fin = false;
      const finish = () => {
        if (fin) return;
        fin = true;
        el.setAttribute('x', String(end.x - R));
        el.setAttribute('y', String(end.y - R));
        res();
      };
      setTimeout(finish, ms + 80);
      const tick = (t: number) => {
        if (fin) return;
        const k = Math.min(1, (t - t0) / ms);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const hop = Math.sin(Math.PI * k) * R * 0.5;
        el.setAttribute('x', String(from.x + (end.x - from.x) * e - R));
        el.setAttribute('y', String(from.y + (end.y - from.y) * e - R - hop));
        if (k < 1) requestAnimationFrame(tick);
        else finish();
      };
      requestAnimationFrame(tick);
    });
  }

  function follow(p: Pos) {
    if (!pinned && p.f !== field) buildField(p.f);
    if (cam && p.f === field && v) void cam.frame([p], []);
  }

  return {
    mount(r, c) {
      ctx = c;
      root = r;
      c.hold?.(9000);
      panel = document.createElement('div');
      panel.className = 'kn-panel';
      panel.innerHTML = '<div class="kn-stats"></div><div class="kn-tray"></div><div class="kn-btns"></div><div class="hint small-hint kn-hint"></div>';
      c.controls.append(panel);
      stats = panel.querySelector('.kn-stats') as HTMLElement;
      btns = panel.querySelector('.kn-btns') as HTMLElement;
      hint = panel.querySelector('.kn-hint') as HTMLElement;
      tray = new DiceTray(panel.querySelector('.kn-tray') as HTMLElement, 2);
      tray.dice[1].wrap.hidden = true;
      buildField(1);
    },

    setView(view) {
      v = view;
      shown.clear();
      for (const s of view.seats) shown.set(s, posOf(view.heroes[s]));
      const mine = shown.get(view.turn);
      if (mine && !pinned && mine.f !== field) buildField(mine.f);
      else render();
    },

    async play(events, view) {
      const speed = Math.max(0.3, ctx?.speed?.() ?? 1);
      const stepMs = 300 / speed;
      playing = true;
      if (card) card.hidden = true;
      const prev = v;
      // промежуточный вид — прежний, но с новыми числами для панели
      v = { ...view, phase: prev?.phase === 'pick' ? 'roll' : view.phase };
      for (const ev of events) {
        if (!wrap) break;
        switch (ev.type) {
          case 'roll': {
            if (ev.dice) {
              tray!.dice[1].wrap.hidden = false;
              await tray!.roll(ev.dice, speed);
            } else {
              tray!.dice[1].wrap.hidden = true;
              await tray!.roll([ev.die], speed);
              const p = shown.get(ev.seat);
              trail = p ? { seat: ev.seat, f: p.f, pts: [p] } : null;
            }
            break;
          }
          case 'step': {
            const p = cellPx(ev.cell)!;
            const to: Pos = { f: 1, x: p.x, y: p.y };
            follow(to);
            if (trail && trail.seat === ev.seat && trail.f === 1) trail.pts.push(to);
            Sound.step();
            await glide(ev.seat, to, stepMs);
            break;
          }
          case 'sector': {
            const p = sectorPx(ev.cell, ev.sector);
            const to: Pos = { f: 1, x: p.x, y: p.y };
            follow(to);
            Sound.step();
            await glide(ev.seat, to, stepMs * 1.5);
            break;
          }
          case 'road': {
            const n = ROAD_BY_ID.get(ev.node)!;
            const to: Pos = { f: 2, x: n.x, y: n.y };
            follow(to);
            if (trail && trail.seat === ev.seat) {
              if (trail.f !== 2) trail = { seat: ev.seat, f: 2, pts: [shown.get(ev.seat) ?? to] };
              trail.pts.push(to);
            }
            Sound.step();
            await glide(ev.seat, to, stepMs);
            break;
          }
          case 'zone': {
            const to = zonePos(ev.zone, view.heroes[ev.seat]);
            follow(to);
            Sound.jump();
            await glide(ev.seat, to, stepMs * 2);
            await say(esc(ev.text), PACE.zone);
            break;
          }
          case 'card': {
            Sound.card();
            render();
            if (card) {
              card.innerHTML = cardHtml(ev.card, true);
              card.hidden = false;
              await (ctx?.read ? ctx.read(PACE.card) : sleep(PACE.card / speed));
              if (card) card.hidden = true;
            }
            break;
          }
          case 'stat':
          case 'life':
          case 'money':
          case 'pj':
            if (ev.delta < 0) Sound.nomove();
            break;
          case 'duel': {
            Sound.capture();
            await tray!.roll(ev.a, speed);
            await say(`Поединок: ${esc(nameOf(ev.seat))} ${ev.a[0]}+${ev.a[1]} против ${esc(nameOf(ev.target))} ${ev.b[0]}+${ev.b[1]}`, PACE.duel);
            break;
          }
          case 'skip':
            await say(`${esc(view.names[ev.seat] ?? nameOf(ev.seat))} пропускает ход`, 900);
            break;
          case 'over':
            Sound.win();
            break;
          case 'turn':
            break;
        }
      }
      playing = false;
      v = view;
      for (const s of view.seats) shown.set(s, posOf(view.heroes[s]));
      const mine = shown.get(view.turn);
      if (mine && !pinned && mine.f !== field) buildField(mine.f);
      else render();
      frame();
    },

    setTurn(_toAct, interactive) {
      const was = actSeat;
      actSeat = v && v.winner == null && interactive.includes(v.turn) ? v.turn : null;
      if (actSeat != null && was == null) {
        // начался свой ход: показываем своё поле, камера снова ведёт
        pinned = false;
        const p = shown.get(actSeat);
        if (p && p.f !== field) buildField(p.f);
        cam?.release();
      }
      render();
      // своя карточка ждёт «Дальше» — показываем её поверх поля, нажатие по ней = «Дальше»
      if (card && v && actSeat != null && v.phase === 'card' && v.card) {
        card.innerHTML = cardHtml(v.card, true);
        card.hidden = false;
        const me = actSeat;
        card.onpointerdown = () => {
          card!.hidden = true;
          ctx?.act(me, { type: 'ok' });
        };
      } else if (card) {
        card.hidden = true;
        card.onpointerdown = null;
      }
      frame();
    },

    status(view, _toAct, interactive) {
      if (view.winner != null) return `${view.names[view.winner]} — Владыка Королевства Эмбер`;
      const h = view.heroes[view.turn];
      const who = interactive.includes(view.turn) ? 'Ваш ход' : `Ходит ${view.names[view.turn]}`;
      if (view.phase === 'pick') return `${who}: выпало ${view.die}, выбирайте, куда идти`;
      if (view.phase === 'card') return `${who}: карточка`;
      if (view.phase === 'shop') return `${who}: обменный пункт`;
      const z = { world: kindOf(h.cell) === 'door' || h.sector != null ? 'подполе' : 'Мир Приключений', road: 'дорога к столице', capital: 'столица', labyrinth: 'лабиринт', palace: 'дворец', chambers: 'покои' }[h.zone];
      return `${who} (${z})`;
    },

    playerStats(view, s) {
      const h = view.heroes[s];
      if (!h) return '';
      if (h.prince) return `Принц · ПЖ ${h.pj}`;
      return `${STATS.map((k) => (h.st[k] >= view.need ? `<b>${k} ${h.st[k as Stat]}</b>` : `${k} ${h.st[k as Stat]}`)).join(' · ')} · ПЖ ${h.life} · ${h.thalers} т.`;
    },

    destroy() {
      cam?.destroy();
      wrap?.remove();
      panel?.remove();
      cam = null;
      wrap = board = over = panel = note = card = stats = btns = hint = null;
      v = null;
      shown.clear();
      pieceEl.clear();
    },
  };
}

export default createView;

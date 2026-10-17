/**
 * «Магия» — вид: склеенное поле под камерой сборника, фишки-портреты героев, маршруты броска, туннели и голубая линия,
 * талисманы из оригинального листа (защиты, власти, «Маг»), кубик и звуки.
 */
import './magiya.css';
import { Sound } from '../../core/audio';
import { BoardCam, type CamPoint } from '../../core/boardcam';
import { DiceTray } from '../../core/dice';
import { esc, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { CELLS, FIELD, LINES, POWERS, SPIRITS, WEBS, heroOf, powerOf, spiritOf, type Power, type Spirit } from './data';
import type { MagiyaView as V } from './def';
import { moves, qualified, type Action, type Event, type Hero } from './engine';

const R = 56;
const IMG = '/magic/';
const SEAT_COLORS = ['#2c6fd1', '#c0392b', '#5b4636', '#2f9e5f', '#c9a227', '#8e44ad'];
const color = (s: number) => SEAT_COLORS[s % SEAT_COLORS.length];
const pt = (c: number): CamPoint => ({ x: CELLS[c].x, y: CELLS[c].y });

const svg = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

const protImg = (s: Spirit) => `${IMG}prot-${s}.webp`;
const powerImg = (p: Power) => `${IMG}power-${p}.webp`;

export function createView(): GameView<V, Event> {
  let ctx: ViewCtx<Action> | null = null;
  let wrap: HTMLElement | null = null;
  let board: HTMLElement | null = null;
  let over: SVGSVGElement | null = null;
  let cam: BoardCam | null = null;
  let panel: HTMLElement | null = null;
  let me: HTMLElement | null = null;
  let btns: HTMLElement | null = null;
  let hint: HTMLElement | null = null;
  let tray: DiceTray | null = null;
  let note: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  let v: V | null = null;
  let actSeat: number | null = null;
  let playing = false;
  /** где фишки нарисованы сейчас (во время проигрыша событий отстают от состояния) */
  const shown = new Map<number, number>();
  const pieceEl = new Map<number, SVGElement>();
  let trail: { seat: number; pts: CamPoint[] } | null = null;

  // ---------- поле ----------

  function build(root: HTMLElement) {
    wrap = document.createElement('div');
    wrap.className = 'mg-wrap';
    wrap.innerHTML =
      `<div class="mg-board"><img class="mg-map mg-map-mini" src="${IMG}field-small.webp" alt="" draggable="false">` +
      `<img class="mg-map mg-map-full" src="${IMG}field.webp" alt="Поле «Магия»" draggable="false"></div>`;
    root.append(wrap);
    board = wrap.querySelector('.mg-board') as HTMLElement;
    over = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    over.setAttribute('class', 'mg-over');
    over.setAttribute('viewBox', `0 0 ${FIELD.w} ${FIELD.h}`);
    board.append(over);
    note = document.createElement('div');
    note.className = 'mg-note bc-ui';
    note.hidden = true;
    card = document.createElement('div');
    card.className = 'mg-card bc-ui';
    card.hidden = true;
    wrap.append(note, card);
    cam = new BoardCam(wrap, board, {
      w: FIELD.w,
      h: FIELD.h,
      mini: `${IMG}field.webp`,
      src: FIELD.w,
      token: (R * 2) / FIELD.w,
      followKey: 'magiya.follow',
      demo: ctx!.demo,
      speed: () => ctx!.speed(),
      dots: () => (v ? v.seats.filter((s) => shown.has(s)).map((s) => ({ key: s, ...pt(shown.get(s)!), color: color(s), on: s === v!.turn })) : []),
      turn: turnPoints,
    });
    const full = wrap.querySelector('.mg-map-full') as HTMLImageElement;
    const ready = () => {
      board?.classList.add('ready');
      ctx?.hold?.(0);
      cam?.shown();
      frame();
    };
    if (full.complete && full.naturalWidth) ready();
    else full.addEventListener('load', ready, { once: true });
  }

  /** Куда можно пойти/перейти сейчас (для своего хода). */
  function targets(): number[] {
    if (!v || actSeat == null || playing) return [];
    const h = v.heroes[actSeat];
    if (v.phase === 'move' && v.die != null) return [...moves(v, actSeat, v.die).keys()];
    if (v.phase === 'tunnel') return WEBS.filter((w) => w !== h.cell);
    if (v.phase === 'line' && v.line) return LINES[v.line];
    return [];
  }

  function turnPoints(): CamPoint[] {
    if (!v || v.over) return [];
    const c = shown.get(v.turn);
    if (c == null) return [];
    return [pt(c), ...(v.phase === 'move' ? targets().map(pt) : [])];
  }

  function frame() {
    if (!cam || !v) return;
    const others = v.seats.filter((s) => s !== v!.turn && shown.has(s)).map((s) => pt(shown.get(s)!));
    void cam.frame(turnPoints(), others);
  }

  /** Смещения фишек на одной клетке. */
  function spread(): Map<number, CamPoint> {
    const out = new Map<number, CamPoint>();
    if (!v) return out;
    const groups = new Map<number, number[]>();
    for (const s of v.seats) {
      const c = shown.get(s);
      if (c == null) continue;
      groups.set(c, [...(groups.get(c) ?? []), s]);
    }
    for (const [c, list] of groups) {
      const p = pt(c);
      list.forEach((s, i) => {
        const n = list.length;
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const r = n > 1 ? rad() * 0.75 : 0;
        out.set(s, { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r });
      });
    }
    return out;
  }

  /** Радиус фишки: в показе правил камера стоит на всём поле — фишки крупнее, чтобы их было видно. */
  const rad = () => (ctx?.demo ? R * 2.3 : R);

  function piece(s: number, p: CamPoint, hero: string): SVGElement {
    const r = rad();
    const g = svg('g', { class: 'mg-piece' + (v && s === v.turn && !v.over ? ' mg-on' : ''), transform: `translate(${p.x},${p.y})` });
    g.append(svg('circle', { r: r + r / 8, fill: color(s), class: 'mg-ring' }));
    g.append(svg('image', { x: -r, y: -r, width: r * 2, height: r * 2, href: `${IMG}port-${hero}.webp` }));
    return g;
  }

  function render() {
    if (!over || !v) return;
    const st = v;
    over.replaceChildren();
    pieceEl.clear();
    if (trail && trail.pts.length > 1) {
      over.append(svg('polyline', { points: trail.pts.map((p) => `${p.x},${p.y}`).join(' '), class: 'mg-trail', stroke: color(trail.seat) }));
    }
    const mine = actSeat;
    if (mine != null && !playing) {
      const route = svg('polyline', { class: 'mg-route', points: '' });
      over.append(route);
      const from = pt(st.heroes[mine].cell);
      const paths = st.phase === 'move' && st.die != null ? moves(st, mine, st.die) : null;
      for (const t of targets()) {
        const p = pt(t);
        const g = svg('circle', { cx: p.x, cy: p.y, r: R * 1.35, class: 'mg-move' + (st.phase === 'move' ? '' : ' mg-jump') });
        const path = paths?.get(t);
        if (path) {
          const pts = [from, ...path.map(pt)].map((q) => `${q.x},${q.y}`).join(' ');
          g.addEventListener('pointerenter', () => route.setAttribute('points', pts));
          g.addEventListener('pointerleave', () => route.setAttribute('points', ''));
        }
        g.addEventListener('click', () => {
          const a: Action = st.phase === 'move' ? { type: 'go', to: t } : st.phase === 'tunnel' ? { type: 'tunnel', to: t } : { type: 'line', to: t };
          ctx?.act(mine, a);
        });
        over.append(g);
      }
    }
    const at = spread();
    for (const s of st.seats) {
      const p = at.get(s);
      if (!p) continue;
      const el = piece(s, p, st.heroes[s].hero);
      pieceEl.set(s, el);
      over.append(el);
    }
    panelRender();
    pickRender();
  }

  // ---------- панель ----------

  function heroHtml(s: number, h: Hero): string {
    const o = v!.opts;
    const prot = SPIRITS.map((x) => `<img class="mg-t${h.prot.includes(x.id) ? '' : ' mg-off'}" src="${protImg(x.id)}" alt="" title="Против ${esc(x.of)}">`).join('');
    const pow = POWERS.map((x) => `<img class="mg-t${h.power.includes(x.id) ? '' : ' mg-off'}" src="${powerImg(x.id)}" alt="" title="${esc(x.name)}">`).join('');
    const where = CELLS[h.cell].region === 'bsq' ? ' · в «чёрном квадрате»' : h.skip ? ` · пропуск ${h.skip}` : '';
    return (
      `<div class="mg-me-top"><img class="mg-fig" src="${IMG}hero-${h.hero}.webp" alt="">` +
      `<div><b style="color:${color(s)}">${esc(v!.names[s])}</b> <i>${esc(heroOf(h.hero).name)}</i>${where}` +
      `<div class="mg-tri"><img src="${IMG}tri.webp" alt="△"> <b>${h.tri}</b>` +
      (h.portrait ? `<img class="mg-port" src="${IMG}port-${h.hero}.webp" alt="" title="Талисман-портрет: уберечься один раз">` : '') +
      (h.mag != null ? `<img class="mg-magc" src="${IMG}mag.webp" alt="Маг">` : '') +
      `</div><div class="mg-need">защита ${h.prot.length}/${o.need} · власть ${h.power.length}/${o.needPower}` +
      `${qualified(h, o) ? ' · <b>к пирамиде!</b>' : ''}</div></div></div>` +
      `<div class="mg-ts">${prot}</div><div class="mg-ts mg-ts-p">${pow}</div>`
    );
  }

  function panelRender() {
    if (!v || !me || !btns || !hint) return;
    const st = v;
    const showSeat = actSeat ?? st.turn;
    me.innerHTML = heroHtml(showSeat, st.heroes[showSeat]);
    btns.replaceChildren();
    const s = actSeat;
    if (s == null || playing || st.over) {
      hint.textContent = st.over ? '' : 'Ходят другие. Поле двигается мышью, колесом и кнопками «+» / «−».';
      return;
    }
    const add = (text: string, a: Action, primary = false, tap = false) => {
      const b = document.createElement('button');
      b.className = 'btn' + (primary ? ' primary' : '');
      b.innerHTML = text;
      if (tap) b.dataset.tap = '';
      b.onclick = () => ctx?.act(s, a);
      btns!.append(b);
    };
    const h = st.heroes[s];
    if (st.phase === 'roll') {
      add('Бросить кубик', { type: 'roll' }, true, true);
      hint.textContent = CELLS[h.cell].region === 'bsq' ? '«Чёрный квадрат»: идёте против часовой стрелки до туннеля.' : 'Бросьте кубик — кнопкой, пробелом или тапом по полю.';
    } else if (st.phase === 'move') {
      hint.textContent = `Выпало ${st.die}. Жёлтые круги — куда можно прийти (наведите — покажу путь).`;
    } else if (st.phase === 'tunnel') {
      if (!st.mustTunnel) add('Остаться здесь', { type: 'tunnel', to: null });
      hint.textContent = st.mustTunnel ? 'Выход из «чёрного квадрата»: выберите туннель на поле.' : 'Пространственный туннель: можно уйти на любой другой туннель (круги) или остаться.';
    } else if (st.phase === 'line') {
      add('Остаться здесь', { type: 'line', to: null });
      hint.textContent = 'Синий кружок: поставьте фишку на любую клетку голубой линии (круги) — её знак сработает.';
    } else if (st.phase === 'take') {
      hint.textContent = '«Т»: выберите талисман защиты.';
    } else if (st.phase === 'lose') {
      hint.textContent = 'Череп: отдайте один талисман защиты.';
    }
  }

  /** Выбор талисмана (на «Т» и на черепе) — картинками поверх поля. */
  function pickRender() {
    if (!card || !v) return;
    const s = actSeat;
    if (s == null || playing || (v.phase !== 'take' && v.phase !== 'lose')) {
      if (card.dataset.pick) {
        card.hidden = true;
        delete card.dataset.pick;
      }
      return;
    }
    const h = v.heroes[s];
    const take = v.phase === 'take';
    const list = take ? SPIRITS.filter((x) => !h.prot.includes(x.id)) : SPIRITS.filter((x) => h.prot.includes(x.id));
    card.dataset.pick = '1';
    card.onpointerdown = null;
    card.innerHTML =
      `<div class="mg-card-k">${take ? 'Клетка «Т»' : 'Конверт с черепом'}</div>` +
      `<div class="mg-card-t">${take ? 'Возьмите талисман защиты' : 'Отдайте талисман защиты'}</div>` +
      `<div class="mg-pick">${list.map((x) => `<button class="mg-pick-b" data-sp="${x.id}"><img src="${protImg(x.id)}" alt=""><span>${esc(x.name)}</span></button>`).join('')}` +
      (!take && h.portrait ? `<button class="mg-pick-b" data-sp=""><img class="mg-pick-port" src="${IMG}port-${h.hero}.webp" alt=""><span>уберечься портретом</span></button>` : '') +
      `</div>`;
    card.hidden = false;
    card.querySelectorAll<HTMLButtonElement>('.mg-pick-b').forEach((b) => {
      b.onclick = () => {
        const sp = (b.dataset.sp || null) as Spirit | null;
        ctx?.act(s, take ? { type: 'take', spirit: sp as Spirit } : { type: 'lose', spirit: sp });
      };
    });
  }

  // ---------- проигрыш событий ----------

  async function say(text: string, ms: number) {
    if (!note) return;
    note.innerHTML = text;
    note.hidden = false;
    await sleep(ms / Math.max(0.3, ctx?.speed() ?? 1));
    if (note) note.hidden = true;
  }

  /** Карточка талисмана посреди поля. */
  async function showCard(kind: string, title: string, img: string, ms: number) {
    if (!card) return;
    delete card.dataset.pick;
    card.innerHTML = `<div class="mg-card-k">${esc(kind)}</div><img class="mg-card-img" src="${img}" alt=""><div class="mg-card-t">${esc(title)}</div>`;
    card.hidden = false;
    Sound.card();
    await (ctx?.read ? ctx.read(ms) : sleep(ms / Math.max(0.3, ctx?.speed() ?? 1)));
    if (card) card.hidden = true;
  }

  function glide(seat: number, to: number, ms: number): Promise<void> {
    const from = shown.get(seat);
    shown.set(seat, to);
    render();
    const el = pieceEl.get(seat);
    if (from == null || !el || !over) return Promise.resolve();
    over.append(el);
    const a = pt(from);
    const b = spread().get(seat) ?? pt(to);
    const t0 = performance.now();
    return new Promise((res) => {
      let fin = false;
      const finish = () => {
        if (fin) return;
        fin = true;
        el.setAttribute('transform', `translate(${b.x},${b.y})`);
        res();
      };
      setTimeout(finish, ms + 80);
      const tick = (t: number) => {
        if (fin) return;
        const k = Math.min(1, (t - t0) / ms);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const hop = Math.sin(Math.PI * k) * rad() * 0.6;
        el.setAttribute('transform', `translate(${a.x + (b.x - a.x) * e},${a.y + (b.y - a.y) * e - hop})`);
        if (k < 1) requestAnimationFrame(tick);
        else finish();
      };
      requestAnimationFrame(tick);
    });
  }

  function follow(c: number) {
    if (cam && v) void cam.frame([pt(c)], []);
  }

  return {
    mount(root, c) {
      ctx = c;
      c.hold?.(9000);
      panel = document.createElement('div');
      panel.className = 'mg-panel';
      panel.innerHTML = '<div class="mg-me"></div><div class="mg-tray"></div><div class="mg-btns"></div><div class="hint small-hint mg-hint"></div>';
      c.controls.append(panel);
      me = panel.querySelector('.mg-me') as HTMLElement;
      btns = panel.querySelector('.mg-btns') as HTMLElement;
      hint = panel.querySelector('.mg-hint') as HTMLElement;
      tray = new DiceTray(panel.querySelector('.mg-tray') as HTMLElement, 1);
      build(root);
    },

    setView(view) {
      v = view;
      shown.clear();
      for (const s of view.seats) shown.set(s, view.heroes[s].cell);
      render();
    },

    async play(events, view) {
      const speed = Math.max(0.3, ctx?.speed?.() ?? 1);
      const stepMs = 280 / speed;
      playing = true;
      if (card) {
        card.hidden = true;
        delete card.dataset.pick;
      }
      // промежуточный вид — новые числа для панели, фишки едут по событиям
      v = { ...view, phase: 'roll' };
      render();
      for (const ev of events) {
        if (!wrap) break;
        switch (ev.type) {
          case 'roll': {
            await tray!.roll([ev.die], speed);
            const c = shown.get(ev.seat);
            trail = c != null ? { seat: ev.seat, pts: [pt(c)] } : null;
            break;
          }
          case 'step':
            follow(ev.cell);
            if (trail && trail.seat === ev.seat) trail.pts.push(pt(ev.cell));
            Sound.step();
            await glide(ev.seat, ev.cell, stepMs);
            break;
          case 'jump':
            trail = null;
            follow(ev.cell);
            Sound.jump();
            await glide(ev.seat, ev.cell, stepMs * 2.5);
            break;
          case 'tri':
            if (ev.delta < 0) Sound.nomove();
            else Sound.place();
            await say(`${esc(view.names[ev.seat])}: ${ev.delta > 0 ? '+' : '−'}${Math.abs(ev.delta)} <img class="mg-note-tri" src="${IMG}tri.webp" alt="△">`, 700);
            break;
          case 'prot': {
            const sp = spiritOf(ev.spirit);
            if (ev.gain) await showCard('Талисман защиты', `${view.names[ev.seat]}: против ${sp.of}`, protImg(ev.spirit), 1800);
            else {
              Sound.capture();
              await say(`${esc(view.names[ev.seat])} теряет талисман против ${esc(sp.of)}`, 1300);
            }
            break;
          }
          case 'power':
            await showCard('Талисман власти', `${view.names[ev.seat]}: «${powerOf(ev.power).name}»`, powerImg(ev.power), 1800);
            break;
          case 'portrait':
            Sound.home();
            await say(`${esc(view.names[ev.seat])}: ${esc(ev.text)}`, 1500);
            break;
          case 'skip':
            Sound.nomove();
            await say(`${esc(view.names[ev.seat])}: нечем отдать — пропуск ${ev.n} ${ev.n === 1 ? 'хода' : 'ходов'}`, 1300);
            break;
          case 'skipped':
            await say(`${esc(view.names[ev.seat])} пропускает ход`, 800);
            break;
          case 'extra':
            Sound.turn();
            await say(`${esc(view.names[ev.seat])} на своём портрете — ещё бросок!`, 1100);
            break;
          case 'say':
            if (ev.bad) Sound.capture();
            await say(`${esc(view.names[ev.seat])}: ${esc(ev.text)}`, 1300);
            break;
          case 'mag':
            Sound.win();
            await showCard('Посвящение в Магию', `${view.names[ev.seat]} — Маг!`, `${IMG}mag.webp`, 2600);
            break;
          case 'over':
          case 'turn':
            break;
        }
      }
      playing = false;
      v = view;
      for (const s of view.seats) shown.set(s, view.heroes[s].cell);
      render();
      frame();
    },

    setTurn(_toAct, interactive) {
      const was = actSeat;
      actSeat = v && !v.over && interactive.includes(v.turn) ? v.turn : null;
      if (actSeat != null && was == null) cam?.release();
      render();
      frame();
    },

    status(view, _toAct, interactive) {
      if (view.over) return view.over.text;
      const who = interactive.includes(view.turn) ? 'Ваш ход' : `Ходит ${view.names[view.turn]}`;
      switch (view.phase) {
        case 'move':
          return `${who}: выпало ${view.die} — переставьте фишку на подсвеченную клетку`;
        case 'tunnel':
          return `${who}: пространственный туннель`;
        case 'line':
          return `${who}: голубая линия`;
        case 'take':
          return `${who}: талисман защиты на выбор`;
        case 'lose':
          return `${who}: череп — отдать талисман защиты`;
        default:
          return CELLS[view.heroes[view.turn].cell].region === 'bsq' ? `${who}: «чёрный квадрат»` : `${who}: бросайте кубик`;
      }
    },

    playerStats(view, s) {
      const h = view.heroes[s];
      if (!h) return '';
      if (h.mag != null) return `<b>Маг</b>${h.mag > 1 ? ` (${h.mag}-й)` : ''}`;
      return `△ ${h.tri} · защита ${h.prot.length}/${view.opts.need} · власть ${h.power.length}/${view.opts.needPower}`;
    },

    destroy() {
      cam?.destroy();
      wrap?.remove();
      panel?.remove();
      cam = null;
      wrap = board = over = panel = note = card = me = btns = hint = null;
      v = null;
      shown.clear();
      pieceEl.clear();
    },
  };
}

export default createView;

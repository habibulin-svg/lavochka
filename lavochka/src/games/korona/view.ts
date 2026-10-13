/**
 * «Корона Эмбера 1994» — вид: камера на поле 1 с переключателем на поле 2, пуговицы-фишки,
 * панель характеристик, карточки приключений с ожиданием игрока и перетаскивание фишки.
 *
 * Образец — вид «Джио-Джанги» (`src/games/djio/view.ts`): та же схема монтирования
 * (доска с крошечной и полной картинкой, SVG-слой поверх, BoardCam), те же события.
 */
import './korona.css';
import { BoardCam } from '../../core/boardcam';
import { sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from '../hodilki/core';
import { FIELD1, FIELD2, cellPx, cell } from './data';
import type { Event, State } from './engine';
import { STATS, type Stat } from './rules';
import type { KoronaView as KV } from './def';

const PIECE_R = 34;
const W = Math.round(FIELD1.pt[0] * FIELD1.scale);
const H = Math.round(FIELD1.pt[1] * FIELD1.scale);
const W2 = Math.round(FIELD2.pt[0] * FIELD2.scale);
const H2 = Math.round(FIELD2.pt[1] * FIELD2.scale);

/** Позиции зон поля 2 (из field2.json) — куда ставить фишку в Эмбере. */
const ZONE_XY: Record<string, [number, number]> = {
  capital: [W2 * 0.5, H2 * 0.93],
  labyrinth: [W2 * 0.47, H2 * 0.52],
  palace: [W2 * 0.22, H2 * 0.72],
  chambers: [W2 * 0.22, H2 * 0.62],
  throne: [W2 * 0.5, H2 * 0.1],
  arena: [W2 * 0.6, H2 * 0.3],
};

const svg = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

class View implements GameView<KV, Event> {
  private wrap: HTMLElement | null = null;
  private board: HTMLElement | null = null;
  private over: SVGSVGElement | null = null;
  private btns: HTMLElement | null = null;
  private stats: HTMLElement | null = null;
  private note: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private cam: BoardCam | null = null;
  private ctx: ViewCtx | null = null;
  private v: KV | null = null;
  private actSeat: number | null = null;
  private ember = false;

  mount(root: HTMLElement, c: ViewCtx) {
    this.ctx = c;
    const wrap = document.createElement('div');
    wrap.className = 'kn-wrap';
    wrap.innerHTML =
      '<div class="kn-board"><img class="kn-map kn-map-mini" src="/korona/field1-small.webp" alt="" draggable="false">' +
      '<img class="kn-map kn-map-full" src="/korona/field1.webp" alt="Мир Приключений" draggable="false"></div>' +
      '<div class="kn-side">' +
      '<div class="kn-stats"></div>' +
      '<div class="kn-btns"></div>' +
      '<div class="kn-note"></div>' +
      '<div class="kn-card bc-ui" hidden></div>' +
      '</div>';
    root.append(wrap);
    this.wrap = wrap;
    this.board = wrap.querySelector('.kn-board') as HTMLElement;
    const over = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    over.setAttribute('class', 'kn-over');
    over.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.board.append(over);
    this.over = over;
    this.btns = wrap.querySelector('.kn-btns') as HTMLElement;
    this.stats = wrap.querySelector('.kn-stats') as HTMLElement;
    this.note = wrap.querySelector('.kn-note') as HTMLElement;
    this.card = wrap.querySelector('.kn-card') as HTMLElement;
    this.cam = new BoardCam(wrap, this.board, {
      w: W,
      h: H,
      mini: '/korona/field1.webp',
      src: W,
      token: (PIECE_R * 2) / W,
      followKey: 'korona.follow',
      demo: c.demo,
      speed: () => this.ctx!.speed(),
      dots: () =>
        this.v
          ? this.v.seats
              .filter((s) => !this.v!.heroes[s]?.ember)
              .map((s) => {
                const p = cellPx(this.v!.heroes[s].cell);
                return { key: s, x: p?.x ?? 0, y: p?.y ?? 0, color: SEATS[s]?.color ?? '#888', on: s === this.v!.turn };
              })
          : [],
      turn: () => (this.actSeat != null && this.v && !this.v.heroes[this.actSeat]?.ember ? [cellPx(this.v.heroes[this.actSeat].cell) ?? { x: 0, y: 0 }] : []),
    });
    const full = wrap.querySelector('.kn-map-full') as HTMLImageElement;
    const ready = () => this.board?.classList.add('ready');
    if (full.complete) ready();
    else full.addEventListener('load', ready, { once: true });
    c.hold?.(9000);
    this.render();
  }

  private render() {
    if (!this.over || !this.v || !this.btns || !this.stats || !this.note) return;
    const v = this.v;
    const over = this.over;
    over.replaceChildren();
    // фишки: в Эмбере — по зонам поля 2, иначе по клеткам поля 1
    const onField2 = this.ember;
    const off = new Map<number, number>();
    for (const s of v.seats) {
      const h = v.heroes[s];
      if (!h) continue;
      const inEmber = !!h.ember;
      if (inEmber !== onField2) continue;
      let x: number;
      let y: number;
      if (inEmber) {
        const z = ZONE_XY[h.zone] ?? [W2 / 2, H2 / 2];
        x = (z[0] / W2) * W;
        y = (z[1] / H2) * H;
      } else {
        const p = cellPx(h.cell);
        if (!p) continue;
        const k = off.get(h.cell) ?? 0;
        off.set(h.cell, k + 1);
        x = p.x + k * 46;
        y = p.y;
      }
      const el = svg('image', {
        x: x - PIECE_R,
        y: y - PIECE_R,
        width: PIECE_R * 2,
        height: PIECE_R * 2,
        href: `/hodilki/buttons/${s}.webp`,
        class: s === this.actSeat ? 'kn-piece kn-take' : 'kn-piece',
      });
      if (s === this.actSeat && v.phase === 'step' && v.left > 0) this.takeable(el as SVGImageElement, s);
      over.append(el);
    }
    // кружки шага
    if (v.phase === 'step' && v.left > 0 && this.actSeat != null && !v.heroes[this.actSeat]?.ember) {
      for (const to of v.targets) {
        const p = cellPx(to);
        if (!p) continue;
        const g = svg('circle', { cx: p.x, cy: p.y, r: 30, class: 'kn-move', 'data-to': to });
        g.addEventListener('click', () => this.ctx?.act(this.actSeat!, { type: 'step', to }));
        over.append(g);
      }
    }
    // панель
    this.btns.replaceChildren();
    const b = (label: string, fn: () => void, tap = false) => {
      const el = document.createElement('button');
      el.className = 'btn kn-btn';
      el.textContent = label;
      if (tap) el.setAttribute('data-tap', '');
      el.addEventListener('click', fn);
      this.btns!.append(el);
    };
    if (this.actSeat != null) {
      const h = v.heroes[this.actSeat];
      if (h?.ember) {
        if (!h.prince) b('Стать принцем', () => this.ctx?.act(this.actSeat!, { type: 'prince' }), true);
        else if (h.zone === 'capital') {
          b('В лабиринт', () => this.ctx?.act(this.actSeat!, { type: 'labyrinth' }), true);
          b('Купить ПЖ (20 талеров)', () => this.ctx?.act(this.actSeat!, { type: 'buyPj' }));
        } else if (h.zone === 'labyrinth') b('Бросок у ворот', () => this.ctx?.act(this.actSeat!, { type: 'ringRoll' }), true);
        else if (h.zone === 'palace') {
          b('В покои', () => this.ctx?.act(this.actSeat!, { type: 'toChambers' }));
          b('На арену', () => this.ctx?.act(this.actSeat!, { type: 'toArena' }));
          b('В тронный зал', () => this.ctx?.act(this.actSeat!, { type: 'toThrone' }));
        } else if (h.zone === 'throne') b('Коронация', () => this.ctx?.act(this.actSeat!, { type: 'coronate' }), true);
      } else if (v.phase === 'roll') b('Бросить кубик', () => this.ctx?.act(this.actSeat!, { type: 'roll' }), true);
      else if (v.phase === 'card') b('Дальше', () => this.ctx?.act(this.actSeat!, { type: 'ok' }), true);
    }
    const btn2 = document.createElement('button');
    btn2.className = 'btn kn-btn kn-switch';
    btn2.textContent = onField2 ? 'Показать Мир Приключений' : 'Показать Королевство Эмбер';
    btn2.addEventListener('click', () => {
      this.ember = !this.ember;
      const full = this.wrap?.querySelector('.kn-map-full') as HTMLImageElement | null;
      const mini = this.wrap?.querySelector('.kn-map-mini') as HTMLImageElement | null;
      if (full && mini) {
        full.src = this.ember ? '/korona/field2.webp' : '/korona/field1.webp';
        mini.src = this.ember ? '/korona/field2-small.webp' : '/korona/field1-small.webp';
      }
      this.over?.setAttribute('viewBox', `0 0 ${this.ember ? W2 : W} ${this.ember ? H2 : H}`);
      this.render();
    });
    this.btns.append(btn2);
    // сводка и подсказка
    this.stats.innerHTML = v.seats
      .map((s) => {
        const h = v.heroes[s];
        if (!h) return '';
        const st = STATS.map((k) => `${k} ${h.st[k as Stat]}`).join(' · ');
        return `<div class="kn-p"><b style="color:${SEATS[s]?.color ?? '#888'}">${v.names[s] ?? 'Игрок ' + s}</b> ${h.ember ? `принц, ПЖ ${h.pj}` : `${st} · ПЖ ${h.life} · ${h.thalers} талеров`}</div>`;
      })
      .join('');
    const marks = over.querySelectorAll('circle.kn-move').length;
    this.note.textContent =
      this.actSeat == null
        ? 'Ждём других игроков.'
        : v.phase === 'step'
          ? `Ваш ход: осталось шагов ${v.left}, кружков для шага ${marks}. Возьмите пуговицу и поставьте на жёлтый кружок.`
          : v.phase === 'roll'
            ? 'Бросьте кубик — пробелом, тапом по доске или кнопкой.'
            : 'Смотрите карточку и жмите «Дальше».';
    this.showCard();
  }

  /** Карточка приключений — ждёт игрока. */
  private showCard() {
    if (!this.card || !this.v) return;
    const c = this.v.card;
    if (!c) {
      this.card.hidden = true;
      return;
    }
    this.card.hidden = false;
    this.card.innerHTML =
      (c.num != null ? `<img src="/korona/cards/card-${String(c.num).padStart(3, '0')}.webp" alt="" draggable="false">` : '') +
      `<div class="kn-card-t">${c.num != null ? 'Карточка №' + c.num : 'Поле'}</div><div class="kn-card-s">${c.text}</div><div class="kn-card-h">нажмите, чтобы продолжить</div>`;
  }

  /** Перетаскивание своей пуговицы на подсвеченную клетку (как в «Джио-Джанги»). */
  private takeable(el: SVGElement, seat: number) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const from = { x: (e as PointerEvent).clientX, y: (e as PointerEvent).clientY };
      const up = (ev: PointerEvent) => {
        document.removeEventListener('pointerup', up);
        if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 6) return;
        const ctm = this.over!.getScreenCTM();
        const p = ctm ? { x: (ev.clientX - ctm.e) / ctm.a, y: (ev.clientY - ctm.f) / ctm.d } : { x: 0, y: 0 };
        let best = -1;
        let bd = Infinity;
        for (const g of Array.from(this.over!.querySelectorAll('circle.kn-move'))) {
          const to = Number(g.getAttribute('data-to'));
          const cc = cell(to);
          if (!cc) continue;
          const px = cellPx(to)!;
          const d = Math.hypot(px.x - p.x, px.y - p.y);
          if (d < bd) {
            bd = d;
            best = to;
          }
        }
        if (best >= 0 && bd < 90) this.ctx?.act(seat, { type: 'step', to: best });
      };
      try {
        el.setPointerCapture((e as PointerEvent).pointerId);
      } catch {
        /* не все браузеры умеют */
      }
      el.addEventListener('pointerup', up, { once: true });
      document.addEventListener('pointerup', up, { once: true });
    });
  }

  setView(view: KV) {
    this.v = view;
    if (view.heroes[view.turn]?.ember) this.ember = true;
    this.render();
  }

  async play(events: Event[], view: KV) {
    for (const ev of events) {
      if (ev.type === 'card') {
        this.v = view;
        this.showCard();
        await this.ctx?.read?.(900);
      } else {
        this.v = { ...view };
        this.render();
        await sleep(260 / Math.max(0.4, this.ctx!.speed()));
      }
    }
    this.setView(view);
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.actSeat = interactive.length ? interactive[0] : toAct.length ? toAct[0] : null;
    this.render();
  }

  status(view: KV, _toAct: number[], interactive: number[]) {
    if (!interactive.length) return 'Ждём других игроков';
    const h = view.heroes[interactive[0]];
    if (h?.ember) return h.prince ? `Принц: ПЖ ${h.pj}` : 'Столица Эмбера: станьте принцем';
    return view.phase === 'roll' ? 'Бросайте кубик' : view.phase === 'step' ? `Осталось шагов: ${view.left}` : 'Смотрите карточку';
  }

  playerStats(view: KV, seat: number) {
    const h = view.heroes[seat];
    if (!h) return '';
    if (h.ember) return `Принц Эмбера · ПЖ ${h.pj}`;
    return `${STATS.map((k) => `${k} ${h.st[k as Stat]}`).join(' · ')} · ПЖ ${h.life} · ${h.thalers} талеров`;
  }

  destroy() {
    this.cam?.destroy();
    this.cam = null;
    this.wrap?.remove();
    this.wrap = null;
  }
}

/** Фабрика вида: каждому экрану — свой экземпляр. */
export const createView = () => new View();
export default createView;

/** Для отладки: размеры полей. */
export const fieldSizes = { field1: [W, H], field2: [W2, H2] } as const;
export type { State };

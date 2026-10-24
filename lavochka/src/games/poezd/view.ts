/* «Поездом по СССР» — отрисовка. Поле — склеенная карта фанатского набора (public/poezd/map.webp) под камерой больших полей;
 * поверх (SVG в координатах карты) — вагончики игроков на путях, станции, фишки на счётчике очков, подсветка доступных путей.
 * Касание пути — способы оплаты (и контролёр), касание города — станция. В панели — открытые карты, колода, маршруты, рука. */
import { Sound } from '../../core/audio';
import { BoardCam, type CamPoint } from '../../core/boardcam';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { CITIES, MAP_H, MAP_W, ROUTES, TRACK } from './board';
import { BONUS, CARD_CSS, CARD_IMG, CARD_ONE, CARD_PL, COLOR_NAME, CTRL, LOCO, ROUTE_POINTS, TICKETS } from './data';
import { SEATS } from './def';
import {
  canDrawDeck,
  canDrawOpen,
  connected,
  payOptions,
  routeOpen,
  stationCost,
  stationOptions,
  tunnelPayable,
  type Action,
  type Event,
  type State,
} from './engine';
import './poezd.css';

const BASE = `${import.meta.env.BASE_URL}poezd/`;
const cardImg = (k: number) => `${BASE}cards/${CARD_IMG[k]}.webp`;
const ticketImg = (t: number) => `${BASE}tickets/${t}.webp`;
const routeName = (r: number) => `${CITIES[ROUTES[r].a].name} — ${CITIES[ROUTES[r].b].name}`;
/** Размер вагончика на карте (в пикселях map.webp). */
const CAR_L = 124;
const CAR_S = 38;

const chips = (color: number, n: number, locos: number) =>
  `${n - locos > 0 ? `<span class="pz-chip" style="--c:${CARD_CSS[color]}">${n - locos}</span>` : ''}${locos ? `<span class="pz-chip loco">${locos}</span>` : ''}`;

class PoezdView implements GameView<State, Event> {
  private ctx!: ViewCtx<Action>;
  private v: State | null = null;
  private wrap!: HTMLElement;
  private board!: HTMLElement;
  private svg!: SVGSVGElement;
  private stage!: HTMLElement;
  private float!: HTMLElement;
  private panel!: HTMLElement;
  private cam!: BoardCam;
  private interactive: number[] = [];
  private busy = false;
  private sel: { route?: number; city?: number } | null = null;
  private pick = new Set<number>();
  private focusTicket: number | null = null;
  /** Пути, которые сейчас «въезжают» (анимация). */
  private fresh = new Set<number>();

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="pz-wrap"><div class="pz-board">
        <img class="pz-img" alt="карта железных дорог СССР" draggable="false" src="${BASE}map.webp">
        <svg class="pz-svg" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="none"></svg>
      </div>
      <div class="pz-stage bc-ui"></div>
      <div class="pz-float"></div></div>`);
    root.appendChild(this.wrap);
    this.board = this.wrap.querySelector('.pz-board') as HTMLElement;
    this.svg = this.wrap.querySelector('.pz-svg') as unknown as SVGSVGElement;
    this.stage = this.wrap.querySelector('.pz-stage') as HTMLElement;
    this.float = this.wrap.querySelector('.pz-float') as HTMLElement;
    this.cam = new BoardCam(this.wrap, this.board, {
      w: MAP_W,
      h: MAP_H,
      mini: `${BASE}map-small.webp`,
      src: MAP_W,
      token: 0.03,
      followKey: 'poezd.follow',
      demo: ctx.demo,
      speed: () => this.ctx.speed(),
      dots: () => [],
      turn: () => this.turnPoints(),
    });
    const img = this.wrap.querySelector('.pz-img') as HTMLImageElement;
    ctx.hold?.(8000);
    const ready = () => {
      this.board.classList.add('ready');
      this.ctx.hold?.(0);
      this.cam.shown();
    };
    if (img.complete && img.naturalWidth) ready();
    else img.onload = ready;
    this.wrap.addEventListener('click', (e) => this.onBoard(e));
    this.panel = h(`<div class="pz-panel"></div>`);
    ctx.controls.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => this.onPanel(e));
    this.stage.addEventListener('click', (e) => this.onStage(e));
  }

  private turnPoints(): CamPoint[] {
    const v = this.v;
    if (!v) return [];
    if (v.last?.route != null) return ROUTES[v.last.route].cars.map(([x, y]) => ({ x, y }));
    if (v.last?.city != null) return [CITIES[v.last.city]];
    return [{ x: MAP_W * 0.3, y: MAP_H * 0.4 }, { x: MAP_W * 0.7, y: MAP_H * 0.6 }];
  }

  setView(v: State) {
    this.v = v;
    this.render();
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.interactive = interactive;
    if (!this.mine()) this.sel = null;
    this.render();
  }

  /** Место этого экрана, которое сейчас ходит. */
  private mine(): number | null {
    const v = this.v;
    if (!v || v.phase === 'over' || this.ctx.demo) return null;
    if (v.phase === 'start') return this.interactive.find((s) => v.offer[s]?.length) ?? null;
    return this.interactive.includes(v.turn) ? v.turn : null;
  }

  /** Чью руку показывать: ходящего своего, иначе первого своего. */
  private me(): number | null {
    const v = this.v;
    if (!v) return null;
    const m = this.mine();
    if (m != null) return m;
    const own = this.ctx.mySeats.find((s) => s < v.n && v.hand[s]);
    if (own != null) return own;
    return this.ctx.demo ? v.turn : null;
  }

  async play(events: Event[], v: State) {
    const speed = this.ctx.speed();
    this.busy = true;
    this.sel = null;
    const prev = this.v;
    for (const ev of events) {
      switch (ev.type) {
        case 'claim': {
          await this.cam.frame(ROUTES[ev.route].cars.map(([x, y]) => ({ x, y })), []);
          if (prev) {
            prev.owner[ev.route] = ev.seat;
            this.v = prev;
          }
          this.fresh.add(ev.route);
          this.renderSvg();
          for (let i = 0; i < ROUTES[ev.route].len; i++) {
            Sound.place();
            await sleep(110 / speed);
          }
          this.delta(ev.seat, ev.pts, ROUTES[ev.route].cars[Math.floor(ROUTES[ev.route].len / 2)]);
          await sleep(350 / speed);
          this.fresh.delete(ev.route);
          break;
        }
        case 'remove':
          await this.cam.frame(ROUTES[ev.route].cars.map(([x, y]) => ({ x, y })), []);
          if (prev) {
            prev.owner[ev.route] = null;
            this.v = prev;
            this.renderSvg();
          }
          Sound.capture();
          this.say(`Контролёр! Путь ${routeName(ev.route)} разобран`);
          await sleep(900 / speed);
          break;
        case 'reveal':
          await this.cam.frame(ROUTES[ev.route].cars.map(([x, y]) => ({ x, y })), []);
          this.stage.innerHTML = `<div class="pz-box pz-show"><div class="pz-q">Тоннель ${esc(routeName(ev.route))}: три карты из колоды</div>
            <div class="pz-reveal">${ev.cards.map((c) => `<img src="${cardImg(c)}" alt="${CARD_ONE[c]}">`).join('')}</div>
            <div class="pz-q">${ev.extra ? `Совпало: <b>${ev.extra}</b> — нужно доплатить` : 'Совпадений нет — тоннель готов'}</div></div>`;
          Sound.card();
          await sleep(1500 / speed);
          break;
        case 'tunnelEnd':
          if (!ev.ok) this.say('Тоннель не построен — карты вернулись в руку');
          await sleep(400 / speed);
          break;
        case 'station':
          await this.cam.frame([CITIES[ev.city]], []);
          if (prev) {
            prev.station[ev.city] = ev.seat;
            this.v = prev;
            this.renderSvg();
          }
          Sound.place();
          await sleep(600 / speed);
          break;
        case 'draw':
          Sound.card();
          if (ev.slot >= 0) this.flashSlot(ev.slot);
          await sleep(260 / speed);
          break;
        case 'flush':
          this.say(ev.why === 'ctrl' ? 'Контролёр в открытых — все пять в сброс' : 'Три локомотива — все пять в сброс');
          Sound.shuffle();
          await sleep(700 / speed);
          break;
        case 'shuffle':
          Sound.shuffle();
          await sleep(300 / speed);
          break;
        case 'take':
          Sound.card();
          await sleep(300 / speed);
          break;
        case 'final':
          this.say('Последний круг!');
          Sound.turn();
          await sleep(900 / speed);
          break;
        case 'end':
          Sound.win();
          break;
      }
    }
    this.v = v;
    this.busy = false;
    this.render();
  }

  status(v: State, _toAct: number[], interactive: number[]) {
    if (v.result) return `Победа: ${v.result.winners.map((s) => this.ctx.name(s)).join(', ')} — ${v.result.rows[v.result.winners[0]].total} очков`;
    if (v.phase === 'start') {
      const me = interactive.find((s) => v.offer[s]?.length);
      return me != null ? 'Выберите маршруты: хотя бы один длинный и один короткий' : 'Игроки выбирают маршруты…';
    }
    const nm = this.ctx.name(v.turn);
    const me = interactive.includes(v.turn);
    if (!me) return `Ходит ${nm}…`;
    if (v.phase === 'second') return 'Возьмите вторую карту — открытую (не локомотив) или из колоды';
    if (v.phase === 'tickets') return 'Оставьте хотя бы один маршрут';
    if (v.phase === 'tunnel') return 'Тоннель: доплатить или отказаться';
    return `Ваш ход: возьмите карты, проложите путь${v.cfg.stations && v.stations[v.turn] ? ', поставьте станцию' : ''} или возьмите маршруты${v.finalLeft != null ? ' — последний круг!' : ''}`;
  }

  playerStats(v: State, seat: number) {
    if (seat >= v.n) return '';
    const r = v.result?.rows[seat];
    if (r) return `<b>${r.total}</b> оч. · маршрутов ${r.done}/${(v.tickets[seat] ?? []).length}`;
    return `<b>${v.score[seat]}</b> оч. · 🚃${v.wagons[seat]} · 🃏${v.handN[seat]} · 🎫${v.ticketsN[seat]}${v.cfg.stations ? ` · 🏠${v.stations[seat]}` : ''}`;
  }

  destroy() {
    this.cam.destroy();
  }

  // ---------- отрисовка ----------

  private render() {
    if (!this.v) return;
    this.renderSvg();
    this.renderPanel();
    if (!this.busy) this.renderStage();
  }

  private renderSvg() {
    const v = this.v!;
    const me = this.mine();
    let s = `<defs><filter id="pz-sh" x="-30%" y="-60%" width="160%" height="220%"><feDropShadow dx="3" dy="5" stdDeviation="3" flood-opacity="0.55"/></filter></defs>`;
    // доступные пути — светлая обводка
    if (me != null && v.phase === 'act' && !this.busy) {
      for (let r = 0; r < ROUTES.length; r++) {
        if (!routeOpen(v, me, r) || !payOptions(v, me, r).length) continue;
        for (const [x, y, a] of ROUTES[r].cars)
          s += `<rect class="pz-can" x="${x - CAR_L / 2 - 6}" y="${y - CAR_S / 2 - 8}" width="${CAR_L + 12}" height="${CAR_S + 16}" rx="10" transform="rotate(${a} ${x} ${y})"/>`;
      }
    }
    if (this.sel?.route != null)
      for (const [x, y, a] of ROUTES[this.sel.route].cars)
        s += `<rect class="pz-sel" x="${x - CAR_L / 2 - 8}" y="${y - CAR_S / 2 - 10}" width="${CAR_L + 16}" height="${CAR_S + 20}" rx="12" transform="rotate(${a} ${x} ${y})"/>`;
    // вагончики игроков
    for (let r = 0; r < ROUTES.length; r++) {
      const o = v.owner[r];
      if (o == null) continue;
      const c = SEATS[o];
      const last = v.last?.route === r;
      ROUTES[r].cars.forEach(([x, y, a], i) => {
        s += `<g class="pz-car ${this.fresh.has(r) ? 'new' : ''} ${last ? 'last' : ''}" style="--d:${i * 0.11}s" transform="translate(${x} ${y}) rotate(${a})">
          <rect x="${-CAR_L / 2}" y="${-CAR_S / 2}" width="${CAR_L}" height="${CAR_S}" rx="7" fill="${c.color}" stroke="#fff" stroke-width="5" filter="url(#pz-sh)"/>
          <rect x="${-CAR_L / 2 + 4}" y="${-CAR_S / 2 + 3}" width="${CAR_L - 8}" height="7" rx="3" fill="${c.light}" opacity="0.8"/>
          <rect x="${-CAR_L / 2 + 4}" y="${CAR_S / 2 - 9}" width="${CAR_L - 8}" height="6" rx="3" fill="${c.dark}" opacity="0.7"/>
          ${[-30, 0, 30].map((wx) => `<rect x="${wx - 9}" y="-6" width="18" height="11" rx="2" fill="${c.dark}" opacity="0.85"/>`).join('')}
        </g>`;
      });
    }
    // станции
    CITIES.forEach((c, i) => {
      const o = v.station[i];
      if (o == null) return;
      const col = SEATS[o];
      s += `<g class="pz-st ${v.last?.city === i ? 'last' : ''}" transform="translate(${c.x + 30} ${c.y - 46})" filter="url(#pz-sh)">
        <path d="M-26 6 L0 -20 L26 6 Z" fill="${col.dark}" stroke="#fff" stroke-width="3"/>
        <rect x="-20" y="4" width="40" height="26" fill="${col.color}" stroke="#fff" stroke-width="3"/>
        <rect x="-6" y="14" width="12" height="16" fill="${col.dark}"/></g>`;
    });
    // маршрут в фокусе — два города
    if (this.focusTicket != null) {
      const t = TICKETS[this.focusTicket];
      for (const c of [t.a, t.b]) s += `<circle class="pz-focus" cx="${CITIES[c].x}" cy="${CITIES[c].y}" r="44"/>`;
    }
    if (this.sel?.city != null) s += `<circle class="pz-focus" cx="${CITIES[this.sel.city].x}" cy="${CITIES[this.sel.city].y}" r="40"/>`;
    // фишки на счётчике
    const byCell = new Map<number, number[]>();
    for (let p = 0; p < v.n; p++) {
      const sc = v.result ? v.result.rows[p].total : v.score[p];
      const cell = ((sc % 100) + 100) % 100;
      byCell.set(cell, [...(byCell.get(cell) ?? []), p]);
    }
    for (const [cell, ps] of byCell) {
      const [x, y] = TRACK[cell];
      ps.forEach((p, k) => {
        const dx = (k - (ps.length - 1) / 2) * 26;
        s += `<circle cx="${x + dx}" cy="${y + (k % 2) * 10}" r="20" fill="${SEATS[p].color}" stroke="#fff" stroke-width="4" filter="url(#pz-sh)"/>`;
      });
    }
    this.svg.innerHTML = s;
  }

  private renderPanel() {
    const v = this.v!;
    const me = this.me();
    const act = this.mine();
    const myTurn = act != null && !this.busy;
    const canOpen = (i: number) => myTurn && (v.phase === 'act' || v.phase === 'second') && canDrawOpen(v, i);
    const canDeck = myTurn && (v.phase === 'act' || v.phase === 'second') && canDrawDeck(v);
    const canTickets = myTurn && v.phase === 'act' && v.tdeckN > 0;
    let html = `<div class="pz-market">
      ${v.open.map((c, i) => (c >= 0 ? `<button class="pz-card ${canOpen(i) ? 'can' : ''}" data-slot="${i}" ${canOpen(i) ? '' : 'disabled'} title="${CARD_ONE[c]}"><img src="${cardImg(c)}" alt="${CARD_ONE[c]}"></button>` : `<span class="pz-card empty"></span>`)).join('')}
      <button class="pz-card deck ${canDeck ? 'can' : ''}" data-slot="-1" ${canDeck ? '' : 'disabled'} title="Взять из колоды"><img src="${BASE}cards/back.webp" alt="колода"><b>${v.deckN}</b></button>
      <button class="pz-card tdeck ${canTickets ? 'can' : ''}" data-act="tickets" ${canTickets ? '' : 'disabled'} title="Взять три маршрута"><img src="${BASE}tickets/back-long.webp" alt="маршруты"><b>${v.tdeckN}</b></button>
    </div>`;
    if (me != null && v.hand[me]) {
      const hd = v.hand[me]!;
      const kinds = [0, 1, 2, 3, 4, 5, 6, 7, LOCO, CTRL].filter((k) => hd[k] > 0);
      html += `<div class="pz-hand">${kinds.length ? kinds.map((k) => `<span class="pz-hc" title="${hd[k]} — ${CARD_PL[k]}"><img src="${cardImg(k)}" alt="${CARD_ONE[k]}"><b>${hd[k]}</b></span>`).join('') : '<i>карт вагонов нет</i>'}</div>`;
      const mine = ROUTES.map((_, i) => i).filter((i) => v.owner[i] === me);
      const tk = v.tickets[me] ?? [];
      html += `<div class="pz-tickets">${tk
        .map((t) => {
          const ok = connected(mine, TICKETS[t].a, TICKETS[t].b);
          return `<button class="pz-tk ${ok ? 'done' : ''} ${this.focusTicket === t ? 'on' : ''}" data-ticket="${t}" title="${esc(CITIES[TICKETS[t].a].name)} — ${esc(CITIES[TICKETS[t].b].name)}: ${TICKETS[t].pts}">
            <img src="${ticketImg(t)}" alt="">${ok ? '<i>✓</i>' : ''}</button>`;
        })
        .join('')}</div>
        <div class="pz-mine">🚃 вагончиков: <b>${v.wagons[me]}</b>${v.cfg.stations ? ` · 🏠 станций: <b>${v.stations[me]}</b>` : ''}</div>`;
    }
    this.panel.innerHTML = html;
  }

  private flashSlot(i: number) {
    const el = this.panel.querySelector(`[data-slot="${i}"]`);
    el?.classList.add('taken');
  }

  private renderStage() {
    const v = this.v!;
    const st = this.stage;
    const me = this.mine();
    if (v.result) {
      const rows = v.result.rows;
      const order = rows.map((_, p) => p).sort((a, b) => rows[b].total - rows[a].total);
      st.innerHTML = `<div class="pz-box"><div class="pz-q big">🏆 ${v.result.winners.map((s) => this.ctx.name(s)).join(', ')}</div>
        <table class="pz-score"><tr><th></th><th>пути</th><th>маршруты</th><th>станции</th><th>бонусы</th><th>итого</th></tr>
        ${order
          .map((p) => {
            const r = rows[p];
            return `<tr><td>${this.ctx.name(p)}</td><td>${r.routes}</td><td>+${r.plus} / −${r.minus}</td><td>${r.stations}</td><td>${r.bonus.map((b) => `<span title="${esc(BONUS[b].name)}">${b === 'path' ? '🛤' : b === 'rail' ? '🎫' : b === 'ferry' ? '⚓' : '⛏'}${BONUS[b].pts}</span>`).join(' ') || '—'}</td><td><b>${r.total}</b></td></tr>`;
          })
          .join('')}</table>
        <div class="pz-note">Самый длинный путь: ${order.map((p) => `${this.ctx.name(p)} — ${rows[p].longest}`).join(', ')}</div></div>`;
      st.className = 'pz-stage bc-ui';
      return;
    }
    // выбор маршрутов
    if (me != null && (v.phase === 'start' || v.phase === 'tickets') && v.offer[me]) {
      const offer = v.offer[me]!;
      for (const t of [...this.pick]) if (!offer.includes(t)) this.pick.delete(t);
      if (!this.pick.size) {
        if (v.phase === 'start') {
          const l = offer.find((t) => TICKETS[t].long);
          const s = offer.find((t) => !TICKETS[t].long);
          if (l != null) this.pick.add(l);
          if (s != null) this.pick.add(s);
        } else this.pick.add(offer[0]);
      }
      const ok = v.phase === 'start' ? [...this.pick].some((t) => TICKETS[t].long) && [...this.pick].some((t) => !TICKETS[t].long) : this.pick.size > 0;
      st.innerHTML = `<div class="pz-box"><div class="pz-q">${v.phase === 'start' ? 'Оставьте маршруты — хотя бы один длинный и один короткий' : 'Оставьте хотя бы один маршрут'}</div>
        <div class="pz-offer">${offer.map((t) => `<button class="pz-of ${this.pick.has(t) ? 'on' : ''}" data-pick="${t}"><img src="${ticketImg(t)}" alt="${esc(CITIES[TICKETS[t].a].name)} — ${esc(CITIES[TICKETS[t].b].name)}"></button>`).join('')}</div>
        <button class="btn primary" data-keep ${ok ? '' : 'disabled'}>Оставить (${this.pick.size})</button></div>`;
      st.className = 'pz-stage bc-ui center';
      return;
    }
    this.pick.clear();
    if (v.phase === 'tunnel' && v.tunnel) {
      const t = v.tunnel;
      const mineT = me === v.turn;
      st.innerHTML = `<div class="pz-box"><div class="pz-q">Тоннель ${esc(routeName(t.route))}: открыты три карты</div>
        <div class="pz-reveal">${t.reveal.map((c) => `<img src="${cardImg(c)}" alt="${CARD_ONE[c]}">`).join('')}</div>
        <div class="pz-q">Доплата: <b>${t.extra}</b> ${t.color >= 0 ? `${CARD_PL[t.color]} или локомотивов` : 'локомотивов'}</div>
        ${mineT ? `<div class="pz-btns"><button class="btn primary" data-tunnel="1" ${tunnelPayable(v, me!) ? '' : 'disabled'}>Доплатить</button><button class="btn" data-tunnel="0">Отказаться</button></div>` : `<div class="pz-wait">${this.ctx.name(v.turn)} решает…</div>`}</div>`;
      st.className = 'pz-stage bc-ui center';
      return;
    }
    if (this.sel && me != null && v.phase === 'act') {
      st.innerHTML = this.selHtml(v, me);
      st.className = 'pz-stage bc-ui center';
      return;
    }
    if (this.sel) {
      st.innerHTML = this.infoHtml(v);
      st.className = 'pz-stage bc-ui center';
      return;
    }
    st.textContent = '';
  }

  /** Описание пути или города (не в свой ход). */
  private infoHtml(v: State): string {
    const sel = this.sel!;
    if (sel.route != null) {
      const R = ROUTES[sel.route];
      const o = v.owner[sel.route];
      return `<div class="pz-box"><div class="pz-q"><b>${esc(routeName(sel.route))}</b></div><div class="pz-q">${this.routeKind(sel.route)}, ${R.len} ваг. — ${ROUTE_POINTS[R.len]} оч.</div>
        <div class="pz-q">${o != null ? `занят: ${this.ctx.name(o)}` : 'свободен'}</div><button class="btn" data-close>Закрыть</button></div>`;
    }
    const c = sel.city!;
    const o = v.station[c];
    return `<div class="pz-box"><div class="pz-q"><b>${esc(CITIES[c].name)}</b></div>${o != null ? `<div class="pz-q">станция: ${this.ctx.name(o)}</div>` : ''}<button class="btn" data-close>Закрыть</button></div>`;
  }

  private routeKind(r: number): string {
    const R = ROUTES[r];
    const kind = R.tunnel ? 'тоннель' : R.ferry ? `паром (${R.ferry} локомотив)` : 'путь';
    return `${COLOR_NAME[R.color]} ${kind}`;
  }

  private selHtml(v: State, me: number): string {
    const sel = this.sel!;
    const hd = v.hand[me]!;
    if (sel.route != null) {
      const r = sel.route;
      const R = ROUTES[r];
      const o = v.owner[r];
      let body = `<div class="pz-q"><b>${esc(routeName(r))}</b></div><div class="pz-q">${this.routeKind(r)}, ${R.len} ваг. — ${ROUTE_POINTS[R.len]} оч.</div>`;
      const btns: string[] = [];
      if (o == null) {
        if (routeOpen(v, me, r)) {
          for (const p of payOptions(v, me, r)) {
            const col = p.color < 0 ? LOCO : p.color;
            btns.push(`<button class="btn primary" data-claim="${r}" data-color="${p.color}" data-locos="${p.locos}">Построить ${chips(col, R.len, p.color < 0 ? R.len : p.locos)}</button>`);
            // ещё вариант — с бо́льшим числом локомотивов
            if (p.color >= 0 && hd[LOCO] > p.locos && hd[p.color] >= 1 && R.len - p.locos > 1)
              btns.push(`<button class="btn" data-claim="${r}" data-color="${p.color}" data-locos="${p.locos + 1}">Построить ${chips(p.color, R.len, p.locos + 1)}</button>`);
          }
          if (!btns.length) body += `<div class="pz-q dim">Не хватает карт${R.ferry ? ` (нужен локомотив за паровоз)` : ''}</div>`;
          if (hd[CTRL] > 0 && R.len <= 4) btns.push(`<button class="btn" data-ctrl="${r}" data-mode="build">Контролёр: построить даром</button>`);
        } else body += `<div class="pz-q dim">${v.wagons[me] < R.len ? 'Не хватает вагончиков' : 'Двойной путь закрыт: второй уже занят'}</div>`;
      } else {
        body += `<div class="pz-q">занят: ${this.ctx.name(o)}</div>`;
        if (o !== me && hd[CTRL] > 0 && R.len <= 4) btns.push(`<button class="btn" data-ctrl="${r}" data-mode="remove">Контролёр: разобрать путь</button>`);
      }
      return `<div class="pz-box">${body}<div class="pz-btns">${btns.join('')}<button class="btn" data-close>Отмена</button></div></div>`;
    }
    const c = sel.city!;
    let body = `<div class="pz-q"><b>${esc(CITIES[c].name)}</b></div>`;
    const btns: string[] = [];
    if (v.station[c] != null) body += `<div class="pz-q">станция: ${this.ctx.name(v.station[c]!)}</div>`;
    else if (v.cfg.stations && v.stations[me] > 0) {
      const k = stationCost(v, me);
      const opts = stationOptions(v, me, c);
      body += `<div class="pz-q">Станция — ${k} ${k === 1 ? 'карта' : 'карты'}${k === 1 ? ' цвета пути из города' : ' одного цвета'}</div>`;
      for (const p of opts) btns.push(`<button class="btn primary" data-station="${c}" data-color="${p.color}" data-locos="${p.locos}">Поставить ${chips(p.color < 0 ? LOCO : p.color, k, p.color < 0 ? k : p.locos)}</button>`);
      if (!opts.length) body += `<div class="pz-q dim">Не хватает карт</div>`;
    }
    return `<div class="pz-box">${body}<div class="pz-btns">${btns.join('')}<button class="btn" data-close>Отмена</button></div></div>`;
  }

  // ---------- касания ----------

  private onBoard(e: MouseEvent) {
    const v = this.v;
    if (!v || this.busy || (e.target as HTMLElement).closest('.pz-box, .bc-cam, .bc-mini')) return;
    const { x, y } = this.cam.toImg(e.clientX, e.clientY);
    // город ближе 40 px — город, иначе ближайший вагончик ближе 70 px
    let city = -1;
    let cd = 42 * 42;
    CITIES.forEach((c, i) => {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < cd) {
        cd = d;
        city = i;
      }
    });
    let route = -1;
    let rd = 70 * 70;
    ROUTES.forEach((R, i) =>
      R.cars.forEach(([cx, cy]) => {
        const d = (cx - x) ** 2 + (cy - y) ** 2;
        if (d < rd) {
          rd = d;
          route = i;
        }
      })
    );
    if (city >= 0) this.sel = { city };
    else if (route >= 0) this.sel = { route };
    else this.sel = null;
    this.focusTicket = null;
    this.render();
  }

  private onStage(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t || t.disabled) return;
    e.stopPropagation();
    const d = t.dataset;
    if (d.close != null) {
      this.sel = null;
      return this.render();
    }
    if (d.pick != null) {
      const k = Number(d.pick);
      if (this.pick.has(k)) this.pick.delete(k);
      else this.pick.add(k);
      return this.renderStage();
    }
    if (d.keep != null) return this.send({ type: 'keep', keep: [...this.pick] });
    if (d.tunnel != null) return this.send({ type: 'tunnel', pay: d.tunnel === '1' });
    if (d.claim != null) return this.send({ type: 'claim', route: Number(d.claim), color: Number(d.color), locos: Number(d.locos) });
    if (d.station != null) return this.send({ type: 'station', city: Number(d.station), color: Number(d.color), locos: Number(d.locos) });
    if (d.ctrl != null) return this.send({ type: 'ctrl', route: Number(d.ctrl), mode: d.mode as 'build' | 'remove' });
  }

  private onPanel(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t) return;
    const d = t.dataset;
    if (d.ticket != null) {
      const k = Number(d.ticket);
      this.focusTicket = this.focusTicket === k ? null : k;
      this.sel = null;
      this.render();
      if (this.focusTicket != null) {
        this.cam.release();
        void this.cam.frame([CITIES[TICKETS[k].a], CITIES[TICKETS[k].b]], [], true);
      }
      return;
    }
    if (t.disabled) return;
    if (d.slot != null) return this.send({ type: 'draw', slot: Number(d.slot) });
    if (d.act === 'tickets') return this.send({ type: 'tickets' });
  }

  private send(a: Action) {
    const v = this.v;
    if (!v || this.busy) return;
    const seat = this.mine();
    if (seat == null) return;
    Sound.unlock();
    this.sel = null;
    this.ctx.act(seat, a);
  }

  private say(text: string) {
    const el = h(`<div class="pz-say">${esc(text)}</div>`);
    this.float.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  private delta(_seat: number, n: number, at: [number, number, number]) {
    const p = this.cam.toScreen({ x: at[0], y: at[1] });
    const el = h(`<div class="pz-delta" style="left:${p.x}px;top:${p.y}px">+${n}</div>`);
    this.float.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }
}

export function createView(): GameView<State, Event> {
  return new PoezdView();
}

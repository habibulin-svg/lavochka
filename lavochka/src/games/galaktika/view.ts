/* «Освоение галактики» — отрисовка. Поле — склеенный скан планисферы (public/galaktika/map.webp) под камерой больших полей;
 * поверх (SVG в координатах поля) — фишки-звездолёты с числом у подписи каждой территории, выбор и цели освоения, стрелка боя.
 * Касание своей территории — поставить звездолёты / выбрать, откуда осваивать или перемещать; касание цели — окно броска. */
import { Sound } from '../../core/audio';
import { BoardCam, type CamPoint } from '../../core/boardcam';
import { DiceTray } from '../../core/dice';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { ADJ, GOALS, JOKER_A, K, MAP_H, MAP_W, METHOD_ICON, METHODS, PLANETS, TERRS, linkKey, IS_SPACE } from './data';
import { ALLY_LOOK, SEATS } from './def';
import { ALLY, canAttack, canGo, canMove, mustTrade, sets, tradeValue, type Action, type Event, type State } from './engine';
import './galaktika.css';

const BASE = `${import.meta.env.BASE_URL}galaktika/`;
/** Где стоит фишка территории (чуть ниже подписи). */
const tokXY = (t: number): [number, number] => [TERRS[t].x * K, (TERRS[t].y + 22) * K];
const look = (v: State, o: number) => (o >= 0 && o < v.n ? SEATS[o] : ALLY_LOOK);

class GalaktikaView implements GameView<State, Event> {
  private ctx!: ViewCtx<Action>;
  private v: State | null = null;
  private wrap!: HTMLElement;
  private board!: HTMLElement;
  private svg!: SVGSVGElement;
  private stage!: HTMLElement;
  private float!: HTMLElement;
  private panel!: HTMLElement;
  private trays!: HTMLElement;
  private trayA!: DiceTray;
  private trayD!: DiceTray;
  private cam!: BoardCam;
  private interactive: number[] = [];
  private busy = false;
  private from: number | null = null;
  private to: number | null = null;
  private dice = 3;
  private step = 1;
  private moveN = 1;
  private pick = new Set<number>();

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="gk-wrap"><div class="gk-board">
        <img class="gk-img" alt="планисфера: шесть планет" draggable="false" src="${BASE}map.webp">
        <svg class="gk-svg" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="none"></svg>
      </div>
      <div class="gk-stage bc-ui"></div>
      <div class="gk-float"></div></div>`);
    root.appendChild(this.wrap);
    this.board = this.wrap.querySelector('.gk-board') as HTMLElement;
    this.svg = this.wrap.querySelector('.gk-svg') as unknown as SVGSVGElement;
    this.stage = this.wrap.querySelector('.gk-stage') as HTMLElement;
    this.float = this.wrap.querySelector('.gk-float') as HTMLElement;
    this.cam = new BoardCam(this.wrap, this.board, {
      w: MAP_W,
      h: MAP_H,
      mini: `${BASE}map-small.webp`,
      src: MAP_W,
      token: 0.03,
      followKey: 'galaktika.follow',
      demo: ctx.demo,
      speed: () => this.ctx.speed(),
      dots: () => [],
      turn: () => this.turnPoints(),
    });
    const img = this.wrap.querySelector('.gk-img') as HTMLImageElement;
    ctx.hold?.(8000);
    const ready = () => {
      this.board.classList.add('ready');
      this.ctx.hold?.(0);
      this.cam.shown();
    };
    if (img.complete && img.naturalWidth) ready();
    else img.onload = ready;
    this.wrap.addEventListener('click', (e) => this.onBoard(e));
    this.stage.addEventListener('click', (e) => this.onStage(e));
    this.trays = h(`<div class="gk-dice"><div class="gk-da"></div><div class="gk-dd"></div></div>`);
    ctx.controls.appendChild(this.trays);
    this.trayA = new DiceTray(this.trays.querySelector('.gk-da') as HTMLElement, 3);
    this.trayD = new DiceTray(this.trays.querySelector('.gk-dd') as HTMLElement, 2);
    this.trayA.show(null);
    this.trayD.show(null);
    this.panel = h(`<div class="gk-panel"></div>`);
    ctx.controls.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => this.onPanel(e));
  }

  private turnPoints(): CamPoint[] {
    const v = this.v;
    if (!v) return [];
    if (v.last?.from != null && v.last.to != null) return [v.last.from, v.last.to].map((t) => ({ x: tokXY(t)[0], y: tokXY(t)[1] }));
    return [
      { x: MAP_W * 0.05, y: MAP_H * 0.05 },
      { x: MAP_W * 0.95, y: MAP_H * 0.95 },
    ];
  }

  setView(v: State) {
    this.v = v;
    this.render();
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.interactive = interactive;
    if (!this.mine()) this.from = this.to = null;
    this.render();
  }

  private mine(): number | null {
    const v = this.v;
    if (!v || v.phase === 'over' || this.ctx.demo) return null;
    return this.interactive.includes(v.turn) ? v.turn : null;
  }

  private me(): number | null {
    const v = this.v;
    if (!v) return null;
    const m = this.mine();
    if (m != null) return m;
    return this.ctx.mySeats.find((s) => s < v.n && v.hand[s]) ?? (this.ctx.demo ? v.turn : null);
  }

  async play(events: Event[], v: State) {
    const speed = this.ctx.speed();
    this.busy = true;
    const prev = this.v;
    for (const ev of events) {
      switch (ev.type) {
        case 'place':
          if (prev) {
            prev.ships[ev.t] += ev.n;
            this.v = prev;
            this.renderSvg(ev.t);
          }
          Sound.place();
          await sleep(220 / speed);
          break;
        case 'roll': {
          if (prev) {
            prev.last = { from: ev.from, to: ev.to };
            this.v = prev;
            this.renderSvg();
          }
          await this.cam.frame([ev.from, ev.to].map((t) => ({ x: tokXY(t)[0], y: tokXY(t)[1] })), []);
          await Promise.all([this.trayA.roll(padDice(ev.a, 3), speed), this.trayD.roll(padDice(ev.d, 2), speed)]);
          this.trayA.dice.forEach((d, i) => d.setUsed(i >= ev.a.length));
          this.trayD.dice.forEach((d, i) => d.setUsed(i >= ev.d.length));
          if (prev) {
            prev.ships[ev.from] -= ev.lostA;
            prev.ships[ev.to] -= ev.lostD;
            this.renderSvg();
          }
          if (ev.lostD) Sound.capture();
          await sleep(380 / speed);
          break;
        }
        case 'conquer':
          if (prev) {
            prev.owner[ev.to] = prev.owner[ev.from];
            prev.ships[ev.to] = ev.moved;
            prev.ships[ev.from] -= ev.moved;
            this.renderSvg(ev.to);
          }
          Sound.win();
          await sleep(450 / speed);
          break;
        case 'out':
          this.say(`${strip(this.ctx.name(ev.seat))} выбывает!`);
          await sleep(900 / speed);
          break;
        case 'move':
          if (prev) {
            prev.ships[ev.from] -= ev.n;
            prev.ships[ev.to] += ev.n;
            this.renderSvg(ev.to);
          }
          Sound.step();
          await sleep(350 / speed);
          break;
        case 'trade':
          Sound.card();
          this.say(`Обмен карточек: +${ev.n}`);
          await sleep(500 / speed);
          break;
        case 'income':
          if (ev.n) {
            this.say(`${strip(this.ctx.name(ev.seat))}: +${ev.n} за планеты`);
            await sleep(500 / speed);
          }
          break;
        case 'end':
          Sound.win();
          break;
      }
    }
    this.v = v;
    this.busy = false;
    // выбор остаётся, если можно бить дальше
    if (this.from != null && !(v.owner[this.from] === v.turn || (v.ally && v.owner[this.from] === ALLY(v)))) this.from = null;
    if (this.to != null && this.from != null && !canAttack(v, v.turn, this.from, this.to)) this.to = null;
    this.render();
  }

  status(v: State, _toAct: number[], interactive: number[]) {
    if (v.result) return `Победа: ${v.result.winners.map((s) => this.ctx.name(s)).join(', ')} — ${esc(v.result.text)}`;
    const me = interactive.includes(v.turn);
    const nm = this.ctx.name(v.turn);
    if (!me) return `Ходит ${nm}…`;
    if (v.phase === 'setup') return `Расставьте звездолёты по своим территориям: осталось ${v.pending}`;
    if (v.phase === 'reinforce') {
      if (v.allyPending) return `Поставьте союзнику ${v.allyPending} звездолётов (серые территории)`;
      if (v.pending) return `Поставьте новые звездолёты: ${v.pending}`;
      if (mustTrade(v, v.turn)) return 'Пять карточек — обмен обязателен';
      return 'Обменяйте карточки или начинайте освоение';
    }
    if (v.phase === 'attack') return this.from == null ? 'Освоение: выберите свою территорию (не меньше двух звездолётов)' : 'Выберите соседнюю территорию для освоения';
    if (v.phase === 'move') return 'Перемещение: откуда и куда (одно за ход)';
    return '';
  }

  playerStats(v: State, seat: number) {
    if (seat >= v.n) return '';
    if (v.out[seat]) return '<b>выбыл</b>';
    let terr = 0;
    let ships = 0;
    v.owner.forEach((o, t) => {
      if (o === seat) {
        terr++;
        ships += v.ships[t];
      }
    });
    const pl = PLANETS.map((_, k) => k).filter((k) => TERRS.every((t, i) => t.planet !== k || v.owner[i] === seat));
    return `🌍${terr} · 🚀${ships} · 🃏${v.handN[seat]}${pl.length ? ` · ${pl.map((k) => PLANETS[k].name.split(/[ -]/)[0]).join(', ')}` : ''}`;
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

  private renderSvg(pop?: number) {
    const v = this.v!;
    const me = this.mine();
    let s = `<defs><filter id="gk-sh" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="3" dy="5" stdDeviation="4" flood-opacity="0.7"/></filter></defs>`;
    // стрелка последнего боя / перемещения
    if (v.last?.from != null && v.last.to != null) s += arrow(v.last.from, v.last.to, '#ffd21a');
    // доступные цели
    const targets = new Set<number>();
    if (me != null && !this.busy && this.from != null) {
      for (const u of ADJ[this.from]) {
        if (v.phase === 'attack' && canAttack(v, me, this.from, u)) targets.add(u);
        if ((v.phase === 'move' || v.phase === 'attack') && canMove(v, me, this.from, u)) targets.add(u);
      }
      for (const u of targets) s += arrow(this.from, u, v.owner[u] === me ? '#7cf09a' : '#ff6a4a', true);
    }
    // фишки
    TERRS.forEach((_, t) => {
      const o = v.owner[t];
      if (o < 0) return;
      const L = look(v, o);
      const [x, y] = tokXY(t);
      const sel = this.from === t || this.to === t;
      const can = me != null && !this.busy && this.canTap(v, me, t);
      const r = 46;
      s += `<g class="gk-tok ${pop === t ? 'pop' : ''} ${sel ? 'sel' : ''} ${can ? 'can' : ''} ${targets.has(t) ? 'tgt' : ''}" transform="translate(${x} ${y})">
        ${sel || targets.has(t) || can ? `<circle class="gk-ring" r="${r + 16}"/>` : ''}
        <path d="M0 ${-r} L${r} ${-r * 0.1} L${r * 0.75} ${r} L${-r * 0.75} ${r} L${-r} ${-r * 0.1} Z" fill="${L.color}" stroke="${L.dark}" stroke-width="5" stroke-linejoin="round" filter="url(#gk-sh)"/>
        <path d="M0 ${-r * 0.62} L${r * 0.6} ${-r * 0.06} L${-r * 0.6} ${-r * 0.06} Z" fill="${L.light}" opacity="0.55"/>
        <text y="${r * 0.55}" class="gk-n">${v.ships[t]}</text></g>`;
    });
    this.svg.innerHTML = s;
  }

  /** Можно ли сейчас тронуть территорию (подсветка). */
  private canTap(v: State, me: number, t: number): boolean {
    if (v.phase === 'setup' || v.phase === 'reinforce') return v.allyPending > 0 ? v.owner[t] === ALLY(v) : v.pending > 0 && v.owner[t] === me;
    if (this.from != null) return false;
    if (v.phase === 'attack') return ADJ[t].some((u) => canAttack(v, me, t, u) || canMove(v, me, t, u));
    if (v.phase === 'move') return ADJ[t].some((u) => canMove(v, me, t, u));
    return false;
  }

  private renderPanel() {
    const v = this.v!;
    const me = this.me();
    const act = this.mine();
    let html = '';
    if (act != null && (v.phase === 'setup' || v.phase === 'reinforce') && (v.pending > 0 || v.allyPending > 0)) {
      const left = v.allyPending || v.pending;
      html += `<div class="gk-left">${v.allyPending ? 'Союзнику' : 'Поставить'}: <b>${left}</b></div>
        <div class="gk-steps">${[1, 5, left]
          .filter((x, i, a) => x <= left && a.indexOf(x) === i)
          .map((x) => `<button class="btn ${this.step === x || (this.step > left && x === left) ? 'primary' : ''}" data-step="${x}">${x === left && x > 5 ? `все ${x}` : `по ${x}`}</button>`)
          .join('')}</div>`;
    }
    if (act != null && !this.busy) {
      if (v.phase === 'reinforce' && !v.pending && !v.allyPending) html += `<button class="btn primary gk-go" data-act="go" ${canGo(v, act) ? '' : 'disabled'}>К освоению</button>`;
      if (v.phase === 'attack') html += `<button class="btn gk-go" data-act="endAttack">Закончить освоение</button>`;
      if (v.phase === 'move') html += `<button class="btn gk-go" data-act="end">Закончить ход</button>`;
    }
    if (me != null && v.hand[me]) {
      const hand = v.hand[me]!;
      const canTrade = act === me && v.phase === 'reinforce' && !this.busy;
      for (const c of [...this.pick]) if (!hand.includes(c)) this.pick.delete(c);
      const val = this.pick.size === 3 ? tradeValue(v, [...this.pick]) : 0;
      html += `<div class="gk-cards">${hand
        .map((c) => {
          const m = c >= JOKER_A ? -1 : TERRS[c].method;
          return `<button class="gk-card ${this.pick.has(c) ? 'on' : ''}" data-card="${c}" ${canTrade ? '' : 'disabled'} title="${esc(c >= JOKER_A ? 'джокер' : `${TERRS[c].name}: ${METHODS[m]} аргументы`)}">
            <span class="gk-ci">${m < 0 ? '★' : METHOD_ICON[m]}</span><span class="gk-cn">${c >= JOKER_A ? 'Джокер' : esc(TERRS[c].name)}</span></button>`;
        })
        .join('')}</div>`;
      if (canTrade && sets(v, me).length)
        html += `<div class="gk-trade"><button class="btn ${val ? 'primary' : ''}" data-act="trade" ${val ? '' : 'disabled'}>Обменять${val ? ` на ${val}` : ' (выберите три)'}</button>
          <button class="btn" data-act="best">Лучший набор</button></div>`;
      const g = v.goal[me];
      if (g != null) html += `<div class="gk-goal"><b>Цель:</b> ${esc(GOALS[g].text)}</div>`;
      else if (v.cfg.mode === 'duel') html += `<div class="gk-goal"><b>Цель:</b> освоить все территории соперника</div>`;
      else if (v.cfg.mode === 'galaxy') html += `<div class="gk-goal"><b>Цель:</b> освоить всю галактику</div>`;
    }
    html += `<div class="gk-bonus">${PLANETS.map((p) => `<span style="--c:${p.color}">${esc(p.name)} <b>+${p.bonus}</b></span>`).join('')}</div>`;
    this.panel.innerHTML = html;
  }

  private renderStage() {
    const v = this.v!;
    const st = this.stage;
    const me = this.mine();
    if (v.result) {
      st.innerHTML = `<div class="gk-box"><div class="gk-q big">🏆 ${v.result.winners.map((s) => this.ctx.name(s)).join(', ')}</div><div class="gk-q">${esc(v.result.text)}</div>
        ${v.goal.some((g) => g != null) ? `<div class="gk-goals">${v.goal.map((g, p) => (g != null ? `<div>${this.ctx.name(p)}: ${esc(GOALS[g].text)}</div>` : '')).join('')}</div>` : ''}</div>`;
      return;
    }
    if (me == null || this.from == null || this.to == null) {
      st.textContent = '';
      return;
    }
    const f = this.from;
    const t = this.to;
    if (v.phase === 'attack' && canAttack(v, me, f, t)) {
      const max = Math.min(3, v.ships[f] - 1);
      if (this.dice > max) this.dice = max;
      st.innerHTML = `<div class="gk-box"><div class="gk-q"><b>${esc(TERRS[f].name)}</b> (${v.ships[f]}) → <b>${esc(TERRS[t].name)}</b> (${v.ships[t]})${IS_SPACE.has(linkKey(f, t)) ? ' · по космосу' : ''}</div>
        <div class="gk-row">Кубиков: ${[1, 2, 3]
          .filter((k) => k <= max)
          .map((k) => `<button class="btn ${this.dice === k ? 'primary' : ''}" data-dice="${k}">${k}</button>`)
          .join('')}</div>
        <div class="gk-row"><button class="btn primary" data-roll="1" data-tap>Бросить</button><button class="btn" data-roll="all">До конца</button><button class="btn" data-close>Отмена</button></div></div>`;
      return;
    }
    if ((v.phase === 'move' || v.phase === 'attack') && canMove(v, me, f, t)) {
      const max = v.ships[f] - 1;
      this.moveN = Math.max(1, Math.min(this.moveN, max));
      st.innerHTML = `<div class="gk-box"><div class="gk-q">Переместить: <b>${esc(TERRS[f].name)}</b> → <b>${esc(TERRS[t].name)}</b></div>
        <div class="gk-row"><button class="btn" data-mv="-1">−</button><b class="gk-mv">${this.moveN}</b><button class="btn" data-mv="1">+</button><button class="btn" data-mv="all">все ${max}</button></div>
        <div class="gk-row"><button class="btn primary" data-move>Переместить${v.phase === 'attack' ? ' и закончить ход' : ''}</button><button class="btn" data-close>Отмена</button></div></div>`;
      return;
    }
    st.textContent = '';
  }

  // ---------- касания ----------

  private onBoard(e: MouseEvent) {
    const v = this.v;
    if (!v || this.busy || (e.target as HTMLElement).closest('.gk-box, .bc-cam, .bc-mini')) return;
    const me = this.mine();
    if (me == null) return;
    const { x, y } = this.cam.toImg(e.clientX, e.clientY);
    let t = -1;
    let bd = (90 * K) ** 2;
    TERRS.forEach((_, i) => {
      const [tx, ty] = tokXY(i);
      const d = (tx - x) ** 2 + (ty - y) ** 2;
      if (d < bd) {
        bd = d;
        t = i;
      }
    });
    if (t < 0) {
      this.from = this.to = null;
      return this.render();
    }
    if (v.phase === 'setup' || v.phase === 'reinforce') {
      const left = v.allyPending || v.pending;
      if (!left) return;
      const ok = v.allyPending ? v.owner[t] === ALLY(v) : v.owner[t] === me;
      if (ok) this.send({ type: 'place', t, n: Math.min(this.step, left) });
      return;
    }
    if (this.from != null && t !== this.from) {
      const canA = v.phase === 'attack' && canAttack(v, me, this.from, t);
      const canM = canMove(v, me, this.from, t);
      if (canA || canM) {
        this.to = t;
        this.moveN = v.ships[this.from] - 1;
        return this.render();
      }
    }
    const own = v.owner[t] === me || (v.ally && v.owner[t] === ALLY(v) && v.phase === 'attack');
    this.from = own && v.ships[t] >= 2 ? (this.from === t ? null : t) : null;
    this.to = null;
    this.render();
  }

  private onStage(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    e.stopPropagation();
    const d = b.dataset;
    if (d.close != null) {
      this.to = null;
      return this.render();
    }
    if (d.dice) {
      this.dice = Number(d.dice);
      return this.renderStage();
    }
    if (d.mv) {
      const max = this.v!.ships[this.from!] - 1;
      this.moveN = d.mv === 'all' ? max : Math.max(1, Math.min(max, this.moveN + Number(d.mv)));
      return this.renderStage();
    }
    if (d.roll && this.from != null && this.to != null) return this.send({ type: 'attack', from: this.from, to: this.to, dice: this.dice, all: d.roll === 'all' });
    if (d.move != null && this.from != null && this.to != null) {
      const a: Action = { type: 'move', from: this.from, to: this.to, n: this.moveN };
      this.from = this.to = null;
      return this.send(a);
    }
  }

  private onPanel(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    const d = b.dataset;
    const v = this.v!;
    if (d.step) {
      this.step = Number(d.step);
      return this.renderPanel();
    }
    if (d.card) {
      const c = Number(d.card);
      if (this.pick.has(c)) this.pick.delete(c);
      else if (this.pick.size < 3) this.pick.add(c);
      return this.renderPanel();
    }
    if (d.act === 'best') {
      const me = this.mine();
      const best = me != null ? sets(v, me)[0] : null;
      this.pick = new Set(best ?? []);
      return this.renderPanel();
    }
    if (d.act === 'trade') {
      const cards = [...this.pick];
      this.pick.clear();
      return this.send({ type: 'trade', cards });
    }
    if (d.act === 'go') return this.send({ type: 'go' });
    if (d.act === 'endAttack') {
      this.from = this.to = null;
      return this.send({ type: 'endAttack' });
    }
    if (d.act === 'end') {
      this.from = this.to = null;
      return this.send({ type: 'end' });
    }
  }

  private send(a: Action) {
    const seat = this.mine();
    if (seat == null || this.busy) return;
    Sound.unlock();
    this.ctx.act(seat, a);
  }

  private say(text: string) {
    const el = h(`<div class="gk-say">${esc(text)}</div>`);
    this.float.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }
}

const strip = (s: string) => s.replace(/<[^>]+>/g, '');
const padDice = (d: number[], n: number) => [...d, ...Array(n - d.length).fill(1)];

function arrow(a: number, b: number, color: string, thin = false): string {
  const [x1, y1] = tokXY(a);
  const [x2, y2] = tokXY(b);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const sx = x1 + ux * 60;
  const sy = y1 + uy * 60;
  const ex = x2 - ux * 70;
  const ey = y2 - uy * 70;
  const w = thin ? 9 : 16;
  return `<g class="gk-arrow" opacity="${thin ? 0.85 : 0.95}"><line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" ${thin ? 'stroke-dasharray="26 16"' : ''}/>
    <path d="M${ex + ux * 34} ${ey + uy * 34} L${ex - uy * 26} ${ey + ux * 26} L${ex + uy * 26} ${ey - ux * 26} Z" fill="${color}"/></g>`;
}

export function createView(): GameView<State, Event> {
  return new GalaktikaView();
}

/* «Бородино» — отрисовка. Карта — скан поля (public/borodino/map.webp) под камерой больших полей; фишки — вырезанные со скана листа фишек
 * (public/borodino/counters.webp, лицо/оборот). Поверх — SVG-подсветка клеток: куда можно пойти, кого атаковать, кто обязан атаковать.
 * Касание своей фишки — выбор (повторное касание стопки — командующий); касание клетки — ход; касание врага в фазе боя — окно атаки. */
import { Sound } from '../../core/audio';
import { BoardCam, type CamPoint } from '../../core/boardcam';
import { DiceTray } from '../../core/dice';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { center, label, terrainName, villageName } from './hex';
import { alive, at, canJoin, canTarget, clock, CRT_COLS, CRT_TABLE, crtCol, deployOk, isCombat, leader, obliged, odds, reach, side, U, type Action, type Event, type State } from './engine';
import { GRID, MAP_H, MAP_W, SPRITE, SPRITE_IDS } from './terrain';
import { RUSSIAN_TOTAL } from './units';
import './borodino.css';

const BASE = `${import.meta.env.BASE_URL}borodino/`;
const px = (x: number) => (x / MAP_W) * 100 + '%';
const py = (y: number) => (y / MAP_H) * 100 + '%';
const R = GRID.dx / 1.5;
const HH = GRID.dy / 2;
function hexPoly(n: number, k = 1): string {
  const { x, y } = center(n);
  const r = R * k;
  const hh = HH * k;
  return `${x + r},${y} ${x + r / 2},${y + hh} ${x - r / 2},${y + hh} ${x - r},${y} ${x - r / 2},${y - hh} ${x + r / 2},${y - hh}`;
}
const face = (i: number, dem: boolean) => {
  const k = SPRITE_IDS.indexOf(U[i].id);
  const c = k % SPRITE.cols;
  const r = Math.floor(k / SPRITE.cols) * 2 + (dem ? 1 : 0);
  return `background-position:${(c / (SPRITE.cols - 1)) * 100}% ${(r / (SPRITE.rows * 2 - 1)) * 100}%`;
};
const kindName = (i: number) => ({ inf: 'пехота', cav: 'кавалерия', art: 'артиллерия', cmd: 'командующий' })[U[i].kind];

class BorodinoView implements GameView<State, Event> {
  private ctx!: ViewCtx<Action>;
  private v: State | null = null;
  private wrap!: HTMLElement;
  private board!: HTMLElement;
  private svg!: SVGSVGElement;
  private tokens!: HTMLElement;
  private stage!: HTMLElement;
  private float!: HTMLElement;
  private panel!: HTMLElement;
  private tray!: DiceTray;
  private cam!: BoardCam;
  private els = new Map<number, HTMLElement>();
  private interactive: number[] = [];
  private busy = false;
  private sel: number | null = null;
  private target: number | null = null;
  private att = new Set<number>();
  private info: number | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="bd-wrap"><div class="bd-board">
        <img class="bd-img" alt="карта Бородинского поля" draggable="false" src="${BASE}map.webp">
        <svg class="bd-svg" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="none"></svg>
        <div class="bd-tokens"></div>
      </div>
      <div class="bd-stage bc-ui"></div>
      <div class="bd-float"></div></div>`);
    root.appendChild(this.wrap);
    this.board = this.wrap.querySelector('.bd-board') as HTMLElement;
    this.svg = this.wrap.querySelector('.bd-svg') as unknown as SVGSVGElement;
    this.tokens = this.wrap.querySelector('.bd-tokens') as HTMLElement;
    this.stage = this.wrap.querySelector('.bd-stage') as HTMLElement;
    this.float = this.wrap.querySelector('.bd-float') as HTMLElement;
    this.cam = new BoardCam(this.wrap, this.board, {
      w: MAP_W,
      h: MAP_H,
      mini: `${BASE}map-small.webp`,
      src: MAP_W,
      token: 0.022,
      followKey: 'borodino.follow',
      demo: ctx.demo,
      speed: () => this.ctx.speed(),
      dots: () => [],
      turn: () => this.turnPoints(),
    });
    const img = this.wrap.querySelector('.bd-img') as HTMLImageElement;
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
    const ctl = h(`<div class="bd-ctl"><div class="bd-tray"></div><div class="bd-panel"></div></div>`);
    ctx.controls.appendChild(ctl);
    this.tray = new DiceTray(ctl.querySelector('.bd-tray') as HTMLElement, 1);
    this.tray.show(null);
    this.panel = ctl.querySelector('.bd-panel') as HTMLElement;
    this.panel.addEventListener('click', (e) => this.onPanel(e));
  }

  private turnPoints(): CamPoint[] {
    const v = this.v;
    if (!v) return [];
    const c = v.last?.combat;
    if (c) return [...c.att, c.def].filter((i) => alive(v, i)).map((i) => center(v.u[i].hex));
    if (v.last?.move) return v.last.move.map((n) => center(n));
    // своя армия целиком
    const pts = U.map((_, i) => i)
      .filter((i) => side(i) === v.side && alive(v, i))
      .map((i) => center(v.u[i].hex));
    return pts.length ? pts : [{ x: MAP_W / 2, y: MAP_H / 2 }];
  }

  setView(v: State) {
    this.v = v;
    this.render();
  }

  setTurn(_toAct: number[], interactive: number[]) {
    const was = this.mine();
    this.interactive = interactive;
    if (!this.mine()) {
      this.sel = null;
      this.target = null;
    }
    this.render();
    if (!was && this.mine() && this.v) {
      this.cam.release();
      void this.cam.frame(this.turnPoints(), []);
    }
  }

  private mine(): boolean {
    const v = this.v;
    return !!v && v.phase !== 'over' && !this.ctx.demo && this.interactive.includes(v.side) && !this.busy;
  }

  async play(events: Event[], v: State) {
    const speed = this.ctx.speed();
    this.busy = true;
    this.stage.textContent = '';
    const sh = this.v ? (JSON.parse(JSON.stringify(this.v)) as State) : v;
    this.v = sh;
    for (const ev of events) {
      switch (ev.type) {
        case 'move':
        case 'retreat': {
          const path = ev.path;
          await this.cam.frame([center(path[0]), center(path[path.length - 1])], []);
          const group = sh.u.map((_, i) => i).filter((i) => sh.u[i].hex === path[0] && (i === ev.u || (U[i].kind === 'cmd' && side(i) === side(ev.u) && isCombat(ev.u))));
          for (const n of path.slice(1)) {
            for (const i of group) sh.u[i].hex = n;
            this.placeTokens();
            Sound.step();
            await sleep(140 / speed);
          }
          if (ev.type === 'retreat') sh.u[ev.u].dem = true;
          this.renderTokens();
          await sleep(120 / speed);
          break;
        }
        case 'pursue':
          for (const i of at(sh, sh.u[ev.u].hex)) if (i === ev.u || (U[i].kind === 'cmd' && side(i) === side(ev.u))) sh.u[i].hex = ev.to;
          this.placeTokens();
          Sound.step();
          await sleep(250 / speed);
          break;
        case 'wheels':
          sh.u[ev.u].dem = ev.on;
          this.renderTokens();
          Sound.place();
          await sleep(200 / speed);
          break;
        case 'combat': {
          const c = ev.log;
          await this.cam.frame([...c.att, c.def].map((i) => center(sh.u[i].hex)), []);
          this.flash(c.def, 'hit');
          for (const i of c.att) this.flash(i, 'atk');
          await this.tray.roll([c.roll], speed);
          this.say(`${ev.a} : ${ev.d} → ${c.res}`);
          if (c.res.startsWith('З') || c.res === '*') Sound.capture();
          else Sound.nomove();
          await sleep(700 / speed);
          break;
        }
        case 'hold':
          this.say(`${U[ev.cmd].name}: «Ни шагу назад!»`);
          await sleep(700 / speed);
          break;
        case 'dead':
          this.flash(ev.u, 'dead');
          await sleep(400 / speed);
          sh.u[ev.u].out = 'dead';
          sh.u[ev.u].hex = -1;
          this.renderTokens();
          break;
        case 'wound':
          if (ev.res !== 'ok') {
            this.say(`${U[ev.u].name} — ${ev.res === 'dead' ? 'убит' : ev.res === 'wounded' ? 'тяжело ранен' : 'легко ранен'}`);
            sh.u[ev.u].hex = -1;
            sh.u[ev.u].out = ev.res;
            this.renderTokens();
            await sleep(900 / speed);
          }
          break;
        case 'captured':
          this.say(`${U[ev.u].name} взят в плен`);
          sh.u[ev.u].hex = -1;
          sh.u[ev.u].out = 'captured';
          this.renderTokens();
          await sleep(800 / speed);
          break;
        case 'rally':
          for (const r of ev.rolls) {
            if (r.ok) sh.u[r.u].dem = false;
          }
          if (ev.rolls.length) {
            await this.tray.roll([ev.rolls[ev.rolls.length - 1].roll], speed);
            this.say(`Пришли в себя: ${ev.rolls.filter((r) => r.ok).length} из ${ev.rolls.length}`);
          }
          this.renderTokens();
          await sleep(500 / speed);
          break;
        case 'phase':
          if (ev.phase === 'rally' || ev.phase === 'move') {
            this.say(`${clock(ev.turn)} — ${ev.side === 0 ? 'ходят французы' : 'ходят русские'}`);
            Sound.turn();
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
    if (this.sel != null && (!alive(v, this.sel) || side(this.sel) !== v.side)) this.sel = null;
    if (this.target != null && !canTarget(v, this.target)) this.target = null;
    this.att = new Set([...this.att].filter((i) => this.target != null && canJoin(v, i, this.target) === null));
    this.render();
  }

  status(v: State, _toAct: number[], interactive: number[]) {
    if (v.result) return esc(v.result.text);
    const me = interactive.includes(v.side);
    const who = v.side === 0 ? 'французы' : 'русские';
    if (!me) return `${clock(v.turn)} — ходят ${who}…`;
    switch (v.phase) {
      case 'deploy':
        return 'Расстановка: выберите часть и клетку, потом «Готово»';
      case 'rally':
        return 'Приведите деморализованные части в боевое состояние';
      case 'move':
        return 'Передвижение: выберите часть и клетку (каждая — один раз)';
      case 'combat': {
        const o = obliged(v).length;
        return o ? `Сражения: обязаны атаковать — ${o}` : 'Сражения: выберите врага для атаки или закончите фазу';
      }
      case 'pursue':
        return 'Преследовать отступившего?';
    }
    return '';
  }

  playerStats(v: State, seat: number) {
    const own = U.map((_, i) => i).filter((i) => side(i) === seat && isCombat(i));
    const live = own.filter((i) => alive(v, i));
    const str = live.reduce((a, i) => a + U[i].str, 0);
    const dem = live.filter((i) => v.u[i].dem && U[i].kind !== 'art').length;
    return `⚔ ${str} · потери ${v.losses[seat]}${dem ? ` · деморализ. ${dem}` : ''}`;
  }

  destroy() {
    this.cam.destroy();
  }

  // ---------- отрисовка ----------

  private render() {
    if (!this.v) return;
    this.renderTokens();
    this.renderSvg();
    this.renderPanel();
    if (!this.busy) this.renderStage();
  }

  private renderTokens() {
    const v = this.v!;
    for (let i = 0; i < U.length; i++) {
      let el = this.els.get(i);
      if (!alive(v, i)) {
        if (el) {
          el.remove();
          this.els.delete(i);
        }
        continue;
      }
      if (!el) {
        el = h(`<div class="bd-tok ${U[i].kind === 'cmd' ? 'cmd' : ''} side${side(i)}" data-u="${i}"><i></i></div>`);
        this.tokens.appendChild(el);
        this.els.set(i, el);
      }
      (el.firstChild as HTMLElement).setAttribute('style', face(i, v.u[i].dem && U[i].kind !== 'cmd'));
      el.classList.toggle('sel', this.sel === i);
      el.classList.toggle('att', this.att.has(i));
      el.classList.toggle('tgt', this.target === i);
      el.classList.toggle('done', side(i) === v.side && v.phase === 'move' && v.u[i].moved);
    }
    this.placeTokens();
  }

  private placeTokens() {
    const v = this.v!;
    for (const [i, el] of this.els) {
      const n = v.u[i].hex;
      if (n < 0) continue;
      const c = center(n);
      const cmd = U[i].kind === 'cmd';
      const shared = cmd && at(v, n).some((j) => isCombat(j));
      el.style.left = px(c.x + (shared ? R * 0.42 : 0));
      el.style.top = py(c.y - (shared ? HH * 0.45 : 0));
    }
  }

  private renderSvg() {
    const v = this.v!;
    let s = '';
    const mine = this.mine();
    if (v.last?.move) {
      const [a, b] = v.last.move.map((n) => center(n));
      s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="bd-trail"/>`;
    }
    if (mine && this.sel != null && v.phase === 'move') {
      for (const n of reach(v, this.sel).keys()) s += `<polygon points="${hexPoly(n, 0.92)}" class="bd-can"/>`;
    }
    if (mine && this.sel != null && v.phase === 'deploy') {
      // клетки расстановки не перебираем все — только соседство в 4 клетках
      const h0 = v.u[this.sel].hex;
      for (let n = 0; n < 1200; n++) if (deployOk(v, this.sel, n) && Math.abs(center(n).x - center(h0).x) < GRID.dx * 6 && Math.abs(center(n).y - center(h0).y) < GRID.dy * 6) s += `<polygon points="${hexPoly(n, 0.92)}" class="bd-can"/>`;
    }
    if (mine && v.phase === 'combat') {
      for (const i of obliged(v)) s += `<polygon points="${hexPoly(v.u[i].hex, 0.98)}" class="bd-must"/>`;
      for (let e = 0; e < U.length; e++) {
        if (!canTarget(v, e)) continue;
        if (U.some((_, i) => canJoin(v, i, e) === null)) s += `<polygon points="${hexPoly(v.u[e].hex, 0.98)}" class="bd-tg"/>`;
      }
    }
    if (v.phase === 'pursue' && v.pursuit) s += `<polygon points="${hexPoly(v.pursuit.hex, 0.95)}" class="bd-can"/>`;
    if (this.info != null && alive(v, this.info)) s += `<polygon points="${hexPoly(v.u[this.info].hex)}" class="bd-info"/>`;
    this.svg.innerHTML = s;
  }

  private renderPanel() {
    const v = this.v!;
    const mine = this.mine();
    const lossPct = Math.round((v.losses[1] / RUSSIAN_TOTAL) * 100);
    let html = `<div class="bd-clock"><b>${clock(Math.min(v.turn, v.cfg.turns))}</b> · ход ${Math.min(v.turn, v.cfg.turns)} из ${v.cfg.turns}</div>
      <div class="bd-loss"><div class="bd-bar"><i style="width:${Math.min(100, lossPct)}%"></i><span style="left:25%"></span><span style="left:35%"></span><span style="left:50%"></span></div>
      <small>Потери русских: <b>${v.losses[1]}</b> из ${RUSSIAN_TOTAL} (${lossPct}%) · французов: ${v.losses[0]}</small></div>`;
    if (mine) {
      if (v.phase === 'rally') html += `<button class="btn primary" data-act="rally" data-tap>Бросить кубики за деморализованных</button>`;
      if (v.phase === 'move') html += `<button class="btn" data-act="endMove">Закончить передвижение</button>`;
      if (v.phase === 'combat') html += `<button class="btn" data-act="endCombat" ${obliged(v).length ? 'disabled' : ''}>Закончить сражения</button>`;
      if (v.phase === 'deploy') html += `<button class="btn primary" data-act="ready">Готово</button>`;
      const i = this.sel;
      if (i != null && v.phase === 'move' && U[i].kind === 'art' && alive(v, i))
        html += `<button class="btn" data-act="wheels">${v.u[i].dem ? 'К бою' : 'На колёса (2 очка)'}</button>`;
    }
    const show = this.sel ?? this.info;
    if (show != null && alive(v, show)) html += `<div class="bd-unit">${this.unitHtml(show)}</div>`;
    this.panel.innerHTML = html;
  }

  private unitHtml(i: number): string {
    const v = this.v!;
    const d = U[i];
    const st = v.u[i];
    const n = st.hex;
    const vil = villageName(n);
    if (d.kind === 'cmd') return `<b>${esc(d.name)}</b><br><small>рейтинг ${d.str}, движение ${d.mp} · клетка ${label(n)}</small>`;
    const L = leader(v, i);
    return `<b>${esc(d.name)}</b><br><small>${kindName(i)}, корпус ${esc(d.corps.replace('+', ', '))} · ${
      d.kind === 'art' ? (st.dem ? `на колёсах: защита ${d.str2}, движение ${d.mp2}` : `к бою: сила ${d.str}`) : st.dem ? `деморализована: ${d.str2}/${d.mp2}` : `сила ${d.str}, движение ${d.mp}`
    }${L >= 0 ? ` · с ним ${esc(U[L].name)} (+${U[L].str})` : ''}<br>клетка ${label(n)}${vil ? ` (${vil})` : ''}: ${terrainName(n)}${side(i) === v.side && v.phase === 'move' && !st.moved ? ` · очков: ${st.mp}` : ''}</small>`;
  }

  private renderStage() {
    const v = this.v!;
    const st = this.stage;
    if (v.result) {
      st.innerHTML = `<div class="bd-box"><div class="bd-q big">🏆 ${v.result.winners.map((s) => this.ctx.name(s)).join(', ')}</div><div class="bd-q">${esc(v.result.text)}</div></div>`;
      return;
    }
    if (!this.mine()) {
      st.textContent = '';
      return;
    }
    if (v.phase === 'pursue' && v.pursuit) {
      st.innerHTML = `<div class="bd-box"><div class="bd-q">Преследовать в клетку ${label(v.pursuit.hex)}?</div><div class="bd-btns">${v.pursuit.units
        .map((i) => `<button class="btn primary" data-pursue="${i}">${esc(U[i].name)}</button>`)
        .join('')}<button class="btn" data-pursue="-1">Не преследовать</button></div></div>`;
      return;
    }
    if (v.phase === 'combat' && this.target != null && canTarget(v, this.target)) {
      const t = this.target;
      const all = U.map((_, i) => i).filter((i) => canJoin(v, i, t) === null);
      const att = [...this.att].filter((i) => all.includes(i));
      const o = att.length ? odds(v, att, t) : null;
      const colN = o ? crtCol(o.diff) : -1;
      st.innerHTML = `<div class="bd-box"><div class="bd-q">Атака на <b>${esc(U[t].name)}</b></div>
        <div class="bd-list">${all
          .map((i) => `<button class="bd-pick ${this.att.has(i) ? 'on' : ''}" data-pick="${i}"><i style="${face(i, false)}"></i><span>${esc(U[i].name)}<small>${U[i].str}${obliged(v).includes(i) ? ' · обязана' : ''}</small></span></button>`)
          .join('')}</div>
        ${
          o
            ? `<div class="bd-q">${o.a} против ${o.d} (${o.diff > 0 ? '+' : ''}${o.diff}) — столбец ${CRT_COLS[colN]}${o.parts.length ? `<br><small>у защиты: ${o.parts.join(', ')}</small>` : ''}</div>
          <div class="bd-row">${CRT_TABLE.map((r, k) => `<span class="r${r[colN].replace('*', 'x')}"><b>${k + 1}</b>${r[colN]}</span>`).join('')}</div>`
            : '<div class="bd-q dim">Выберите, кто атакует</div>'
        }
        <div class="bd-btns"><button class="btn primary" data-attack ${att.length ? '' : 'disabled'}>Атаковать</button><button class="btn" data-close>Отмена</button></div></div>`;
      return;
    }
    st.textContent = '';
  }

  private flash(i: number, cls: string) {
    const el = this.els.get(i);
    if (!el) return;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 900);
  }

  // ---------- касания ----------

  private hexAtPoint(e: MouseEvent): number {
    const { x, y } = this.cam.toImg(e.clientX, e.clientY);
    const c = Math.round((x - GRID.x0) / GRID.dx) + 1;
    let best = -1;
    let bd = Infinity;
    for (let cc = c - 1; cc <= c + 1; cc++) {
      if (cc < 1 || cc > 40) continue;
      const off = cc % 2 === 0 ? GRID.dy / 2 : 0;
      const r = Math.round((y - GRID.y0 - off) / GRID.dy) + 1;
      for (let rr = r - 1; rr <= r + 1; rr++) {
        if (rr < 1 || rr > 30) continue;
        const n = (cc - 1) * 30 + rr - 1;
        const p = center(n);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
    }
    return best;
  }

  private onBoard(e: MouseEvent) {
    const v = this.v;
    if (!v || this.busy || (e.target as HTMLElement).closest('.bd-box, .bc-cam, .bc-mini')) return;
    const n = this.hexAtPoint(e);
    if (n < 0) return;
    const here = at(v, n);
    const mine = this.mine();
    const own = here.filter((i) => side(i) === v.side);
    const foe = here.filter((i) => side(i) !== v.side && isCombat(i));
    if (mine && v.phase === 'combat') {
      if (foe.length && canTarget(v, foe[0])) {
        this.target = foe[0];
        this.att = new Set(U.map((_, i) => i).filter((i) => canJoin(v, i, foe[0]) === null && this.isAdjacentOrArt(i, foe[0])));
        return this.render();
      }
      if (own.length && this.target != null) {
        const i = own.find((j) => isCombat(j));
        if (i != null && canJoin(v, i, this.target) === null) {
          if (this.att.has(i)) this.att.delete(i);
          else this.att.add(i);
          return this.render();
        }
      }
    }
    if (mine && (v.phase === 'move' || v.phase === 'deploy')) {
      if (this.sel != null && !own.includes(this.sel)) {
        if (v.phase === 'move' && reach(v, this.sel).has(n)) return this.send({ type: 'move', u: this.sel, to: n });
        if (v.phase === 'deploy' && deployOk(v, this.sel, n)) return this.send({ type: 'deploy', u: this.sel, to: n });
      }
      if (own.length) {
        const order = [...own.filter((i) => isCombat(i)), ...own.filter((i) => !isCombat(i))];
        const k = this.sel != null ? order.indexOf(this.sel) : -1;
        this.sel = order[(k + 1) % order.length];
        this.info = null;
        return this.render();
      }
    }
    // справка о чужой фишке или клетке
    this.info = here.find((i) => isCombat(i)) ?? here[0] ?? null;
    if (!own.length) this.sel = mine && v.phase === 'move' ? this.sel : null;
    this.render();
  }

  private isAdjacentOrArt(i: number, _t: number) {
    return U[i].kind !== 'cmd';
  }

  private onStage(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    e.stopPropagation();
    const d = b.dataset;
    if (d.close != null) {
      this.target = null;
      this.att.clear();
      return this.render();
    }
    if (d.pick) {
      const i = Number(d.pick);
      if (this.att.has(i)) this.att.delete(i);
      else this.att.add(i);
      return this.render();
    }
    if (d.attack != null && this.target != null) {
      const a: Action = { type: 'attack', def: this.target, att: [...this.att] };
      this.target = null;
      this.att.clear();
      return this.send(a);
    }
    if (d.pursue != null) {
      const u = Number(d.pursue);
      return this.send({ type: 'pursue', u: u < 0 ? null : u });
    }
  }

  private onPanel(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === 'rally' || a === 'endMove' || a === 'endCombat' || a === 'ready') {
      this.sel = null;
      this.target = null;
      return this.send({ type: a } as Action);
    }
    if (a === 'wheels' && this.sel != null) return this.send({ type: 'wheels', u: this.sel });
  }

  private send(a: Action) {
    const v = this.v;
    if (!v || !this.mine()) return;
    Sound.unlock();
    this.ctx.act(v.side, a);
  }

  private say(text: string) {
    const el = h(`<div class="bd-say">${esc(text)}</div>`);
    this.float.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }
}

export function createView(): GameView<State, Event> {
  return new BorodinoView();
}

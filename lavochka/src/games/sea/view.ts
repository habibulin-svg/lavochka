/* «Морские стратегии» — отрисовка: карта Голицына целиком с камерой, корабли — флажки-кружки с названиями из листа «Корабли»
 * (кольцо — цвет игрока), порты «Захвата колоний» — флажки владельцев с ценой и пробоинами. Вертушка — роза ветров в панели:
 * восемь румбов (N, NO, O, SO, S, SW, W, NW), узкие жёлтые (штиль) и красные (ураган) секторы.
 * Управление: коснуться своего корабля — подсвечиваются клетки, куда он дойдёт этим ветром, и цели в пределах выстрела. */
import { Sound } from '../../core/audio';
import { BoardCam, type CamPoint } from '../../core/boardcam';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import {
  AMMO,
  busy,
  canRepairAt,
  colonies,
  mapOf,
  points,
  portStrength,
  reach,
  seatNow,
  shipsOf,
  sinkAt,
  targetsOf,
  type Action,
  type Event,
  type State,
  type Target,
} from './engine';
import { MAPS, cellAt, cellSize, cellXY, cheb, portAt, type SeaMap } from './maps';
import { CALM_FROM, CALM_TO, STORM_FROM, STORM_TO } from './spinner';
import { POINT_NAMES } from './wind';
import './sea.css';

const LETTERS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
const tKey = (t: Target) => ('ship' in t ? 's' + t.ship : 'p' + t.port);

/** Роза ветров вертушки (SVG). */
function roseSvg(): string {
  const R = 100;
  const pol = (a: number, r: number) => [Math.sin((a * Math.PI) / 180) * r, -Math.cos((a * Math.PI) / 180) * r];
  const wedge = (a0: number, a1: number, r0: number, r1: number, fill: string) => {
    const [x0, y0] = pol(a0, r1);
    const [x1, y1] = pol(a1, r1);
    const [x2, y2] = pol(a1, r0);
    const [x3, y3] = pol(a0, r0);
    return `<path d="M${x0},${y0} A${r1},${r1} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3} Z" fill="${fill}"/>`;
  };
  let s = `<circle r="${R}" fill="#d9c79a" stroke="#3a2a10" stroke-width="3"/>`;
  for (let k = 0; k < 8; k++) {
    const a = k * 45;
    s += wedge(a + CALM_FROM, a + CALM_TO, 34, 84, '#f2c419');
    s += wedge(a + STORM_FROM, a + STORM_TO, 34, 84, '#d8371f');
  }
  // восьмиконечная звезда румбов
  for (let k = 0; k < 8; k++) {
    const a = k * 45;
    const [tx, ty] = pol(a, 98);
    const [lx, ly] = pol(a - 12, 72);
    const [rx, ry] = pol(a + 12, 72);
    s += `<path d="M${tx},${ty} L${lx},${ly} L${rx},${ry} Z" fill="#1d1a14"/>`;
    const [cx, cy] = pol(a, 82);
    s += `<text x="${cx}" y="${cy}" transform="rotate(${a} ${cx} ${cy})" class="sea-rl">${LETTERS[k]}</text>`;
  }
  s += `<circle r="34" fill="#efe3c0" stroke="#3a2a10" stroke-width="2"/>`;
  return `<svg class="sea-rose" viewBox="-104 -104 208 208">${s}
    <g class="sea-needle"><path d="M0,-92 L7,0 L0,10 L-7,0 Z" fill="#6a3a10" stroke="#2a1806" stroke-width="1.5"/><path d="M0,-92 L7,0 L0,0 Z" fill="#c88a3a"/>
    <circle r="9" fill="#a06010" stroke="#2a1806" stroke-width="2"/></g></svg>`;
}

class SeaView implements GameView<State, Event> {
  private ctx!: ViewCtx<Action>;
  private v: State | null = null;
  private m: SeaMap = MAPS.piraty;
  private wrap!: HTMLElement;
  private board!: HTMLElement;
  private img!: HTMLImageElement;
  private marks!: HTMLElement;
  private shipsEl!: HTMLElement;
  private float!: HTMLElement;
  private panel!: HTMLElement;
  private spinBtn!: HTMLButtonElement;
  private needle!: SVGGElement;
  private windEl!: HTMLElement;
  private mine!: HTMLElement;
  private tokens = new Map<number, HTMLElement>();
  /** Где корабль показан сейчас (во время анимации отличается от состояния). */
  private pos = new Map<number, { x: number; y: number }>();
  private interactive: number[] = [];
  private busy = false;
  private sel: number | null = null;
  private cam!: BoardCam;
  private angle = 0;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="sea-wrap"><div class="sea-board">
        <img class="sea-img" alt="карта" draggable="false">
        <div class="sea-marks"></div>
        <div class="sea-ships"></div>
      </div>
      <div class="sea-float"></div></div>`);
    root.appendChild(this.wrap);
    this.board = this.wrap.querySelector('.sea-board') as HTMLElement;
    this.img = this.wrap.querySelector('.sea-img') as HTMLImageElement;
    this.marks = this.wrap.querySelector('.sea-marks') as HTMLElement;
    this.shipsEl = this.wrap.querySelector('.sea-ships') as HTMLElement;
    this.float = this.wrap.querySelector('.sea-float') as HTMLElement;
    this.panel = h(`<div class="sea-panel">
        <div class="sea-spinner">${roseSvg()}<div class="sea-wind"></div></div>
        <button class="btn primary sea-spin" data-tap hidden>Крутить вертушку</button>
        <div class="sea-mine"></div>
      </div>`);
    ctx.controls.appendChild(this.panel);
    this.spinBtn = this.panel.querySelector('.sea-spin') as HTMLButtonElement;
    this.needle = this.panel.querySelector('.sea-needle') as SVGGElement;
    this.windEl = this.panel.querySelector('.sea-wind') as HTMLElement;
    this.mine = this.panel.querySelector('.sea-mine') as HTMLElement;
    this.spinBtn.onclick = () => this.send({ type: 'spin' });
    this.mine.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
      if (!el) return;
      const a = JSON.parse(el.dataset.a!) as Action;
      this.send(a);
    });
    this.mine.addEventListener('pointerover', (e) => {
      const el = (e.target as HTMLElement).closest('[data-ship]') as HTMLElement | null;
      if (el) this.tokens.get(Number(el.dataset.ship))?.classList.add('hl');
    });
    this.mine.addEventListener('pointerout', () => this.tokens.forEach((t) => t.classList.remove('hl')));
    this.wrap.addEventListener('click', (e) => this.onBoard(e));
  }

  private setMap(m: SeaMap) {
    const first = !this.cam;
    if (!first && this.m.id === m.id) return;
    this.m = m;
    this.board.style.setProperty('--cell', (cellSize(m) / m.imgW) * 100 + '%');
    this.board.classList.remove('ready');
    this.img.src = m.img;
    if (first) {
      this.cam = new BoardCam(this.wrap, this.board, {
        w: m.imgW,
        h: m.imgH,
        mini: m.mini,
        src: m.srcW,
        token: 0.019,
        followKey: 'sea.follow',
        demo: this.ctx.demo,
        speed: () => this.ctx.speed(),
        dots: () => (this.v ? this.v.ships.filter((s) => !s.sunk).map((s) => ({ key: s.id, ...this.xy(s.id), color: SEATS[s.owner].color, on: s.owner === this.actor() })) : []),
        turn: () => this.turnPoints(),
      });
    } else this.cam.setMini(m.mini);
    this.ctx.hold?.(8000);
    const ready = () => {
      this.board.classList.add('ready');
      this.ctx.hold?.(0);
      this.cam.shown();
    };
    if (this.img.complete && this.img.naturalWidth && this.img.src.endsWith(m.img)) ready();
    else this.img.onload = ready;
  }

  private xy(id: number): CamPoint {
    const p = this.pos.get(id) ?? this.v!.ships[id];
    return cellXY(this.m, p.x, p.y);
  }

  private actor() {
    const v = this.v;
    if (!v || v.result) return -1;
    return v.phase === 'gold' ? v.seats.find((x) => v.side[x] === 'es')! : seatNow(v);
  }

  private turnPoints(): CamPoint[] {
    const v = this.v;
    if (!v || v.result) return [];
    const own = shipsOf(v, this.actor());
    return (own.length ? own : v.ships.filter((s) => !s.sunk)).map((s) => this.xy(s.id));
  }

  setView(v: State) {
    this.v = v;
    this.setMap(mapOf(v));
    this.pos.clear();
    if (v.wind) this.turnNeedle(v.wind.angle, false);
    this.render();
  }

  async play(events: Event[], v: State) {
    const speed = this.ctx.speed();
    this.busy = true;
    this.sel = null;
    this.setMap(mapOf(v));
    // во время анимации корабли стоят там, где были
    if (this.v) for (const s of this.v.ships) this.pos.set(s.id, { x: s.x, y: s.y });
    const prev = this.v;
    this.v = { ...v, ships: v.ships.map((s) => ({ ...s, sunk: prev?.ships[s.id]?.sunk ?? s.sunk })) };
    this.render();
    for (const ev of events) {
      switch (ev.t) {
        case 'spin':
          Sound.shuffle();
          await this.turnNeedle(ev.spin.angle, true);
          this.say(ev.spin.weather === 'calm' ? 'Штиль' : ev.spin.weather === 'storm' ? `Ураган с ${POINT_NAMES[ev.spin.from]}а!` : `Ветер с ${POINT_NAMES[ev.spin.from]}а`);
          this.showWind(ev.spin);
          await sleep(500 / speed);
          break;
        case 'move':
        case 'drift': {
          const path = ev.t === 'move' ? ev.path : ev.to ? [ev.to] : [];
          if (ev.t === 'drift' && !path.length) {
            if (ev.shore || ev.stay) this.boom(this.xy(ev.ship), ev.wreck ? '💥' : '🌊');
            if (ev.respin) await this.turnNeedle(ev.respin.angle, true);
            if (ev.wreck) {
              Sound.nomove();
              this.markSunk(ev.ship, !ev.derelict);
            }
            await sleep(500 / speed);
            break;
          }
          const el = this.tokens.get(ev.ship);
          await this.cam.frame([this.xy(ev.ship), cellXY(this.m, path[path.length - 1].x, path[path.length - 1].y)], []);
          el?.classList.add('lifted');
          for (const p of path) {
            this.pos.set(ev.ship, p);
            this.placeShips();
            Sound.step();
            await sleep(230 / speed);
          }
          el?.classList.remove('lifted');
          Sound.place();
          break;
        }
        case 'shot': {
          const to = 'ship' in ev.target ? this.xy(ev.target.ship) : cellXY(this.m, this.m.ports[ev.target.port].x, this.m.ports[ev.target.port].y);
          await this.cam.frame([...ev.ships.map((id) => this.xy(id)), to], []);
          for (const id of ev.ships) this.tokens.get(id)?.classList.add('fire');
          Sound.shuffle();
          await this.turnNeedle(ev.spin.angle, true);
          for (const id of ev.ships) this.tokens.get(id)?.classList.remove('fire');
          this.boom(to, ev.holes ? '💥' : '💦');
          (ev.holes ? Sound.capture : Sound.nomove)();
          this.say(`${LETTERS[Math.round(ev.spin.angle / 45) % 8]} — ${ev.holes ? (ev.holes > 1 ? `попадание! пробоин: ${ev.holes}` : 'попадание!') : 'промах'}${ev.captured ? ' Золотой галион взят!' : ''}${ev.recaptured ? ' Галион отбит!' : ''}${ev.down ? ' Порт сбит!' : ''}`);
          if (ev.sunk && 'ship' in ev.target) this.markSunk(ev.target.ship, true);
          await sleep(900 / speed);
          break;
        }
        case 'portFire': {
          const p = this.m.ports[ev.port];
          await this.cam.frame([cellXY(this.m, p.x, p.y), this.xy(ev.ship)], []);
          await this.turnNeedle(ev.spin.angle, true);
          this.boom(this.xy(ev.ship), ev.spin.main ? '💥' : '💦');
          (ev.spin.main ? Sound.capture : Sound.nomove)();
          this.say(`Батареи ${p.name}: ${ev.spin.main ? 'попадание!' : 'промах'}`);
          if (ev.sunk) this.markSunk(ev.ship, true);
          await sleep(800 / speed);
          break;
        }
        case 'claim':
          Sound.win();
          this.say(`${this.ctx.name(ev.seat).replace(/<[^>]+>/g, '')}: ${this.m.ports[ev.port].name} — ${this.m.ports[ev.port].value} оч.`);
          await sleep(700 / speed);
          break;
        case 'salvage':
          this.say('Ничейный золотой галион взят на буксир!');
          await sleep(700 / speed);
          break;
        case 'repair':
          this.say(`Починка: ${ev.turns > 1 ? `${ev.turns} хода` : 'ход'}`);
          await sleep(400 / speed);
          break;
        case 'refloat':
          this.say('Корабль снялся с мели');
          await sleep(400 / speed);
          break;
        case 'end':
          Sound.win();
          break;
      }
    }
    this.v = v;
    this.pos.clear();
    this.busy = false;
    this.render();
  }

  private markSunk(id: number, sunk: boolean) {
    const el = this.tokens.get(id);
    el?.classList.add(sunk ? 'sinking' : 'wreck');
  }

  private async turnNeedle(angle: number, anim: boolean) {
    const cur = ((this.angle % 360) + 360) % 360;
    this.angle += (anim ? 720 : 0) + ((angle - cur + 360) % 360);
    this.needle.style.transitionDuration = anim ? `${1.4 / this.ctx.speed()}s` : '0s';
    this.needle.style.transform = `rotate(${this.angle}deg)`;
    if (anim) await sleep(1450 / this.ctx.speed());
  }

  private showWind(w: State['wind']) {
    if (!w) {
      this.windEl.innerHTML = '';
      return;
    }
    const cls = w.weather;
    this.windEl.innerHTML = `<span class="sea-w ${cls}">${w.weather === 'calm' ? 'штиль' : w.weather === 'storm' ? 'ураган' : 'свежий ветер'}</span> с ${POINT_NAMES[w.from]}а`;
  }

  setTurn(_toAct: number[], interactive: number[]) {
    const mine = interactive.length > 0 && !this.interactive.length;
    this.interactive = interactive;
    if (!interactive.length) this.sel = null;
    this.render();
    if (mine && this.v) {
      this.cam.release();
      void this.cam.frame(this.turnPoints(), []);
    }
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.result) return `${v.result.winners.length ? v.result.winners.map((s) => this.ctx.name(s)).join(', ') + ': ' : ''}${esc(v.result.text)}`;
    const who = toAct[0];
    const me = interactive.includes(who);
    const nm = this.ctx.name(who);
    if (v.phase === 'gold') return me ? 'Тайно выберите галион, на котором поплывёт золото' : `${nm} прячет золото…`;
    if (v.phase === 'spin') return me ? `Крутите вертушку (круг ${v.round})` : `Ходит ${nm}…`;
    return me ? 'Коснитесь своего корабля: ход по прямой и выстрел. Закончили — «Конец хода»' : `Ходит ${nm}…`;
  }

  playerStats(v: State, seat: number) {
    const own = v.ships.filter((s) => s.owner === seat && !s.sunk && !s.derelict);
    if (v.game === 'kolonii') return `<b>${points(v, seat)}</b> оч. · ⚓${colonies(v, seat)} · ⛵${own.length}`;
    const gold = own.some((s) => s.gold) ? ' · 💰' : '';
    return `${v.side[seat] === 'es' ? '✠ испанцы' : '☠ пираты'} · ⛵${own.length}${gold}`;
  }

  destroy() {
    this.cam?.destroy();
  }

  // ---------- отрисовка ----------

  private render() {
    const v = this.v;
    if (!v) return;
    this.syncShips();
    this.placeShips();
    this.renderMarks();
    this.renderPanel();
    this.showWind(v.wind);
  }

  private syncShips() {
    const v = this.v!;
    for (const s of v.ships) {
      let el = this.tokens.get(s.id);
      if (!el) {
        el = h(`<div class="sea-ship" data-ship="${s.id}"><div class="sea-disc" style="background-image:url(/sea/disc${s.disc}.webp)"></div><i class="sea-flag"></i><i class="sea-holes"></i></div>`);
        this.shipsEl.appendChild(el);
        this.tokens.set(s.id, el);
      }
      el.style.setProperty('--c', SEATS[s.owner].color);
      el.classList.toggle('sunk', !!s.sunk);
      el.classList.remove('sinking', 'wreck');
      el.classList.toggle('derelict', !!s.derelict);
      el.classList.toggle('gold', !!s.gold);
      el.classList.toggle('on', !v.result && s.owner === this.actor() && !s.sunk);
      el.classList.toggle('sel', this.sel === s.id);
      el.classList.toggle('done', v.phase === 'act' && s.owner === this.actor() && !!s.moved && !!s.shot);
      el.classList.toggle('ashore', !!s.ashore);
      (el.querySelector('.sea-flag') as HTMLElement).textContent = s.side === 'es' ? '✠' : s.side === 'pi' ? '☠' : '';
      (el.querySelector('.sea-holes') as HTMLElement).innerHTML =
        '<b></b>'.repeat(Math.min(s.hits, sinkAt(s))) + (busy(s) ? '<u>⚒</u>' : '') + (v.game === 'kolonii' && s.ammo < AMMO ? `<em>${s.ammo}</em>` : '');
      el.title = `«${s.name}»${s.cls === 'galleon' && v.game === 'piraty' ? ', галион' : s.cls === 'brig' ? ', бригантина' : ''} — ${this.ctx.name(s.owner).replace(/<[^>]+>/g, '')}${s.hits ? `, пробоин: ${s.hits}` : ''}`;
    }
  }

  private placeShips() {
    const v = this.v!;
    const by = new Map<string, number[]>();
    for (const s of v.ships) {
      if (s.sunk && !this.pos.has(s.id)) continue;
      const p = this.pos.get(s.id) ?? s;
      const k = p.x + ',' + p.y;
      by.set(k, [...(by.get(k) ?? []), s.id]);
    }
    const cs = cellSize(this.m);
    for (const [k, ids] of by) {
      const [x, y] = k.split(',').map(Number);
      const c = cellXY(this.m, x, y);
      ids.forEach((id, i) => {
        const n = ids.length;
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const r = n > 1 ? cs * 0.32 : 0;
        const el = this.tokens.get(id)!;
        el.style.left = ((c.x + Math.cos(a) * r) / this.m.imgW) * 100 + '%';
        el.style.top = ((c.y + Math.sin(a) * r) / this.m.imgH) * 100 + '%';
        el.classList.toggle('small', n > 1);
      });
    }
  }

  /** Подсветка: куда дойдёт выбранный корабль, по кому можно выстрелить; порты колоний. */
  private renderMarks() {
    const v = this.v!;
    const m = this.m;
    const pct = (p: CamPoint) => `left:${(p.x / m.imgW) * 100}%;top:${(p.y / m.imgH) * 100}%`;
    let html = '';
    if (v.game === 'kolonii')
      m.ports.forEach((p, i) => {
        const ps = v.ports[i];
        const c = cellXY(m, p.x, p.y);
        const need = portStrength(v, i);
        const col = ps.owner !== null ? SEATS[ps.owner].color : '';
        html += `<div class="sea-port ${ps.owner !== null ? 'own' : ''} ${ps.down ? 'down' : ''}" style="${pct(c)};${col ? `--c:${col}` : ''}" title="${esc(p.name)}: ${p.value} оч.">
          <b>${p.value}</b>${ps.dmg && !ps.down ? `<i>${ps.dmg}/${need}</i>` : ''}${ps.ammo ? `<em>+${ps.ammo}</em>` : ''}</div>`;
      });
    const mine = this.myTurn();
    if (mine && this.sel !== null) {
      const sh = v.ships[this.sel];
      for (const r of reach(v, sh)) html += `<div class="sea-dot" data-move='${JSON.stringify({ c: r.course, n: r.steps })}' style="${pct(cellXY(m, r.to.x, r.to.y))}"></div>`;
      for (const t of targetsOf(v, sh)) {
        const p = 'ship' in t ? this.xy(t.ship) : cellXY(m, m.ports[t.port].x, m.ports[t.port].y);
        html += `<div class="sea-aim" data-t='${JSON.stringify(t)}' style="${pct(p)}"></div>`;
      }
    }
    this.marks.innerHTML = html;
  }

  private myTurn() {
    const v = this.v;
    return !!v && !v.result && !this.busy && !this.ctx.demo && v.phase === 'act' && this.interactive.includes(this.actor());
  }

  private renderPanel() {
    const v = this.v!;
    const actor = this.actor();
    const mine = this.interactive.includes(actor) && !this.ctx.demo && !this.busy && !v.result;
    this.spinBtn.hidden = !(mine && v.phase === 'spin');
    if (!mine) {
      this.mine.innerHTML = this.legend();
      return;
    }
    const btn = (a: Action, label: string, cls = '', ship?: number) =>
      `<button class="btn ${cls}" data-a='${esc(JSON.stringify(a))}'${ship !== undefined ? ` data-ship="${ship}"` : ''}>${label}</button>`;
    if (v.phase === 'gold') {
      this.mine.innerHTML = `<div class="sea-h">На каком галионе золото?</div><div class="sea-btns">${v.ships
        .filter((s) => s.side === 'es')
        .map((s) => btn({ type: 'gold', ship: s.id }, `«${esc(s.name)}»`, 'primary', s.id))
        .join('')}</div><div class="sea-note">Пираты этого не увидят, пока не потопят галион.</div>`;
      return;
    }
    if (v.phase !== 'act') {
      this.mine.innerHTML = this.legend();
      return;
    }
    const own = shipsOf(v, actor);
    let html = '<div class="sea-list">';
    for (const s of own) {
      const can = [];
      if (!s.moved && reach(v, s).length) can.push('ход');
      if (targetsOf(v, s).length) can.push('выстрел');
      const st = busy(s) ? `чинится (${s.fix})` : s.ashore ? 'на мели' : can.length ? can.join(' и ') : 'готов';
      html += `<div class="sea-row ${this.sel === s.id ? 'sel' : ''}" data-ship="${s.id}" data-pick="${s.id}"><span class="sea-mini" style="background-image:url(/sea/disc${s.disc}.webp);--c:${SEATS[s.owner].color}"></span>
        <span>«${esc(s.name)}»${s.gold ? ' 💰' : ''}${s.hits ? ` <b class="sea-red">${'●'.repeat(s.hits)}</b>` : ''}</span><small>${st}</small></div>`;
    }
    html += '</div><div class="sea-btns">';
    // залпы: цель, до которой достают два корабля и больше
    const reachBy = new Map<string, { t: Target; ships: number[] }>();
    for (const s of own) for (const t of targetsOf(v, s)) {
      const k = tKey(t);
      const e = reachBy.get(k) ?? { t, ships: [] };
      e.ships.push(s.id);
      reachBy.set(k, e);
    }
    for (const { t, ships } of reachBy.values())
      if (ships.length > 1) html += btn({ type: 'shoot', ships, target: t }, `Залп ×${ships.length} по ${this.targetName(t)}`, 'warn');
    for (const s of own) {
      if (!busy(s) && canRepairAt(v, s)) html += btn({ type: 'repair', ship: s.id }, `Чинить «${esc(s.name)}»`, '', s.id);
      const p = portAt(this.m, s.x, s.y);
      if (v.game === 'kolonii' && p && v.ports[p.id].owner === actor) {
        if (s.ammo > 0) html += btn({ type: 'unload', ship: s.id }, `Сложить ${s.ammo} в ${esc(p.name)}`, '', s.id);
        if (s.ammo < AMMO && v.ports[p.id].ammo > 0) html += btn({ type: 'load', ship: s.id }, `Взять из ${esc(p.name)}`, '', s.id);
      }
    }
    if (v.game === 'kolonii')
      this.m.ports.forEach((p, i) => {
        const ps = v.ports[i];
        if (ps.owner !== actor || ps.down || ps.fired) return;
        for (const t of v.ships)
          if (!t.sunk && t.owner !== actor && !portAt(this.m, t.x, t.y) && cheb(t, p) <= 2) html += btn({ type: 'portShot', port: i, ship: t.id }, `${esc(p.name)} бьёт по «${esc(t.name)}»`, 'warn');
      });
    html += btn({ type: 'end' }, 'Конец хода', 'primary') + '</div>';
    this.mine.innerHTML = html;
    this.mine.querySelectorAll<HTMLElement>('[data-pick]').forEach((el) => (el.onclick = () => this.pick(Number(el.dataset.pick))));
  }

  private targetName(t: Target) {
    const v = this.v!;
    return 'ship' in t ? `«${esc(v.ships[t.ship].name)}»` : esc(this.m.ports[t.port].name);
  }

  private legend() {
    const v = this.v!;
    if (v.game === 'kolonii') {
      const rows = v.seats
        .slice()
        .sort((a, b) => points(v, b) - points(v, a))
        .map((s) => `<div class="sea-row"><span>${this.ctx.name(s)}</span><b>${points(v, s)} / ${v.o.target}</b></div>`)
        .join('');
      return `<div class="sea-h">Очки колоний</div><div class="sea-list">${rows}</div>`;
    }
    const known = v.ships.find((s) => s.gold);
    return `<div class="sea-note">${known ? `Золото — на «${esc(known.name)}»${known.side === 'pi' ? ', его ведут пираты' : ''}.` : 'На каком галионе золото, знают только испанцы.'}
      Испанцам — довести его в Кадикс, пиратам — увести на любую свою базу.</div>`;
  }

  private pick(id: number | null) {
    this.sel = this.sel === id ? null : id;
    if (this.sel !== null) {
      const s = this.v!.ships[this.sel];
      const pts = [this.xy(s.id), ...reach(this.v!, s).map((r) => cellXY(this.m, r.to.x, r.to.y))];
      void this.cam.frame(pts, [], true);
    }
    this.render();
  }

  private onBoard(e: MouseEvent) {
    const v = this.v;
    const t = e.target as HTMLElement;
    if (!v || t.closest('.bc-cam, .bc-mini')) return;
    if (!this.myTurn()) return;
    const dot = t.closest('[data-move]') as HTMLElement | null;
    if (dot && this.sel !== null) {
      const d = JSON.parse(dot.dataset.move!);
      const id = this.sel;
      this.sel = null;
      this.send({ type: 'move', ship: id, course: d.c, steps: d.n });
      return;
    }
    const aim = t.closest('[data-t]') as HTMLElement | null;
    if (aim && this.sel !== null) {
      const id = this.sel;
      this.sel = null;
      this.send({ type: 'shoot', ships: [id], target: JSON.parse(aim.dataset.t!) });
      return;
    }
    const tok = t.closest('.sea-ship') as HTMLElement | null;
    let id = tok ? Number(tok.dataset.ship) : null;
    if (id === null) {
      const p = this.cam.toImg(e.clientX, e.clientY);
      const c = cellAt(this.m, p.x, p.y);
      if (c) id = shipsOf(v, this.actor()).find((s) => s.x === c.x && s.y === c.y)?.id ?? null;
    }
    if (id !== null && v.ships[id].owner === this.actor()) this.pick(id);
    else if (this.sel !== null) this.pick(null);
  }

  private send(a: Action) {
    const v = this.v;
    if (!v || this.busy) return;
    const actor = this.actor();
    if (!this.interactive.includes(actor)) return;
    Sound.unlock();
    this.ctx.act(actor, a);
  }

  private say(text: string) {
    const el = h(`<div class="sea-say">${esc(text)}</div>`);
    this.float.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  private boom(p: CamPoint, icon: string) {
    const s = this.cam.toScreen(p);
    const el = h(`<div class="sea-boom" style="left:${s.x}px;top:${s.y}px">${icon}</div>`);
    this.float.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }
}

export function createView(): GameView<State, Event> {
  return new SeaView();
}

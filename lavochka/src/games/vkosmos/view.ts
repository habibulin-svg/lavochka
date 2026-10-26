/* «В космос» — отрисовка. Поле — снимок плаката из коробки (public/vkosmos/board.webp), вертушка и карточка «Топливо» —
 * с фото. Планеты (плоские диски) и космолёты нарисованы кодом по образцу фото комплекта (разрешение пользователя —
 * фишки на снимках не разобрать). Ход: «Бросить кубик», затем касание подсвеченного кружка. Вопросы — карточка с
 * вертушкой и варианты ответа кнопками. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { COLORS, legal, PLANET_NAME, PLANETS_ORDER, planetAt, questionText, targets, type Action, type Event, type Planet, type State } from './engine';
import { NODES } from './map';
import './vkosmos.css';

const BASE = `${import.meta.env.BASE_URL}vkosmos/`;
const W = 2400;
const H = 1842;
const DISC: Record<Planet, [string, string]> = { venus: ['#9ad8ff', '#2a7ac8'], earth: ['#8ae08a', '#1f8a3a'], mars: ['#ffb08a', '#c8401a'] };
const BOOK = { depart: '«Книга для отъезжающих»', planets: '«Книга планет»', tech: '«Технический вопросник»' };

function rocket(color: string): string {
  return `<path d="M0,-40 C9,-28 11,-10 10,12 L18,26 L18,32 L7,26 L4,32 L-4,32 L-7,26 L-18,32 L-18,26 L-10,12 C-11,-10 -9,-28 0,-40 Z" fill="${color}" stroke="#1a1a1a" stroke-width="2.5"/>
    <circle cx="0" cy="-10" r="5" fill="#dff4ff" stroke="#1a1a1a" stroke-width="2"/><path d="M-3,-34 C0,-38 2,-34 3,-30" stroke="#fff" stroke-width="2" fill="none" opacity="0.7"/>`;
}

class VkosmosView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private card!: HTMLElement;
  private needle!: HTMLElement;
  private info!: HTMLElement;
  private s: State | null = null;
  private angle = 0;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const sp = h(`<div class="vk-spinner"><img src="${BASE}spinner.webp" alt=""><div class="vk-needle"></div></div>`);
    this.needle = sp.querySelector('.vk-needle') as HTMLElement;
    this.card = h(`<div class="vk-card"></div>`);
    this.info = h(`<div class="vk-info"></div>`);
    ctx.controls.appendChild(sp);
    ctx.controls.appendChild(this.card);
    ctx.controls.appendChild(this.info);
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: () => NODES.length,
        size: () => [W, H],
        xy: (_s, p) => [NODES[p].x, NODES[p].y],
        board: () => `<defs><filter id="vk-sh" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="3" dy="5" stdDeviation="3" flood-opacity="0.55"/></filter></defs>
          <image href="${BASE}board.webp" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`,
        pieces: (s) => [...PLANETS_ORDER.map((pl) => ({ p: planetAt(s, pl), kind: `P${pl}` })), ...s.ships.map((x) => ({ p: x.node, kind: `S${x.seat}` }))],
        piece: (s, kind, x, y, p) => this.piece(s, kind, x, y, p),
        legal: (s, seat) => legal(s, seat),
        spot: (a) => {
          const s = this.s;
          if (!s || a.type !== 'move') return null;
          const r = s.routes[a.i];
          return { from: s.ships[s.turn].node, to: r.path[r.path.length - 1] };
        },
        label: (a) => {
          const s = this.s;
          if (a.type === 'roll') return s && s.ships[s.turn].ac >= 0 ? '🎲 Бросить: ведёт автоматическая станция' : '🎲 Бросить кубик';
          if (a.type === 'wait') return 'Пропустить ход (сберечь топливо)';
          if (a.type === 'answer') return s?.question?.options[a.i] ?? '…';
          return '…';
        },
        hit: 40,
        ring: 36,
      },
      'vk'
    );
  }

  private piece(s: State, kind: string, x: number, y: number, p: number): string {
    if (kind[0] === 'P') {
      const pl = kind.slice(1) as Planet;
      const [a, b] = DISC[pl];
      const r = 46;
      return `<g transform="translate(${x} ${y})" filter="url(#vk-sh)"><circle r="${r}" fill="${b}" stroke="#111" stroke-width="3"/><circle r="${r - 8}" fill="${a}" opacity="0.55"/>
        <ellipse cx="-14" cy="-16" rx="12" ry="7" fill="#fff" opacity="0.5"/><text y="7" class="vk-pl">${PLANET_NAME[pl][0]}</text></g>`;
    }
    const seat = Number(kind.slice(1));
    const same = s.ships.filter((x) => x.node === p);
    const k = same.findIndex((x) => x.seat === seat);
    const dx = same.length > 1 ? (k - (same.length - 1) / 2) * 30 : 0;
    const onPlanet = s.ships[seat].on ? -34 : 0;
    return `<g transform="translate(${x + dx} ${y + onPlanet}) scale(0.95)" filter="url(#vk-sh)">${rocket(COLORS[seat])}</g>`;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const sh = s.ships[s.turn];
    if (s.phase === 'question' && s.question) {
      const q = s.question;
      const why = s.why === 'takeoff' ? 'Взлёт' : s.why === 'ac' ? 'Вызов автоматической станции' : s.why === 'repair' ? 'Ремонт после метеорита' : 'Происшествие';
      this.card.innerHTML = `<div class="vk-why">${why}: ${BOOK[q.book]}${q.book === 'depart' ? `, задание ${q.n + 1}` : `, вопрос ${q.n + 1}`}</div><div class="vk-q">${questionText(q)}</div>`;
    } else if (s.phase === 'move') this.card.innerHTML = `Выпало ${s.roll}: нажмите на подсвеченный кружок, куда лететь.${s.routes.some((r) => r.boost) ? ' Кружки на один дальше — с ускорением (два бака).' : ''}`;
    else this.card.innerHTML = sh.ac >= 0 ? `Автоматическая станция в пути: ещё ${sh.ac} кружков (кубик + 2).` : 'Бросьте кубик: на столько кружков полетит космолёт (бак за ход).';
    this.info.innerHTML = s.ships
      .map((x) => {
        const where = x.on ? `на планете ${PLANET_NAME[x.on]}` : 'в космосе';
        const goal = targets(x).map((pl) => PLANET_NAME[pl]).join(' или ');
        return `<div><span class="vk-dot" style="background:${COLORS[x.seat]}"></span>${this.ctx.name(x.seat)}: ${where} · ⛽ <b>${x.fuel}</b> · цель — ${goal}${x.skip ? ' · пропуск хода' : ''}</div>`;
      })
      .join('');
  }

  private spin(angle: number) {
    this.angle += 720 + ((angle - this.angle) % 360 + 360) % 360;
    this.needle.style.transition = `transform ${1.1 / this.ctx.speed()}s cubic-bezier(.15,.7,.25,1)`;
    this.needle.style.transform = `rotate(${this.angle}deg)`;
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    const sp = () => this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'spin') {
        this.spin(v.spin);
        Sound.diceRoll(0.6);
        await sleep(900 / sp());
      } else if (ev.type === 'roll') {
        Sound.diceRoll(0.6);
        await sleep(400 / sp());
      } else if (ev.type === 'answer') {
        if (ev.ok) Sound.home();
        else Sound.nomove();
        await sleep(300 / sp());
      } else if (ev.type === 'move') {
        const prev = this.s ?? v;
        let from = prev.ships[ev.seat].node;
        for (const q of ev.path) {
          const tmp: State = { ...prev, ships: prev.ships.map((x) => (x.seat === ev.seat ? { ...x, node: q, on: null } : x)) };
          this.pb.show(tmp, { from, to: q, kind: `S${ev.seat}` });
          from = q;
          Sound.step();
          await sleep(140 / sp());
        }
        if (ev.incident) Sound.ui();
      } else if (ev.type === 'land') Sound.home();
      else if (ev.type === 'planets') {
        this.s = v;
        this.pb.set(v);
        await sleep(250 / sp());
      } else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.pb.turn(s && s.phase !== 'over' && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null);
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.phase === 'over') return v.winner == null ? 'Полёт окончен' : 'Лучший капитан вернулся на Землю!';
    if (!interactive.some((x) => toAct.includes(x))) return 'Ходит другой капитан…';
    return v.phase === 'question' ? 'Ответьте на вопрос' : v.phase === 'roll' ? 'Бросайте кубик' : 'Куда лететь?';
  }

  playerStats(v: State, seat: number) {
    const x = v.ships[seat];
    return `⛽ ${x.fuel} · ${x.visited.map((p) => PLANET_NAME[p]).join(', ') || 'нигде'}`;
  }
}

export function createView(): GameView<State, Event> {
  return new VkosmosView();
}

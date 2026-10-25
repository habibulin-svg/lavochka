/* «Наша игротека» — отрисовка. Поле — скан листа из набора (цветная плашка с названием и картинками, белое или цветное поле),
 * фишки — круглые пластмассовые, белые и красные (в наборе 50 фишек двух цветов; чёрные слились бы с чёрными кружками полей); дамка турецких шашек — две фишки стопкой.
 * Единица координат — шаг поля (расстояние между соседними точками), чтобы подсветка доски была одинаковой на всех полях. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { BOARD_OF, colorOfSeat, count, G, legal, pieces, SIDES, TITLES, type Action, type Event, type State } from './engine';
import './igroteka.css';

const U = (s: State) => G(s).pitch;
/** Радиус фишки в шагах поля. */
const RADIUS: Record<string, number> = {
  sheep: 0.42,
  tickle: 0.3,
  sidja: 0.34,
  fox: 0.34,
  leopards: 0.23,
  mill: 0.33,
  bolotudu: 0.36,
  alquerque: 0.28,
  hasami: 0.4,
  turk: 0.4,
};
const rad = (s: State) => RADIUS[BOARD_OF[s.cfg.game]];

const HINT: Record<string, string> = {
  sheep: 'Волк ходит по линиям на соседний кружок вперёд и назад, овцы — только вперёд. Нажмите на фишку, затем на кружок.',
  tickle: 'Шаг на соседнюю свободную клетку вверх, вниз, вправо или влево. Три в ряд (и по диагонали) — победа.',
  quartet: 'Сначала по очереди ставят по 4 фишки, потом ходят на соседнюю клетку в любую сторону. Четыре в ряд или квадрат — победа.',
  fox: 'Лиса ставится на любую точку. Гуси идут вперёд и вбок, лиса прыгает через гуся на пустую точку за ним и съедает его.',
  leopards: 'Леопарды и коровы выставляются по очереди. Леопарды прыгают через корову на пустую точку и съедают её; 8 коров — победа леопардов.',
  mill: 'Ставьте по 9 фишек, потом ходите по линиям. Три в ряд — снимите фишку соперника (нажмите на неё). Можно перепрыгнуть одну фишку.',
  bolotudu: 'Ставят по две фишки за ход, далеко друг от друга, потом ходят по стороне клетки. Новая тройка в ряд снимает соседнюю фишку соперника.',
  senegal: 'Шашки ходят вперёд и вбок, бить прыжком обязательно. Дошедшая до последнего ряда снимается.',
  sidja: 'Ставят по две фишки (кроме центра), потом ходят в любую сторону. Зажатая с двух сторон фишка снимается.',
  alquerque: 'Вперёд, вбок и вперёд по диагонали; прыжок через чужую фишку снимает её, прыжки можно продолжать с поворотами. Первый ход — в центр.',
  hasami: 'На клетку вперёд или вбок; можно перепрыгнуть чужую фишку. Зажатую с двух сторон снимают. Пять в ряд по вертикали или диагонали в пяти средних рядах — победа.',
  turk: 'Шашки ходят и бьют вперёд и вбок, бить обязательно и как можно больше. Дамка ходит далеко по прямой.',
};

function chip(seat: 'w' | 'b', x: number, y: number, r: number, king: boolean): string {
  const g = seat === 'w' ? 'ig-w' : 'ig-b';
  const edge = seat === 'w' ? '#7d7466' : '#4a0402';
  const rim = seat === 'w' ? '#b9b0a0' : '#9a1410';
  const one = (yy: number) => `<circle cx="${x}" cy="${yy + r * 0.13}" r="${r}" fill="${edge}"/>
    <circle cx="${x}" cy="${yy}" r="${r}" fill="url(#${g})" stroke="${edge}" stroke-width="${r * 0.05}"/>
    <circle cx="${x}" cy="${yy}" r="${r * 0.72}" fill="none" stroke="${rim}" stroke-width="${r * 0.07}"/>`;
  const sh = `<circle cx="${x + r * 0.1}" cy="${y + r * 0.2}" r="${r * 1.12}" fill="url(#ig-sh)"/>`;
  return sh + one(y) + (king ? one(y - r * 0.3) + `<text x="${x}" y="${y - r * 0.3}" class="ig-crown" style="font-size:${r * 0.9}px" fill="${seat === 'w' ? '#8a6a1a' : '#e0b84a'}">♛</text>` : '');
}

const DEFS = `<defs>
  <radialGradient id="ig-w" cx="38%" cy="32%" r="72%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.65" stop-color="#ece6da"/><stop offset="1" stop-color="#bdb4a2"/></radialGradient>
  <radialGradient id="ig-b" cx="38%" cy="32%" r="72%"><stop offset="0" stop-color="#ff7a68"/><stop offset="0.6" stop-color="#d0201c"/><stop offset="1" stop-color="#7a0a08"/></radialGradient>
  <radialGradient id="ig-sh" cx="50%" cy="50%" r="50%"><stop offset="0.55" stop-color="#000" stop-opacity="0.4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
</defs>`;

class IgrotekaView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private hint!: HTMLElement;
  private s: State | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="ig-info"></div>`);
    this.hint = h(`<div class="ig-hint"></div>`);
    ctx.controls.appendChild(this.info);
    if (!ctx.demo) ctx.controls.appendChild(this.hint);
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: (s) => G(s).pts.length,
        size: (s) => [G(s).w / U(s), G(s).h / U(s)],
        xy: (s, p) => [G(s).pts[p].x / U(s), G(s).pts[p].y / U(s)],
        board: (s) => `${DEFS}<image href="/igroteka/${BOARD_OF[s.cfg.game]}.webp" x="0" y="0" width="${G(s).w / U(s)}" height="${G(s).h / U(s)}" preserveAspectRatio="none"/>`,
        pieces: (s) => pieces(s).map((q) => ({ p: q.p, kind: `${q.seat}${q.king ? 'k' : ''}` })),
        piece: (s, kind, x, y) => chip(s.cfg.game === 'turk' ? (kind[0] === '0' ? 'w' : 'b') : colorOfSeat(s.cfg.game, Number(kind[0])), x, y, rad(s), kind.endsWith('k')),
        legal: (s, seat) => (s.turn === seat ? legal(s) : []),
        spot: (a) => (a.type === 'place' ? { to: a.to } : a.type === 'take' ? { to: a.at } : a.type === 'move' ? { from: a.from, to: a.to } : null),
        label: (a) => (a.type === 'stop' ? 'Хватит прыгать' : a.type === 'pass' ? 'Пропустить ход' : '…'),
        hit: 0.48,
        ring: 0.4,
      },
      'ig-wrap'
    );
  }

  seatName(v: State, seat: number) {
    return SIDES[v.cfg.game][seat];
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const g = s.cfg.game;
    const nm = (seat: number) => SIDES[g][seat];
    const line = (seat: number) => {
      const on = g === 'turk' ? (s.ck ? s.ck.board.filter((v) => v && (v[0].toLowerCase() === 'w') === (seat === 0)).length : 0) : count(s, seat);
      let t = `${nm(seat)}: на поле <b>${on}</b>`;
      if (s.hand[seat]) t += `, ещё выставить <b>${s.hand[seat]}</b>`;
      if (s.caps[seat] && g !== 'mill') t += `, снято <b>${s.caps[seat]}</b>`;
      if (g === 'senegal' && s.lost[seat]) t += `, ушло за край <b>${s.lost[seat]}</b>`;
      if (g === 'alquerque' && s.lost[seat]) t += `, «за фук» <b>${s.lost[seat]}</b>`;
      return `<div>${t}</div>`;
    };
    let extra = '';
    if (s.take) extra = `<div class="ig-take">${g === 'mill' ? 'Мельница!' : 'Тройка!'} Снимите фишку соперника${s.take > 1 ? ` (ещё ${s.take})` : ''}.</div>`;
    else if (s.chain >= 0) extra = `<div class="ig-take">Можно прыгать дальше${g === 'alquerque' ? ' — а если бросить цепочку, когда прыгать ещё есть куда, фишку снимут' : ''}.</div>`;
    else if (g === 'leopards' && !s.over) extra = `<div>Съедено коров: <b>${s.caps[0]}</b> из 8</div>`;
    this.info.innerHTML = `<div class="ig-title">${TITLES[g]}</div>` + line(0) + line(1) + extra;
    this.hint.textContent = HINT[g];
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'place') {
        this.pb.show(v, null, [], ev.to);
        Sound.place();
        await sleep(260 / this.ctx.speed());
      } else if (ev.type === 'move') {
        const kind = (p: number) => pieces(v).find((q) => q.p === p);
        const at = kind(ev.to);
        const k = at ? `${at.seat}${at.king ? 'k' : ''}` : String(ev.seat);
        this.pb.show(
          v,
          { from: ev.from, to: ev.to, kind: k },
          ev.caps.map((p) => ({ p, kind: v.cfg.game === 'turk' ? String(1 - ev.seat) : String(1 - ev.seat) }))
        );
        if (ev.caps.length) Sound.capture();
        else if (ev.jump) Sound.jump();
        else Sound.step();
        await sleep((ev.caps.length ? 520 : 360) / this.ctx.speed());
      } else if (ev.type === 'take' || ev.type === 'out' || ev.type === 'huff') {
        const seatOf = ev.type === 'take' ? 1 - ev.seat : ev.seat;
        this.pb.show(v, null, [{ p: ev.at, kind: String(seatOf) }]);
        Sound.capture();
        await sleep(420 / this.ctx.speed());
      } else if (ev.type === 'pass') {
        Sound.ui();
        await sleep(200 / this.ctx.speed());
      } else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.pb.turn(s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null);
    this.text();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : `Победа: ${SIDES[v.cfg.game][v.winner]}`;
    const side = SIDES[v.cfg.game][toAct[0]];
    if (!interactive.includes(toAct[0])) return `Ходят ${side}…`;
    if (v.take) return 'Снимите фишку соперника';
    if (v.chain >= 0) return 'Прыгайте дальше или нажмите «Хватит прыгать»';
    if (v.hand[v.turn]) return v.cfg.game === 'fox' ? 'Поставьте лису на любую точку' : v.first >= 0 ? 'Поставьте вторую фишку' : 'Поставьте фишку';
    return `Ваш ход — ${side.toLowerCase()}`;
  }
}

export function createView(): GameView<State, Event> {
  return new IgrotekaView();
}

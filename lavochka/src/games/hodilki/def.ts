/* Кинь-двинь — одна игра на нескольких оригинальных советских полях; поле выбирается настройкой и лежит в состоянии партии. */
import type { GameDef, SeatSpec } from '../../core/types';
import { finishOf, pathFor, SEATS, signText, skipsOf, type Action, type Board, type Event, type State } from './core';
import { board as kosmos } from './kosmos';
import { board as krugosvet } from './krugosvet';
import { board as put } from './put';
import { NASTOLKI } from './nastolki';

export const BOARDS: Board[] = [krugosvet, kosmos, put, ...NASTOLKI];
export const boardOf = (map: string) => BOARDS.find((b) => b.id === map) ?? BOARDS[0];

const next = (s: State, seat: number) => s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];

/** Ход в два действия: бросок кубика, потом игрок сам переставляет пуговицу (как фишку в нардах). */
function apply(s0: State, seat: number, a: Action, rng: { int(n: number): number }): { state: State; events: Event[] } | null {
  if (s0.winner != null || seat !== s0.turn) return null;
  const phase = s0.phase ?? 'roll';
  if (a?.type === 'roll') {
    if (phase !== 'roll') return null;
    const die = rng.int(6) + 1;
    return { state: { ...s0, last: die, phase: 'move' }, events: [{ type: 'roll', seat, die }] };
  }
  if (a?.type !== 'move' || phase !== 'move' || !s0.last) return null;
  const board = boardOf(s0.map);
  const finish = finishOf(board);
  const s: State = { ...s0, pos: s0.pos.slice(), skip: s0.skip.slice(), route: (s0.route ?? s0.pos.map(() => null)).slice(), phase: 'roll' };
  const ev: Event[] = [];
  const path = pathFor(s0, board, seat);
  const onRoute = !!s.route![seat]?.length;
  const to = path.length ? path[path.length - 1] : s.pos[seat];
  if (onRoute) {
    const rest = s.route![seat]!.slice(path.length);
    s.route![seat] = rest.length ? rest : null;
  }
  s.pos[seat] = to;
  ev.push({ type: 'move', seat, path });
  const win = () => {
    s.winner = seat;
    ev.push({ type: 'win', seat });
    return { state: s, events: ev };
  };
  if (to === finish) return win();
  let again = false;
  // по ветке знаки не срабатывают (и на клетке входа, куда вернулись, — тоже)
  const sign = onRoute ? null : board.cells[to].sign;
  if (sign) {
    let dest = to;
    if (sign.k === 'skip') s.skip[seat] = sign.n ?? 1;
    else if (sign.k === 'again') again = true;
    else if (sign.k === 'start') dest = 0;
    else if (sign.k === 'route') s.route![seat] = sign.cells.slice();
    else {
      dest = Math.max(0, Math.min(finish, sign.to));
      if (sign.skip) s.skip[seat] = sign.skip;
    }
    ev.push({ type: 'sign', seat, sign, to: dest });
    s.pos[seat] = dest;
    if (dest === finish) return win();
  }
  if (!again) {
    // следующий, кто не пропускает
    let t = next(s, seat);
    for (let i = 0; i < 4 * s.seats.length && skipsOf(s, t) > 0; i++) {
      s.skip[t] = skipsOf(s, t) - 1;
      ev.push({ type: 'skip', seat: t });
      t = next(s, t);
    }
    s.turn = t;
  }
  return { state: s, events: ev };
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

export const def: GameDef<State, Action, Event, State> = {
  id: 'hodilki',
  title: 'Кинь-двинь',
  players: { min: 2, max: 10, default: 3 },
  seats: SEATS,
  options: [{ key: 'map', label: 'Поле', type: 'select', choices: BOARDS.map((b) => ({ value: b.id, label: b.title })), default: BOARDS[0].id }],
  presets: BOARDS.map((b) => ({ id: b.id, label: b.title, options: { map: b.id } })),
  setup: (seats, opts) => {
    const ids = seats.map((x) => x.seat).sort((a, b) => a - b);
    return { map: boardOf(String(opts.map ?? BOARDS[0].id)).id, seats: ids, pos: Array(10).fill(0), skip: Array(10).fill(0), route: Array(10).fill(null), turn: ids[0], phase: 'roll', last: null, winner: null };
  },
  showcase: () => ({ map: 'krugosvet', seats: [0, 1, 2, 3], pos: [4, 36, 45, 104, 0, 0, 0, 0, 0, 0], skip: Array(10).fill(false), turn: 1, phase: 'roll', last: 4, winner: null }),
  toAct: (s) => (s.winner != null ? [] : [s.turn]),
  apply,
  view: (s) => s,
  result: (s) => (s.winner == null ? null : { winners: [s.winner], text: boardOf(s.map).winText }),
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v) => ({ type: (v.phase ?? 'roll') === 'roll' ? 'roll' : 'move' }) },
  describe(ev, name) {
    switch (ev.type) {
      case 'roll':
        return `${name(ev.seat)} бросает: <b>${ev.die}</b>`;
      case 'sign':
        return `${name(ev.seat)} ${signText(ev.sign)}.`;
      case 'skip':
        return `${name(ev.seat)} пропускает ход.`;
      case 'win':
        return `🏁 ${name(ev.seat)} — победа!`;
    }
    return null;
  },
  rules: {
    goal: 'Бросать кубик, шагать пуговицей по полю и первым дойти до финиша. Знаки на поле ускоряют или откидывают назад.',
    sections: BOARDS.map((b) => ({
      title: b.title,
      html: `<p><i>${b.goal}</i></p>${b.rules}${b.credit ? `<p><small>${b.credit}</small></p>` : ''}`,
      demo: b.demo ? { seats: demoSeats, options: { map: b.id }, steps: b.demo.flatMap((d, i) => {
            const seat = d.seat ?? i % 2;
            return [
              { seat, action: { type: 'roll' } as Action, rig: [d.rig], caption: `${SEATS[seat].name} бросает кубик…` },
              { seat, action: { type: 'move' } as Action, caption: d.caption },
            ];
          }) } : undefined,
    })),
  },
};

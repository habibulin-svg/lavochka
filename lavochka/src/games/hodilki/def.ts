/* Кинь-двинь — одна игра на нескольких оригинальных советских полях; поле выбирается настройкой и лежит в состоянии партии. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SEATS, signText, type Action, type Board, type Event, type State } from './core';
import { board as kosmos } from './kosmos';
import { board as krugosvet } from './krugosvet';
import { board as put } from './put';

export const BOARDS: Board[] = [krugosvet, kosmos, put];
export const boardOf = (map: string) => BOARDS.find((b) => b.id === map) ?? BOARDS[0];

const next = (s: State, seat: number) => s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];

function apply(s0: State, seat: number, a: Action, rng: { int(n: number): number }): { state: State; events: Event[] } | null {
  if (s0.winner != null || seat !== s0.turn || a?.type !== 'roll') return null;
  const board = boardOf(s0.map);
  const finish = board.cells.length - 1;
  const s: State = { ...s0, pos: s0.pos.slice(), skip: s0.skip.slice() };
  const ev: Event[] = [];
  const die = rng.int(6) + 1;
  s.last = die;
  ev.push({ type: 'roll', seat, die });
  const from = s.pos[seat];
  const to = Math.min(finish, from + die);
  const path: number[] = [];
  for (let i = from + 1; i <= to; i++) path.push(i);
  s.pos[seat] = to;
  ev.push({ type: 'move', seat, path });
  const win = () => {
    s.winner = seat;
    ev.push({ type: 'win', seat });
    return { state: s, events: ev };
  };
  if (to === finish) return win();
  let again = false;
  const sign = board.cells[to].sign;
  if (sign) {
    let dest = to;
    if (sign.k === 'skip') s.skip[seat] = true;
    else if (sign.k === 'again') again = true;
    else if (sign.k === 'start') dest = 0;
    else dest = Math.max(0, Math.min(finish, sign.to));
    ev.push({ type: 'sign', seat, sign, to: dest });
    s.pos[seat] = dest;
    if (dest === finish) return win();
  }
  if (!again) {
    // следующий, кто не пропускает
    let t = next(s, seat);
    for (let i = 0; i < s.seats.length && s.skip[t]; i++) {
      s.skip[t] = false;
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
    return { map: boardOf(String(opts.map ?? BOARDS[0].id)).id, seats: ids, pos: Array(10).fill(0), skip: Array(10).fill(false), turn: ids[0], last: null, winner: null };
  },
  showcase: () => ({ map: 'krugosvet', seats: [0, 1, 2, 3], pos: [4, 36, 45, 104, 0, 0, 0, 0, 0, 0], skip: Array(10).fill(false), turn: 1, last: 4, winner: null }),
  toAct: (s) => (s.winner != null ? [] : [s.turn]),
  apply,
  view: (s) => s,
  result: (s) => (s.winner == null ? null : { winners: [s.winner], text: boardOf(s.map).winText }),
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: () => ({ type: 'roll' }) },
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
      html: `<p><i>${b.goal}</i></p>${b.rules}`,
      demo: b.demo ? { seats: demoSeats, options: { map: b.id }, steps: b.demo.map((d, i) => ({ seat: d.seat ?? i % 2, action: { type: 'roll' } as Action, rig: [d.rig], caption: d.caption })) } : undefined,
    })),
  },
};

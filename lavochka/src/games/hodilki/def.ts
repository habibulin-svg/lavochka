/* Кинь-двинь — одна игра на нескольких оригинальных советских полях; поле выбирается настройкой и лежит в состоянии партии.
 * «Шайба» — то же поле-карточка, но с гонкой: у каждой дорожки свои ворота, финиш = гол (см. Race в core.ts). */
import type { GameDef, SeatSpec } from '../../core/types';
import { esc } from '../../core/util';
import { finishOf, pathFor, SEATS, signText, skipsOf, trackOf, type Action, type Board, type Event, type State } from './core';
import { board as kosmos } from './kosmos';
import { board as krugosvet } from './krugosvet';
import { board as put } from './put';
import { NASTOLKI } from './nastolki';
import { shaybaBoard } from './shayba';

export const BOARDS: Board[] = [krugosvet, kosmos, put, ...NASTOLKI, shaybaBoard];
export const boardOf = (map: string) => BOARDS.find((b) => b.id === map) ?? BOARDS[0];

const next = (s: State, seat: number) => s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];

/** Счёт гонки с голами: «2 : 1» по дорожкам. */
export const scoreText = (s: State, b: Board) => (s.goals ?? b.race?.tracks.map(() => 0) ?? []).join(' : ');

/** Кубик «Шайбы»: грани 1–4 — очки, 5 — красная клюшка (назад), 6 — зелёная (вперёд). Клюшка тянет квадратик с 1–3 очками. */
function rollRace(s0: State, b: Board, seat: number, rng: { int(n: number): number }): { state: State; events: Event[] } {
  const { pips, stick } = b.race!.die;
  const die = rng.int(6) + 1;
  if (die <= pips) {
    return { state: { ...s0, last: die, kind: 'pips', card: null, phase: 'move' }, events: [{ type: 'roll', seat, die, kind: 'pips' }] };
  }
  // квадратик: 15 штук — по пять с одной, двумя и тремя точками
  const slot = rng.int(15);
  const card = 1 + Math.floor(slot / 5);
  const kind = die === stick ? ('red' as const) : ('green' as const);
  const last = kind === 'red' ? -card : card;
  return { state: { ...s0, last, kind, card, cardSlot: slot, phase: 'move' }, events: [{ type: 'roll', seat, die, kind, card, slot }] };
}

/** Ход в гонке с голами: шайба идёт по своей дорожке; дошла до ворот — гол и возврат в центр. */
function moveRace(s0: State, b: Board, seat: number): { state: State; events: Event[] } {
  const race = b.race!;
  const track = trackOf(b, seat);
  const trail = race.tracks[track];
  const s: State = { ...s0, pos: s0.pos.slice(), goals: (s0.goals ?? race.tracks.map(() => 0)).slice(), phase: 'roll', kind: null, card: null, cardSlot: null };
  const mates = s.seats.filter((x) => trackOf(b, x) === track);
  const path = pathFor(s0, b, seat);
  const to = path.length ? path[path.length - 1] : s.pos[seat];
  const ev: Event[] = [];
  s.pos[seat] = to;
  ev.push({ type: 'move', seat, path });
  if (path.length && to === trail[trail.length - 1] && (s0.last ?? 0) > 0) {
    const goals = s.goals!;
    goals[track] = (goals[track] ?? 0) + 1;
    for (const x of mates) s.pos[x] = trail[0];
    const target = s.target ?? race.target;
    ev.push({ type: 'goal', seat, track, goals: goals[track], target });
    if (goals[track] >= target) {
      s.winner = seat;
      ev.push({ type: 'win', seat });
      return { state: s, events: ev };
    }
  } else {
    // у команды одна шайба: у напарников она там же
    for (const x of mates) if (x !== seat) s.pos[x] = to;
  }
  s.turn = next(s, seat);
  return { state: s, events: ev };
}

/** Ход в два действия: бросок кубика, потом игрок сам переставляет пуговицу (как фишку в нардах). */
function apply(s0: State, seat: number, a: Action, rng: { int(n: number): number }): { state: State; events: Event[] } | null {
  if (s0.winner != null || seat !== s0.turn) return null;
  const phase = s0.phase ?? 'roll';
  const board = boardOf(s0.map);
  if (a?.type === 'roll') {
    if (phase !== 'roll') return null;
    if (board.race) return rollRace(s0, board, seat, rng);
    const die = rng.int(6) + 1;
    return { state: { ...s0, last: die, phase: 'move' }, events: [{ type: 'roll', seat, die }] };
  }
  if (a?.type !== 'move' || phase !== 'move' || !s0.last) return null;
  if (board.race) return moveRace(s0, board, seat);
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
    ev.push({ type: 'sign', seat, sign, to: dest, ...(board.cells[to].text ? { text: board.cells[to].text } : {}) });
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
  options: [
    { key: 'map', label: 'Поле', type: 'select', choices: BOARDS.map((b) => ({ value: b.id, label: b.title })), default: BOARDS[0].id },
    {
      key: 'goals',
      label: 'Голов до победы («Шайба»)',
      type: 'select',
      choices: [1, 3, 5, 7].map((n) => ({ value: String(n), label: n === 1 ? 'один гол' : `до ${n} голов` })),
      default: '3',
    },
  ],
  presets: [
    ...BOARDS.map((b) => ({ id: b.id, label: b.title, options: { map: b.id } })),
    { id: 'shayba5', label: 'Шайба — до 5 голов', options: { map: 'shayba', goals: '5' } },
    { id: 'shayba7', label: 'Шайба — до 7 голов', options: { map: 'shayba', goals: '7' } },
  ],
  setup: (seats, opts) => {
    const ids = seats.map((x) => x.seat).sort((a, b) => a - b);
    const board = boardOf(String(opts.map ?? BOARDS[0].id));
    const race = board.race;
    return {
      map: board.id,
      seats: ids,
      pos: Array(10).fill(0),
      skip: Array(10).fill(0),
      route: Array(10).fill(null),
      turn: ids[0],
      phase: 'roll',
      last: null,
      winner: null,
      ...(race ? { goals: race.tracks.map(() => 0), target: Math.max(1, Number(opts.goals ?? race.target) || race.target), kind: null, card: null, cardSlot: null } : {}),
    };
  },
  showcase: () => ({ map: 'krugosvet', seats: [0, 1, 2, 3], pos: [4, 36, 45, 104, 0, 0, 0, 0, 0, 0], skip: Array(10).fill(false), turn: 1, phase: 'roll', last: 4, winner: null }),
  toAct: (s) => (s.winner != null ? [] : [s.turn]),
  apply,
  view: (s) => s,
  result: (s) => {
    if (s.winner == null) return null;
    const b = boardOf(s.map);
    if (b.race) {
      const track = trackOf(b, s.winner);
      return {
        winners: s.seats.filter((x) => trackOf(b, x) === track),
        text: `${b.winText} — ${scoreText(s, b)}`,
        scores: Object.fromEntries((s.goals ?? []).map((g, i) => [i, g])),
      };
    }
    return { winners: [s.winner], text: b.winText };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v) => ({ type: (v.phase ?? 'roll') === 'roll' ? 'roll' : 'move' }) },
  describe(ev, name) {
    switch (ev.type) {
      case 'roll':
        if (ev.kind === 'red') return `${name(ev.seat)} бросает: 🔴 красная клюшка, квадратик на <b>${ev.card}</b> — шайба назад.`;
        if (ev.kind === 'green') return `${name(ev.seat)} бросает: 🟢 зелёная клюшка, квадратик на <b>${ev.card}</b> — шайба вперёд.`;
        return `${name(ev.seat)} бросает: <b>${ev.die}</b>`;
      case 'sign':
        return `${ev.text ? `<i>${esc(ev.text)}</i> ` : ''}${name(ev.seat)} ${signText(ev.sign)}.`;
      case 'skip':
        return `${name(ev.seat)} пропускает ход.`;
      case 'goal':
        return `🥅 ${name(ev.seat)} забивает ${ev.goals}-ю шайбу (до ${ev.target}).`;
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
              { seat, action: { type: 'roll' } as Action, rig: Array.isArray(d.rig) ? d.rig : [d.rig], caption: `${SEATS[seat].name} бросает кубик…` },
              { seat, action: { type: 'move' } as Action, caption: d.caption },
            ];
          }) } : undefined,
    })),
  },
};

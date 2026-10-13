/* Кинь-двинь — одна игра на нескольких оригинальных советских полях; поле выбирается настройкой и лежит в состоянии партии.
 * «Шайба» — то же поле-карточка, но с гонкой: у каждой дорожки свои ворота, финиш = гол (см. Race в core.ts). */
import type { GameDef, SeatSpec } from '../../core/types';
import { esc } from '../../core/util';
import { finishOf, itemName, pathFor, SEATS, signText, skipsOf, trackOf, walkFor, type Action, type Board, type Event, type Sign, type State } from './core';
import { board as kosmos } from './kosmos';
import { board as krugosvet } from './krugosvet';
import { board as put } from './put';
import { NASTOLKI } from './nastolki';
import { shaybaBoard } from './shayba';
import { vputBoard } from './vput';
import { luk1Board } from './luk1';

export const BOARDS: Board[] = [krugosvet, kosmos, put, ...NASTOLKI, shaybaBoard, vputBoard, luk1Board];
export const boardOf = (map: string) => BOARDS.find((b) => b.id === map) ?? BOARDS[0];

const next = (s: State, seat: number) => s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];

/** Победа места: и состояние, и событие. */
const winNow = (s: State, ev: Event[], seat: number) => {
  s.winner = seat;
  ev.push({ type: 'win', seat });
  return { state: s, events: ev };
};

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
  // ответ на загадку: пуговица идёт на деление, которое назвал игрок
  if (a?.type === 'pick') {
    if (phase !== 'pick') return null;
    const sign = board.cells[s0.pos[seat]]?.sign;
    if (sign?.k !== 'pick') return null;
    const i = Math.max(0, Math.min(sign.options.length - 1, Math.floor(a.pick) || 0));
    const finish = finishOf(board);
    const s: State = { ...s0, pos: s0.pos.slice(), phase: 'roll' };
    const dest = Math.max(0, Math.min(finish, sign.to[i] ?? s0.pos[seat]));
    const ev: Event[] = [{ type: 'sign', seat, sign: { ...sign, text: `${sign.text}: ${sign.options[i]}` }, to: dest }];
    s.pos[seat] = dest;
    if (dest === finish && !board.winBySign) return winNow(s, ev, seat);
    s.turn = next(s, seat);
    return { state: s, events: ev };
  }
  if (a?.type !== 'move' || phase !== 'move' || !s0.last) return null;
  if (board.race) return moveRace(s0, board, seat);
  const finish = finishOf(board);
  const many = <T,>(list: T[] | undefined, fill: T) => (list ?? s0.pos.map(() => fill)).slice();
  const s: State = {
    ...s0,
    pos: s0.pos.slice(),
    skip: s0.skip.slice(),
    route: many(s0.route, null),
    routeFor: many(s0.routeFor, null),
    ...(board.coins || s0.coins ? { coins: many(s0.coins, 0) } : {}),
    ...(s0.items ? { items: s0.items.slice() } : {}),
    ...(s0.extra ? { extra: s0.extra.slice() } : {}),
    phase: 'roll',
  };
  const ev: Event[] = [];
  // «выход только нужной гранью»: пока не выпадет нужное, пуговица стоит на месте
  const stand = board.cells[s.pos[seat]]?.sign;
  if (stand?.k === 'wait' && (s0.last ?? 0) !== stand.die) {
    ev.push({ type: 'sign', seat, sign: stand, to: s.pos[seat] });
    s.turn = next(s, seat);
    return { state: s, events: ev };
  }
  const walk = walkFor(s0, board, seat);
  const path = walk.path;
  // знаки срабатывают на делениях ленты; на клетке, куда вернулась ветка, — уже нет.
  // На клетках дорог («В путь, друзья!») знаки работают и по ветке: зелёный кружок — ещё бросок, оранжевый — пропуск хода.
  const onRoute = !!s0.route?.[seat]?.length || walk.forks.length > 0;
  const to = path.length ? path[path.length - 1] : s.pos[seat];
  s.route![seat] = walk.route;
  s.routeFor![seat] = walk.routeFor ? true : null;
  s.pos[seat] = to;
  ev.push({ type: 'move', seat, path });
  const win = () => {
    s.winner = seat;
    ev.push({ type: 'win', seat });
    return { state: s, events: ev };
  };
  // развилки, пройденные по дороге: пишем в журнал, какой путь выбрала разница очков
  for (const f of walk.forks) {
    const g = board.cells[f.cell].sign as Sign & { k: 'fork' };
    const road = g.roads?.[f.branch];
    ev.push({
      type: 'sign',
      seat,
      sign: g,
      to: f.cell,
      text: `${g.text}${road ? ` (разница ${f.diff} — ${road})` : ` (разница ${f.diff})`}`,
    });
  }
  if (to === finish && !board.winBySign) return win();
  let again = false;
  // знак срабатывает на клетке, куда пуговица встала. Исключение — клетка, куда вернулась ветка-тупик
  // («туда и обратно»): там знак не повторяется. Дорога развилки — не тупик, её номерные пункты
  // (клады, выход из болота) работают как обычно, поэтому у развилок знаки не гасим.
  const viaFork = (s0.routeFor?.[seat] ?? false) || walk.forks.length > 0;
  const sign = onRoute && !viaFork && !board.cells[to].off ? null : board.cells[to].sign;
  if (sign) {
    let dest = to;
    /** Сколько бон даёт знак: число или сумму бросков («кубик можно бросать три раза»). */
    const diceSum = (times: number) => {
      let sum = 0;
      for (let i = 0; i < Math.max(1, times); i++) sum += rng.int(6) + 1;
      return sum;
    };
    if (sign.k === 'skip') s.skip[seat] = sign.n ?? 1;
    else if (sign.k === 'again') again = true;
    else if (sign.k === 'start') dest = 0;
    else if (sign.k === 'route') s.route![seat] = sign.cells.slice();
    else if (sign.k === 'coins') {
      // «разница» (Лукоморье): не число, а остаток очков — сколько не истрачено, пока пуговица дошла до пункта
      const n = sign.diff ? Math.max(0, (s0.last ?? 0) - path.length) : (sign.n ?? diceSum(sign.dice ?? 1));
      const delta = sign.loss ? -n : n;
      s.coins = many(s.coins, 0);
      s.coins[seat] = Math.max(0, (s.coins[seat] ?? 0) + delta);
      if (sign.skip) s.skip[seat] = sign.skip;
      ev.push({ type: 'coins', seat, delta, total: s.coins[seat] });
    } else if (sign.k === 'field') {
      // серия «Лукоморья»: часть 1–4 — разные поля одной карточки, переход переносит пуговицу на другое поле
      const other = boardOf(sign.map);
      const fromText = board.cells[to].text;
      s.map = other.id;
      dest = Math.max(0, Math.min(finishOf(other), sign.to));
      ev.push({ type: 'sign', seat, sign, to: dest, ...(fromText ? { text: fromText } : {}) });
      s.pos[seat] = dest;
      return { state: s, events: ev };
    } else if (sign.k === 'item') {
      s.items = many(s.items, null);
      s.items[seat] = [...(s.items[seat] ?? []), sign.item];
      ev.push({ type: 'item', seat, item: sign.item });
    } else if (sign.k === 'takeItem') {
      s.items = many(s.items, null);
      s.items[seat] = (s.items[seat] ?? []).filter((x) => x !== sign.item);
      ev.push({ type: 'item', seat, item: sign.item, lost: true });
    } else if (sign.k === 'wait') {
      // на эту клетку пуговица встала — дальше её держит бросок (проверяется в начале хода)
      dest = to;
    } else if (sign.k === 'extra') {
      const n = sign.n ?? diceSum(sign.dice ?? 1);
      s.extra = many(s.extra, 0);
      s.extra[seat] = (s.extra[seat] ?? 0) + n;
      ev.push({ type: 'extra', seat, n });
    } else if (sign.k === 'need') {
      const hasItem = sign.item ? (s.items?.[seat] ?? []).includes(sign.item) : true;
      const hasCoins = sign.coins != null ? (s.coins?.[seat] ?? 0) >= sign.coins : true;
      if (hasItem && hasCoins && sign.yes === 'win') {
        ev.push({ type: 'sign', seat, sign, to, ...(board.cells[to].text ? { text: board.cells[to].text } : {}) });
        return win();
      }
      dest = Math.max(0, Math.min(finish, hasItem && hasCoins ? (sign.yes as number) : sign.no));
    } else if (sign.k === 'pick') {
      // загадка: ход прерывается, пока игрок не назовёт ответ
      ev.push({ type: 'sign', seat, sign, to, ...(board.cells[to].text ? { text: board.cells[to].text } : {}) });
      s.pos[seat] = to;
      s.phase = 'pick';
      return { state: s, events: ev };
    } else if (sign.k === 'fork') {
      // дорога выбирается по остатку очков: сразу, если они ещё есть, иначе — на следующем ходу
      dest = to;
    } else {
      dest = Math.max(0, Math.min(finish, sign.to));
      if (sign.skip) s.skip[seat] = sign.skip;
    }
    ev.push({ type: 'sign', seat, sign, to: dest, ...(board.cells[to].text ? { text: board.cells[to].text } : {}) });
    s.pos[seat] = dest;
    if (dest === finish && !board.winBySign) return win();
  }
  if (!again && s.extra?.[seat]) {
    // накопленные дополнительные ходы: игрок бросает ещё раз, ход остаётся у него
    s.extra[seat] = (s.extra[seat] ?? 0) - 1;
    return { state: s, events: ev };
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
  /** «Шайба» — игра на двоих или командами: 2 (дуэль), 4 (2 на 2) или 6 (3 на 3); остальные поля — 2–10. */
  countsFor: (opts) => {
    if (boardOf(String(opts.map ?? BOARDS[0].id)).race) return [2, 4, 6];
    const out: number[] = [];
    for (let n = 2; n <= 10; n++) out.push(n);
    return out;
  },
  countsHint: (opts) => (boardOf(String(opts.map ?? BOARDS[0].id)).race ? 'вдвоём или командами: 2 на 2 или 3 на 3, у команды одна шайба' : undefined),
  seats: SEATS,
  options: [
    { key: 'map', label: 'Поле', type: 'select', choices: BOARDS.map((b) => ({ value: b.id, label: b.title })), default: BOARDS[0].id },
    // Настройка только для «Шайбы»: у остальных полей финиш, а не счёт по голам.
    {
      key: 'goals',
      label: 'Голов до победы',
      hint: 'Только для «Шайбы»: партия идёт до этого числа заброшенных шайб.',
      type: 'select',
      choices: [1, 3, 5, 7].map((n) => ({ value: String(n), label: n === 1 ? 'один гол' : `до ${n} голов` })),
      default: '3',
      showIf: (opts) => !!boardOf(String(opts.map ?? BOARDS[0].id)).race,
    },
  ],
  presets: BOARDS.map((b) => ({ id: b.id, label: b.title, options: { map: b.id } })),
  setup: (seats, opts, rng) => {
    const ids = seats.map((x) => x.seat).sort((a, b) => a - b);
    const board = boardOf(String(opts.map ?? BOARDS[0].id));
    const race = board.race;
    // «Лукоморье»: перед игрой каждый берёт из банка бон по сумме трёх бросков, первым ходит богатейший
    const coins = Array(10).fill(0);
    if (board.startCoins) {
      for (const s of ids) {
        let sum = 0;
        for (let i = 0; i < board.startCoins; i++) sum += rng.int(6) + 1;
        coins[s] = sum;
      }
    }
    const first = board.startCoins ? ids.reduce((best, s) => (coins[s] > coins[best] ? s : best), ids[0]) : ids[0];
    return {
      map: board.id,
      seats: ids,
      pos: Array(10).fill(0),
      skip: Array(10).fill(0),
      route: Array(10).fill(null),
      turn: first,
      phase: 'roll',
      last: null,
      winner: null,
      ...(race ? { goals: race.tracks.map(() => 0), target: Math.max(1, Number(opts.goals ?? race.target) || race.target), kind: null, card: null, cardSlot: null } : {}),
      // «Лукоморье»: боны, предметы и дополнительные ходы
      ...(board.coins ? { coins, items: Array(10).fill(null), extra: Array(10).fill(0) } : {}),
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
  bot: {
    levels: ['Лёгкий', 'Средний', 'Сложный'],
    choose: (v) => {
      const phase = v.phase ?? 'roll';
      // загадка: бот называет ответ по кругу (правильного варианта в правилах нет — выбирает игрок)
      if (phase === 'pick') {
        const g = boardOf(v.map).cells[v.pos[v.turn]]?.sign;
        const n = g?.k === 'pick' ? g.options.length : 1;
        return { type: 'pick', pick: v.pos[v.turn] % Math.max(1, n) };
      }
      return { type: phase === 'roll' ? 'roll' : 'move' };
    },
  },
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
      case 'coins':
        return ev.delta >= 0
          ? `💰 ${name(ev.seat)} берёт <b>${ev.delta}</b> бон (всего ${ev.total}).`
          : `💸 ${name(ev.seat)} отдаёт <b>${-ev.delta}</b> бон (осталось ${ev.total}).`;
      case 'item':
        return ev.lost
          ? `😱 ${name(ev.seat)} теряет <b>${itemName(ev.item)}</b>.`
          : `🎁 ${name(ev.seat)} берёт <b>${itemName(ev.item)}</b>.`;
      case 'extra':
        return `⏩ ${name(ev.seat)} получает <b>${ev.n}</b> дополнительных хода.`;
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
